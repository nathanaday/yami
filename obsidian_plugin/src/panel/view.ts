import { ItemView, setIcon, type WorkspaceLeaf } from "obsidian";
import { LINKED_KINDS, STATUS_LABELS, type LinkedKind, type SessionAct, type SessionDetails, type SessionDocument, type SessionStatus, type SessionSummary, type YamiModule } from "yami";
import { basename } from "yami/document";
import { modeOf, moduleIcon, type ObsidianYami } from "yami/obsidian";
import * as ui from "../ui";

export const PANEL_VIEW = "yami-panel";

/** Where the panel is: the list of modules, one module and its sessions, or one session. */
type Place = { level: "modules" } | { level: "module"; module: string } | { level: "session"; module: string; path: string };

/** How the panel shows each kind of linked document. The library gives the kinds and their order. */
const KIND_LOOK: Record<LinkedKind, { title: string; icon: string }> = {
  promises: { title: "Promises", icon: "target" },
  policies: { title: "Policies", icon: "shield" },
  skills: { title: "Skills", icon: "sparkles" },
  articles: { title: "Articles", icon: "file-text" },
};

/** The order of the status counts on a module's row: what needs a look first. */
const COUNT_ORDER: SessionStatus[] = ["working", "checking", "needs-attention", "failed", "stopped", "open", "done"];

/**
 * A sidebar view of the vault's Yami: the modules, the sessions of a module, and one session with what it
 * links and what a person can do with it. The view only lays out what the library gives: the summaries,
 * the details, the acts, and the change feed.
 */
export class YamiPanel extends ItemView {
  private place: Place = { level: "modules" };
  private ticket = 0;
  private unsubscribe: (() => void) | undefined;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly yami: ObsidianYami,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return PANEL_VIEW;
  }

  getDisplayText(): string {
    return "Yami";
  }

  getIcon(): string {
    return "blocks";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("yami-panel");
    // The panel itself takes the focus when nothing in it has it, so its keys still work.
    this.contentEl.tabIndex = -1;
    this.contentEl.addEventListener("keydown", (evt) => {
      if (evt.target instanceof HTMLInputElement) return;
      if ((evt.key === "Backspace" || (evt.altKey && evt.key === "ArrowLeft")) && this.place.level !== "modules") {
        evt.preventDefault();
        this.up();
      }
    });
    this.unsubscribe = this.yami.onSessionsChange(() => void this.render());
    await this.render();
  }

  async onClose(): Promise<void> {
    this.unsubscribe?.();
  }

  /** Shows a place: the modules, one module, or one session. `focus` names the element to focus there. */
  go(place: Place, focus?: string): void {
    const deeper = depth(place) >= depth(this.place);
    this.place = place;
    void this.render(deeper ? "in" : "out", focus ?? (deeper ? "back" : undefined));
  }

  /** Goes up a level, with the focus on the row of the place it leaves. */
  private up(): void {
    const place = this.place;
    if (place.level === "session") this.go({ level: "module", module: place.module }, `session:${place.path}`);
    else if (place.level === "module") this.go({ level: "modules" }, `module:${place.module}`);
  }

  /**
   * Draws the place off screen, then swaps it in. A refresh keeps the scroll and the focus; when the focused
   * element is gone, such as Run once it becomes Stop, the first act takes the focus.
   */
  private async render(direction?: "in" | "out", focus?: string): Promise<void> {
    const ticket = ++this.ticket;
    const page = createDiv({ cls: "yami-panel-page" });
    let drawn: Place = this.place;
    try {
      drawn = await this.draw(page, this.place);
    } catch (error) {
      page.empty();
      page.createDiv({ cls: "yami-panel-empty", text: `Yami could not show this: ${(error as Error).message}` });
    }
    if (ticket !== this.ticket) return;
    this.place = drawn;
    const inside = this.contentEl.contains(document.activeElement);
    const focused = inside ? (document.activeElement as HTMLElement).closest<HTMLElement>("[data-key]")?.dataset.key : undefined;
    const scroll = this.contentEl.scrollTop;
    this.contentEl.empty();
    this.contentEl.appendChild(page);
    if (direction) page.addClass(`is-entering-${direction}`);
    else this.contentEl.scrollTop = scroll;
    const find = (key: string | undefined) => (key ? page.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`) : null);
    const target = direction ? (find(focus) ?? find("back") ?? page.querySelector<HTMLElement>("[data-key]")) : inside ? (find(focused) ?? page.querySelector<HTMLElement>(".yami-action")) : null;
    if (target) target.focus();
    else if (direction || inside) this.contentEl.focus();
  }

  /** Draws a place, or the nearest place above it that still exists, and says which it drew. */
  private async draw(page: HTMLElement, place: Place): Promise<Place> {
    const module = place.level === "modules" ? undefined : this.yami.module(place.module);
    if (!module) {
      await this.drawModules(page);
      return { level: "modules" };
    }
    page.addClass("has-spine");
    page.style.setProperty("--yami-module-color", module.colors.folder);
    if (place.level === "session" && (await this.yami.vault.exists(place.path))) {
      this.drawSession(page, module, await this.yami.session(place.path).details());
      return place;
    }
    await this.drawModule(page, module);
    return { level: "module", module: module.id };
  }

  private async drawModules(page: HTMLElement): Promise<void> {
    const summaries = await this.yami.summaries();
    this.breadcrumb(page, []);
    page.createEl("h2", { cls: "yami-panel-title", text: "Modules" });

    const live = summaries.filter((s) => s.status === "working" || s.status === "checking");
    if (live.length) {
      const group = ui.section(page, "Working now", `${live.length}`);
      for (const summary of live) {
        const row = ui.row(group, `live:${summary.path}`, () => this.go({ level: "session", module: summary.module.id, path: summary.path }));
        row.setAttribute("aria-label", `${summary.name}, ${summary.module.name}, ${STATUS_LABELS[summary.status].toLowerCase()}`);
        row.style.setProperty("--yami-module-color", summary.module.colors.folder);
        mark(row, summary.status);
        const text = row.createDiv({ cls: "yami-row-text" });
        text.createDiv({ cls: "yami-row-name", text: summary.name });
        text.createDiv({ cls: "yami-row-meta yami-module-name", text: summary.module.name });
      }
    }

    const list = page.createDiv({ cls: "yami-module-list" });
    for (const module of this.yami.modules) {
      const mine = summaries.filter((s) => s.module === module);
      // The badge counts the sessions that wait for the person, so the line under the name leaves them out.
      const waiting = mine.filter((s) => s.status === "needs-attention").length;
      const row = ui.row(list, `module:${module.id}`, () => this.go({ level: "module", module: module.id }));
      row.addClass("yami-module-row");
      row.setAttribute("aria-label", `${module.name}: ${moduleLine(module, mine, COUNT_ORDER)}`);
      row.style.setProperty("--yami-module-color", module.colors.folder);
      setIcon(row.createSpan({ cls: "yami-module-icon" }), moduleIcon(module));
      const text = row.createDiv({ cls: "yami-row-text" });
      text.createDiv({ cls: "yami-row-name", text: module.name });
      text.createDiv({ cls: "yami-row-sub", text: moduleLine(module, mine, waiting ? COUNT_ORDER.filter((s) => s !== "needs-attention") : COUNT_ORDER) });
      if (waiting) row.createSpan({ cls: "yami-badge", text: `${waiting}`, attr: { title: counts(mine, ["needs-attention"]), "aria-hidden": "true" } });
      setIcon(row.createSpan({ cls: "yami-row-chevron" }), "chevron-right");
    }
  }

  private async drawModule(page: HTMLElement, module: YamiModule): Promise<void> {
    this.breadcrumb(page, [module.name]);
    const head = page.createDiv({ cls: "yami-module-head" });
    setIcon(head.createSpan({ cls: "yami-module-icon" }), moduleIcon(module));
    head.createEl("h2", { cls: "yami-panel-title", text: module.name });
    if (module.description) page.createEl("p", { cls: "yami-panel-lede", text: module.description });

    const bar = page.createDiv({ cls: "yami-actions" });
    const acts = module.acts();
    for (const act of acts) {
      const key = act.kind === "new" ? `new:${act.template.id}` : `action:${act.action.id}`;
      this.button(bar, key, act.label, act.kind === "new" ? "plus" : undefined, act.kind === "new", () => this.yami.runModuleAct(act));
    }
    if (!bar.childElementCount) bar.remove();
    const news = acts.filter((act) => act.kind === "new");

    if (module.sessionsIn === "none") {
      page.createDiv({ cls: "yami-panel-empty", text: `${module.name} keeps no sessions.` });
      return;
    }
    const summaries = await this.yami.summaries(module);
    const list = ui.section(page, "Sessions", summaries.length ? `${summaries.length}` : undefined);
    if (!summaries.length) {
      list.createDiv({ cls: "yami-panel-empty", text: news.length ? `No sessions yet. ${news.map((act) => act.label).join(" or ")} starts one.` : "No sessions yet." });
      return;
    }
    for (const summary of summaries) this.sessionRow(list, summary, module.templates.length > 1);
  }

  private sessionRow(list: HTMLElement, summary: SessionSummary, showTemplate: boolean): void {
    // The row and its quick button sit side by side: a button never holds another.
    const item = list.createDiv({ cls: "yami-session-item", attr: { "data-status": summary.status } });
    const row = ui.row(item, `session:${summary.path}`, () => this.go({ level: "session", module: summary.module.id, path: summary.path }));
    row.addClass("yami-session-row");
    row.setAttribute("aria-label", `${summary.name}, ${STATUS_LABELS[summary.status].toLowerCase()}`);
    mark(row, summary.status);
    const text = row.createDiv({ cls: "yami-row-text" });
    text.createDiv({ cls: "yami-row-name", text: summary.name, attr: { title: summary.name } });
    const meta = text.createDiv({ cls: "yami-row-meta" });
    meta.createSpan({ text: STATUS_LABELS[summary.status] });
    if (showTemplate && summary.template) meta.createSpan({ text: summary.template.name });
    if (summary.created) meta.createSpan({ text: when(summary.created) });
    if (summary.iteration) meta.createSpan({ text: iterations(summary.iteration) });

    // One quick act on the row: stop a live run, or run with the first agent.
    const quick = summary.session.acts(summary.properties).find((a) => a.kind === "stop" || a.kind === "start");
    if (quick) {
      const button = item.createEl("button", { cls: "yami-quick clickable-icon", attr: { "aria-label": `${quick.label}: ${summary.name}`, "data-key": `quick:${summary.path}` } });
      setIcon(button, quick.kind === "stop" ? "square" : "play");
      button.addEventListener("click", () => void this.yami.notify(quick.run()));
    }
  }

  private drawSession(page: HTMLElement, module: YamiModule, details: SessionDetails): void {
    this.breadcrumb(page, [module.name, details.name]);
    const title = page.createEl("h2", { cls: "yami-panel-title is-link", text: details.name, attr: { tabindex: "0", role: "link", "data-key": "title", "aria-label": `Open ${details.name}` } });
    ui.activates(title, (evt) => void this.yami.open(details.path, modeOf(evt)));

    const state = page.createDiv({ cls: "yami-state" });
    mark(state, details.status);
    state.createSpan({ cls: "yami-state-label", text: STATUS_LABELS[details.status] });
    const meta = state.createDiv({ cls: "yami-row-meta" });
    if (details.template) meta.createSpan({ text: details.template.name });
    if (details.created) meta.createSpan({ text: when(details.created) });
    if (details.iteration) meta.createSpan({ text: iterations(details.iteration) });
    if (details.harness) meta.createSpan({ text: capitalize(details.harness) });

    const bar = page.createDiv({ cls: "yami-actions" });
    const acts = details.session.acts(details.properties);
    // The first act leads: a run, or a stop while one is live. A kill stays plain: it is the way out when a stop does not end the run.
    acts.forEach((act, i) => this.button(bar, `act:${act.kind}:${act.label}`, act.label, actIcon(act), i === 0 && act.kind !== "stop", () => this.yami.notify(act.run()), act.kind === "stop"));
    if (!bar.childElementCount) bar.remove();

    for (const kind of LINKED_KINDS) {
      const { title: heading, icon } = KIND_LOOK[kind];
      const documents = details.documents.filter((d) => d.kind === kind);
      if (!documents.length) continue;
      const count = kind === "promises" && documents.some((d) => d.met !== undefined) ? `${documents.filter((d) => d.met).length} of ${documents.length} met` : `${documents.length}`;
      const group = ui.section(page, heading, count);
      for (const doc of documents) this.documentRow(group, doc, icon);
    }

    if (details.conversation) {
      const group = ui.section(page, "Conversation");
      const conversation = details.conversation;
      const row = ui.row(group, "conversation", (evt) => void this.yami.open(conversation, modeOf(evt)));
      ui.icon(row, "message-square");
      row.createDiv({ cls: "yami-row-name", text: basename(conversation) });
    }

    if (details.progress.length) {
      const group = ui.section(page, "Progress");
      const timeline = group.createEl("ol", { cls: "yami-progress" });
      for (const line of [...details.progress].reverse()) {
        const item = timeline.createEl("li");
        item.createSpan({ cls: "yami-progress-time", text: line.time });
        item.createSpan({ cls: "yami-progress-text", text: line.text });
      }
    }
  }

  private documentRow(group: HTMLElement, doc: SessionDocument, kindIcon: string): void {
    const path = doc.path;
    const row = ui.row(group, `doc:${doc.kind}:${doc.target}`, (evt) => path && void this.yami.open(path, modeOf(evt)));
    if (!path) row.addClass("is-missing");
    const glyph = ui.icon(row, doc.kind === "promises" && doc.met !== undefined ? (doc.met ? "check" : "x") : kindIcon);
    if (doc.kind === "promises" && doc.met !== undefined) glyph.addClass(doc.met ? "is-met" : "is-unmet");
    row.createDiv({ cls: "yami-row-name", text: doc.name });
    const note = !path ? "Missing" : doc.kind === "promises" ? (doc.met === undefined ? "Not checked" : doc.met ? "Met" : "Not met") : undefined;
    if (note) row.createDiv({ cls: "yami-row-note", text: note });
  }

  /** The path back up: Modules, then the module, then the session. The last part is where the panel is. */
  private breadcrumb(page: HTMLElement, parts: string[]): void {
    if (!parts.length) return;
    const nav = page.createEl("nav", { cls: "yami-breadcrumb", attr: { "aria-label": "Where you are" } });
    const back = nav.createEl("button", { cls: "yami-back clickable-icon", attr: { "aria-label": "Back", "data-key": "back" } });
    setIcon(back, "chevron-left");
    back.addEventListener("click", () => this.up());
    const trail = ["Modules", ...parts];
    trail.forEach((part, i) => {
      if (i) nav.createSpan({ cls: "yami-breadcrumb-sep", text: "/" });
      if (i === trail.length - 1) {
        nav.createSpan({ cls: "yami-breadcrumb-here", text: part, attr: { "aria-current": "page" } });
        return;
      }
      const link = nav.createEl("button", { cls: "yami-breadcrumb-part", text: part, attr: { "data-key": `crumb:${i}` } });
      const place = this.place;
      link.addEventListener("click", () => this.go(i === 0 || place.level === "modules" ? { level: "modules" } : { level: "module", module: place.module }));
    });
  }

  private button(parent: HTMLElement, key: string, label: string, iconName: string | undefined, primary: boolean, run: () => Promise<void>, warning = false): void {
    const button = parent.createEl("button", { cls: ["yami-action", ...(primary ? ["mod-cta"] : []), ...(warning ? ["mod-warning"] : [])], attr: { "data-key": key } });
    if (iconName) setIcon(button.createSpan({ cls: "yami-action-icon" }), iconName);
    button.createSpan({ text: label });
    button.addEventListener("click", () => {
      // The button waits for a short act; a run goes on in the background, and the change feed redraws the
      // panel. It stays focusable while it waits: a disabled button would drop the focus out of the panel.
      if (button.ariaDisabled === "true") return;
      button.ariaDisabled = "true";
      void Promise.race([run(), new Promise((resolve) => window.setTimeout(resolve, 600))]).finally(() => (button.ariaDisabled = null));
    });
  }
}

function depth(place: Place): number {
  return place.level === "modules" ? 0 : place.level === "module" ? 1 : 2;
}

/** The status as a shape: hollow before a run, turning while it works, filled when done, and a sign of its own for each other end. */
function mark(parent: HTMLElement, status: SessionStatus): HTMLElement {
  return parent.createSpan({ cls: "yami-mark", attr: { "data-status": status, role: "img", "aria-label": STATUS_LABELS[status] } });
}

/**
 * A module's line in the list: its sessions of the given statuses, counted, or of every status when none of
 * those has one; for a module that keeps no sessions, what a person can do with it.
 */
function moduleLine(module: YamiModule, sessions: SessionSummary[], statuses: SessionStatus[]): string {
  if (module.sessionsIn === "none") return module.acts().map((act) => act.label).join(" · ") || "No sessions";
  if (!sessions.length) return "No sessions yet";
  return counts(sessions, statuses) || counts(sessions, COUNT_ORDER);
}

/** The sessions of each status, in the order given, as a person says them: `1 working · 4 done`. */
function counts(sessions: SessionSummary[], statuses: SessionStatus[]): string {
  return statuses
    .flatMap((status) => {
      const n = sessions.filter((s) => s.status === status).length;
      return n ? [`${n} ${STATUS_LABELS[status].toLowerCase()}`] : [];
    })
    .join(" · ");
}

function actIcon(act: SessionAct): string | undefined {
  return { start: "play", resume: "rotate-ccw", stop: "square", kill: "x", action: undefined }[act.kind];
}

/** When a session was created, as a person says it: the time today, the day this year, or the date. */
function when(created: string): string {
  const date = new Date(created);
  if (Number.isNaN(date.getTime())) return created;
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return `Today ${date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(date.getFullYear() !== now.getFullYear() && { year: "numeric" }) });
}

function iterations(n: number): string {
  return n === 1 ? "1 iteration" : `${n} iterations`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
