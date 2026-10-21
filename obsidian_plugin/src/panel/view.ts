import { ItemView, Menu, Notice, setIcon, type WorkspaceLeaf } from "obsidian";
import { LINKED_KINDS, STATUS_LABELS, WikiModule, type LinkedKind, type ModuleProblem, type SessionAct, type SessionDetails, type SessionDocument, type SessionStatus, type SessionSummary, type YamiModule } from "yami";
import { basename, type ChangeStatus } from "yami/document";
import { age, modeOf, moduleIcon, type ObsidianYami } from "yami/obsidian";
import { CHANGE_STATUS_LABELS, type ChangeAct, type ChangeDetails, type ChangeSummary, type ChangeWrite, type WriteCounts } from "yami/wiki";
import * as ui from "../ui";
import { diffLines } from "./diff";

export const PANEL_VIEW = "yami-panel";

/** Where the panel is: the list of modules, one module and its sessions, one session, or one change of the wiki. */
type Place = { level: "modules" } | { level: "module"; module: string } | { level: "session"; module: string; path: string } | { level: "change"; path: string };

/** How the panel shows each kind of linked document. The library gives the kinds and their order. */
const KIND_LOOK: Record<LinkedKind, { title: string; icon: string }> = {
  promises: { title: "Promises", icon: "target" },
  policies: { title: "Policies", icon: "shield" },
  skills: { title: "Skills", icon: "sparkles" },
  agents: { title: "Agents", icon: "bot" },
  articles: { title: "Articles", icon: "file-text" },
};

/** The order of the status counts on a module's row: what needs a look first. */
const COUNT_ORDER: SessionStatus[] = ["working", "checking", "reviewing", "needs-attention", "failed", "stopped", "open", "done"];

/** The writes of a change by op, in the order a person reads them, with the heading before and after the change applies. */
const OPS: { op: ChangeWrite["op"]; icon: string; proposed: string; applied: string; count: keyof WriteCounts; short: string }[] = [
  { op: "create", icon: "plus", proposed: "Creates", applied: "Created", count: "creates", short: "new" },
  { op: "modify", icon: "pencil", proposed: "Changes", applied: "Changed", count: "modifies", short: "changed" },
  { op: "remove", icon: "minus", proposed: "Removes", applied: "Removed", count: "removes", short: "removed" },
];

/** The word while an act runs: the library's for an approval; a reject has no status of its own, so the word is the panel's. */
const BUSY: Record<ChangeAct["kind"], string> = { approve: CHANGE_STATUS_LABELS.applying, reject: "Rejecting" };

/**
 * A sidebar view of the vault's Yami: the modules, the sessions of a module, and one session with what it
 * links and what a person can do with it, and what keeps a module of the vault out; and the wiki's change
 * plans that wait for a person, each with what it writes and the acts on it. The view only lays out what
 * the library gives: the modules and their problems, the summaries, the details, the changes, the acts,
 * and the change feeds.
 */
export class YamiPanel extends ItemView {
  private place: Place = { level: "modules" };
  private ticket = 0;
  private unsubscribe?: () => void;
  /** The act that runs now on a change, so the page shows it at once, before the document says so. */
  private pending?: { path: string; kind: ChangeAct["kind"] };
  /** The refusal of the last act on a change, which writes nothing, so only the page can show it. */
  private refusal?: { path: string; message: string };
  /** The proposals as the last draw of a waiting list showed them, so a new row enters and a finished one leaves. */
  private shown?: Map<string, ChangeSummary>;

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

  /** Shows a place: the modules, one module, one session, or one change. `focus` names the element to focus there. */
  go(place: Place, focus?: string): void {
    const deeper = depth(place) >= depth(this.place);
    this.place = place;
    this.refusal = undefined;
    void this.render(deeper ? "in" : "out", focus ?? (deeper ? "back" : undefined));
  }

  /** Goes up a level, with the focus on the row of the place it leaves. */
  private up(): void {
    const place = this.place;
    if (place.level === "session") this.go({ level: "module", module: place.module }, `session:${place.path}`);
    else if (place.level === "change") this.go({ level: "module", module: this.wikiModule()?.id ?? "" }, `change:${place.path}`);
    else if (place.level === "module") this.go({ level: "modules" }, `module:${place.module}`);
  }

  /** The module whose changes the panel shows: the wiki. */
  private wikiModule(): YamiModule | undefined {
    return this.yami.modules.find((module) => module instanceof WikiModule);
  }

  /**
   * Draws the place off screen, then swaps it in. A refresh keeps the scroll and the focus; when the focused
   * element is gone, such as Run once it becomes Stop, the first act takes the focus.
   */
  private async render(direction?: "in" | "out", focus?: string): Promise<void> {
    const ticket = ++this.ticket;
    // A page that enters as a whole animates no row of its own.
    if (direction) this.shown = undefined;
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
    const module = place.level === "modules" ? undefined : place.level === "change" ? this.wikiModule() : this.yami.module(place.module);
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
    if (place.level === "change" && (await this.yami.vault.exists(place.path))) {
      this.drawChange(page, module, await this.yami.wiki.changeDetails(place.path));
      return place;
    }
    await this.drawModule(page, module);
    return { level: "module", module: module.id };
  }

  private async drawModules(page: HTMLElement): Promise<void> {
    const summaries = await this.yami.summaries();
    const proposals = await this.yami.wiki.changes();
    this.breadcrumb(page, []);
    page.createEl("h2", { cls: "yami-panel-title", text: "Modules" });
    this.waiting(page, proposals);

    const live = summaries.filter((s) => s.session.running);
    if (live.length) {
      const group = ui.section(page, "Working now", `${live.length}`);
      for (const summary of live) {
        const row = ui.row(group, `live:${summary.path}`, () => this.go({ level: "session", module: summary.module.id, path: summary.path }));
        row.setAttribute("aria-label", `${summary.name}, ${summary.module.name}, ${STATUS_LABELS[summary.status].toLowerCase()}`);
        row.style.setProperty("--yami-module-color", summary.module.colors.folder);
        mark(row, summary.status, STATUS_LABELS[summary.status]);
        const text = row.createDiv({ cls: "yami-row-text" });
        text.createDiv({ cls: "yami-row-name", text: summary.name });
        text.createDiv({ cls: "yami-row-meta yami-module-name", text: summary.module.name });
      }
    }

    const list = page.createDiv({ cls: "yami-module-list" });
    for (const module of this.yami.modules) {
      const mine = summaries.filter((s) => s.module === module);
      // The badge counts what waits for the person: the sessions that need attention, and on the wiki its
      // proposals. The line under the name leaves the sessions out.
      const waiting = mine.filter((s) => s.status === "needs-attention").length;
      const proposed = module instanceof WikiModule ? proposals.length : 0;
      const proposedLine = proposed ? `${proposed} ${proposed === 1 ? "change waits" : "changes wait"} for approval` : "";
      const row = ui.row(list, `module:${module.id}`, () => this.go({ level: "module", module: module.id }));
      row.addClass("yami-module-row");
      row.setAttribute("aria-label", `${module.name}: ${[proposedLine, moduleLine(module, mine, COUNT_ORDER)].filter(Boolean).join(" · ")}`);
      row.style.setProperty("--yami-module-color", module.colors.folder);
      setIcon(row.createSpan({ cls: "yami-module-icon" }), moduleIcon(module));
      const text = row.createDiv({ cls: "yami-row-text" });
      text.createDiv({ cls: "yami-row-name", text: module.name });
      text.createDiv({ cls: "yami-row-sub", text: moduleLine(module, mine, waiting ? COUNT_ORDER.filter((s) => s !== "needs-attention") : COUNT_ORDER) });
      if (waiting + proposed) row.createSpan({ cls: "yami-badge", text: `${waiting + proposed}`, attr: { title: [proposedLine, waiting && counts(mine, ["needs-attention"])].filter(Boolean).join(" · "), "aria-hidden": "true" } });
      setIcon(row.createSpan({ cls: "yami-row-chevron" }), "chevron-right");
    }
    this.problems(page, this.yami.problems);
  }

  /** The proposals that wait for the person, one row each. A new one enters; one that is done leaves. */
  private waiting(page: HTMLElement, proposals: ChangeSummary[]): void {
    const group = ui.section(page, "Waiting for approval", proposals.length ? `${proposals.length}` : undefined);
    group.addClass("yami-waiting");
    if (!proposals.length) group.createDiv({ cls: "yami-panel-empty", text: "Nothing waits for approval." });
    const now = new Map(proposals.map((p) => [p.path, p]));
    const before = this.shown;
    // The rows in the order of the last draw, with a ghost that fades for each that is gone, then the new ones.
    const order = [...(before?.keys() ?? []), ...proposals.map((p) => p.path).filter((path) => !before?.has(path))];
    for (const path of order) {
      const proposal = now.get(path);
      if (proposal) {
        const row = this.changeRow(group, proposal);
        if (before && !before.has(path)) row.addClass("is-entering");
      } else if (before) {
        const row = this.changeRow(group, before.get(path)!);
        row.addClass("is-leaving");
        row.tabIndex = -1;
        row.setAttribute("aria-hidden", "true");
        window.setTimeout(() => row.remove(), 300);
      }
    }
    this.shown = now;
  }

  private changeRow(parent: HTMLElement, change: ChangeSummary): HTMLElement {
    const module = change.module ? this.yami.module(change.module) : undefined;
    const row = ui.row(parent, `change:${change.path}`, () => this.go({ level: "change", path: change.path }));
    row.addClass("yami-change-row");
    row.setAttribute("aria-label", `${change.title}, ${countsLine(change)}, ${age(change.created)}${module ? `, ${module.name}` : ""}`);
    mark(row, change.status, CHANGE_STATUS_LABELS[change.status]);
    const text = row.createDiv({ cls: "yami-row-text" });
    text.createDiv({ cls: "yami-row-name", text: change.title, attr: { title: change.title } });
    const meta = text.createDiv({ cls: "yami-row-meta" });
    meta.createSpan({ text: countsLine(change) });
    meta.createSpan({ text: age(change.created) });
    if (module) {
      const name = meta.createSpan({ cls: "yami-module-name", text: module.name });
      name.style.setProperty("--yami-module-color", module.colors.folder);
    }
    return row;
  }

  /**
   * What a person must fix or know: a vault module or a flow that stays out, or an edited base skill, with the
   * file to open. Each problem copies as its path and message, to paste where a person or an agent fixes it.
   */
  private problems(page: HTMLElement, problems: readonly ModuleProblem[]): void {
    if (!problems.length) return;
    const group = ui.section(page, "Problems", `${problems.length}`);
    group.addClass("yami-problems");
    const all = group.querySelector(".yami-section-head")!.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Copy all problems", "data-key": "copy-problems" } });
    setIcon(all, "copy");
    all.addEventListener("click", () => void copy(problems.map((p) => `- ${problemText(p)}`).join("\n"), problems.length === 1 ? "Copied the problem." : `Copied ${problems.length} problems.`));
    for (const problem of problems) {
      const document = problem.document;
      // The row and its copy button sit side by side: a button never holds another.
      const item = group.createDiv({ cls: "yami-problem-item" });
      const row = ui.row(item, `problem:${problem.path}:${problem.message}`, (evt) => document && void this.yami.open(document, modeOf(evt)));
      row.addClass("yami-problem-row");
      if (!document) row.addClass("is-missing");
      ui.icon(row, "alert-triangle");
      const text = row.createDiv({ cls: "yami-row-text" });
      breakAtSlashes(text.createDiv({ cls: "yami-row-name" }), problem.path);
      breakAtSlashes(text.createDiv({ cls: "yami-row-desc" }), problem.message);
      row.addEventListener("contextmenu", (evt) => {
        evt.preventDefault();
        const menu = new Menu();
        menu.addItem((i) => i.setTitle("Copy problem").setIcon("copy").onClick(() => void copy(problemText(problem), "Copied the problem.")));
        menu.addItem((i) => i.setTitle("Copy path").setIcon("link").onClick(() => void copy(problem.path, "Copied the path.")));
        if (document) menu.addItem((i) => i.setTitle("Open file").setIcon("file").onClick(() => void this.yami.open(document)));
        menu.showAtMouseEvent(evt);
      });
      const button = item.createEl("button", { cls: "yami-quick clickable-icon", attr: { "aria-label": `Copy problem: ${problem.path}`, "data-key": `copy:${problem.path}:${problem.message}` } });
      setIcon(button, "copy");
      button.addEventListener("click", () => void copy(problemText(problem), "Copied the problem."));
    }
  }

  private async drawModule(page: HTMLElement, module: YamiModule): Promise<void> {
    this.breadcrumb(page, [module.name]);
    const head = page.createDiv({ cls: "yami-module-head" });
    setIcon(head.createSpan({ cls: "yami-module-icon" }), moduleIcon(module));
    head.createEl("h2", { cls: "yami-panel-title", text: module.name });
    if (module.description) page.createEl("p", { cls: "yami-panel-lede", text: module.description });
    this.problems(page, this.yami.problems.filter((p) => p.module === module.id));

    const bar = page.createDiv({ cls: "yami-actions" });
    const acts = module.acts();
    for (const act of acts) {
      const key = act.kind === "new" ? `new:${act.flow.name}` : `action:${act.action.id}`;
      this.button(bar, key, act.label, act.kind === "new" ? "plus" : undefined, act.kind === "new", () => this.yami.runModuleAct(act));
    }
    if (!bar.childElementCount) bar.remove();
    const news = acts.filter((act) => act.kind === "new");

    if (module instanceof WikiModule) this.waiting(page, await this.yami.wiki.changes());

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
    for (const summary of summaries) this.sessionRow(list, summary, module.flows.length > 1);
  }

  private sessionRow(list: HTMLElement, summary: SessionSummary, showFlow: boolean): void {
    // The row and its quick button sit side by side: a button never holds another.
    const item = list.createDiv({ cls: "yami-session-item", attr: { "data-status": summary.status } });
    item.toggleClass("is-live", summary.session.running);
    const row = ui.row(item, `session:${summary.path}`, () => this.go({ level: "session", module: summary.module.id, path: summary.path }));
    row.addClass("yami-session-row");
    row.setAttribute("aria-label", `${summary.name}, ${STATUS_LABELS[summary.status].toLowerCase()}`);
    mark(row, summary.status, STATUS_LABELS[summary.status]);
    const text = row.createDiv({ cls: "yami-row-text" });
    text.createDiv({ cls: "yami-row-name", text: summary.name, attr: { title: summary.name } });
    const meta = text.createDiv({ cls: "yami-row-meta" });
    meta.createSpan({ text: STATUS_LABELS[summary.status] });
    if (showFlow && summary.flow) meta.createSpan({ text: summary.flow.title });
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
    mark(state, details.status, STATUS_LABELS[details.status]);
    state.createSpan({ cls: "yami-state-label", text: STATUS_LABELS[details.status] });
    const meta = state.createDiv({ cls: "yami-row-meta" });
    if (details.flow) meta.createSpan({ text: details.flow.title });
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
      const judged = documents.filter((d) => verdict(d) !== undefined);
      const count = judged.length ? `${judged.filter((d) => verdict(d)).length} of ${documents.length} ${kind === "policies" ? "followed" : "met"}` : `${documents.length}`;
      const group = ui.section(page, heading, count);
      for (const doc of documents) this.documentRow(group, doc, icon);
    }

    if (details.conversation || details.review || details.agentRuns.length) {
      const group = ui.section(page, "Conversation");
      const notes: [string, string | undefined, string, string | undefined][] = [
        ["conversation", details.conversation, "message-square", undefined],
        ...details.agentRuns.map((run): [string, string, string, string] => [`agent:${run.conversation}`, run.conversation, "bot", STATUS_LABELS[run.status]]),
        ["review", details.review, "scale", details.status === "reviewing" ? "Reviewing" : "Review"],
      ];
      for (const [key, note, icon, label] of notes) {
        if (!note) continue;
        const row = ui.row(group, key, (evt) => void this.yami.open(note, modeOf(evt)));
        ui.icon(row, icon);
        row.createDiv({ cls: "yami-row-name", text: basename(note) });
        if (label) row.createDiv({ cls: "yami-row-note", text: label });
      }
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
    const passed = verdict(doc);
    const glyph = ui.icon(row, passed === undefined ? kindIcon : passed ? "check" : "x");
    if (passed !== undefined) glyph.addClass(passed ? "is-met" : "is-unmet");
    const text = row.createDiv({ cls: "yami-row-text" });
    text.createDiv({ cls: "yami-row-name", text: doc.name });
    const desc = doc.reason ?? doc.description;
    if (desc) text.createDiv({ cls: "yami-row-desc", text: desc, attr: { title: desc } });
    const note = !path
      ? "Missing"
      : doc.kind === "promises"
        ? passed === undefined ? (doc.judged ? "Not reviewed" : "Not checked") : passed ? "Met" : "Not met"
        : doc.kind === "policies"
          ? passed === undefined ? "Not reviewed" : passed ? "Followed" : "Broken"
          : undefined;
    if (note) row.createDiv({ cls: "yami-row-note", text: note });
  }

  /** One change of the wiki: where it stands, the acts on it, its notes, and each write with its diff. */
  private drawChange(page: HTMLElement, module: YamiModule, details: ChangeDetails): void {
    this.breadcrumb(page, [module.name, details.title]);
    const title = page.createEl("h2", { cls: "yami-panel-title is-link", text: details.title, attr: { tabindex: "0", role: "link", "data-key": "title", "aria-label": `Open the change document of ${details.title}` } });
    ui.activates(title, (evt) => void this.yami.open(details.path, modeOf(evt)));

    const pending = this.pending?.path === details.path ? this.pending.kind : undefined;
    // While an act runs, the mark turns as the `applying` status does, for a reject too.
    const status: ChangeStatus = pending ? "applying" : details.status;
    const label = pending ? BUSY[pending] : CHANGE_STATUS_LABELS[status];
    const state = page.createDiv({ cls: "yami-state", attr: { "data-status": status } });
    mark(state, status, label);
    state.createSpan({ cls: "yami-state-label", text: label });
    const meta = state.createDiv({ cls: "yami-row-meta" });
    meta.createSpan({ text: `Proposed ${when(details.created)}` });
    if (details.session) {
      const session = details.session;
      const link = meta.createSpan({ cls: "yami-inline-link", text: basename(session), attr: { tabindex: "0", role: "link", "data-key": "session", "aria-label": `The session ${basename(session)}` } });
      ui.activates(link, () => this.go({ level: "session", module: details.module ?? module.id, path: session }));
    }

    // Where it ended: the versions and the counts, the reason, or the error.
    if (details.status === "applied") {
      const result = page.createDiv({ cls: "yami-change-result is-applied" });
      ui.icon(result, "check");
      result.createSpan({ text: `Applied · v${details.before} → v${details.after} · ${countsLine(details)}` });
    } else if (details.status === "rejected") {
      const result = page.createDiv({ cls: "yami-change-result is-rejected" });
      ui.icon(result, "ban");
      result.createSpan({ text: details.reason ? `Rejected: ${details.reason}` : "Rejected, with no reason given." });
    } else if (details.status === "failed") {
      const result = page.createDiv({ cls: "yami-change-result is-failed" });
      ui.icon(result, "alert-triangle");
      result.createSpan({ text: `Failed: ${details.error ?? "no reason recorded"}` });
    }
    const refusal = this.refusal?.path === details.path ? this.refusal.message : undefined;
    if (refusal) {
      const error = page.createDiv({ cls: "yami-change-error", attr: { role: "alert" } });
      ui.icon(error, "alert-triangle");
      error.createDiv({ cls: "yami-change-error-text", text: refusal });
    }

    const bar = page.createDiv({ cls: "yami-actions" });
    for (const act of this.yami.wiki.changeActs(details)) {
      const label = pending === act.kind ? `${BUSY[pending]}…` : act.label;
      const button = this.button(bar, `act:${act.kind}`, label, act.kind === "approve" ? "check" : "x", act.kind === "approve", () => this.act(details, act));
      if (pending) button.ariaDisabled = "true";
    }
    if (!bar.childElementCount) bar.remove();

    if (details.notes) {
      const group = ui.section(page, "Notes");
      group.createDiv({ cls: "yami-change-notes", text: details.notes });
    }

    for (const look of OPS) {
      const writes = details.writes.filter((w) => w.op === look.op);
      if (!writes.length) continue;
      const group = ui.section(page, details.status === "applied" ? look.applied : look.proposed, `${writes.length}`);
      for (const write of writes) this.writeRow(group, details, write, look.icon);
    }
  }

  private writeRow(group: HTMLElement, details: ChangeDetails, write: ChangeWrite, opIcon: string): void {
    const item = group.createDiv({ cls: "yami-write", attr: { "data-op": write.op } });
    // A create's note exists only once the change applies; until then its text is in the change document.
    const target = write.op === "create" && details.status !== "applied" ? details.path : write.path;
    const row = ui.row(item, `write:${write.path}`, (evt) => void this.yami.open(target, modeOf(evt)));
    const done = details.status === "applied";
    const glyph = ui.icon(row, done ? "check" : opIcon);
    if (done) glyph.addClass("is-met");
    const text = row.createDiv({ cls: "yami-row-text" });
    text.createDiv({ cls: "yami-row-name", text: write.path, attr: { title: write.path } });
    if (write.why) text.createDiv({ cls: "yami-write-why", text: write.why });
    if (done) row.createDiv({ cls: "yami-row-note", text: "Done" });

    if (write.changed) {
      const warning = item.createDiv({ cls: "yami-write-warning" });
      ui.icon(warning, "alert-triangle");
      warning.createSpan({ text: "This note changed since the proposal. An approval overwrites that edit; the version before keeps it." });
    }

    if (write.op === "remove" && write.before === undefined) return;
    const diff = item.createDiv({ cls: "yami-diff", attr: { "data-op": write.op } });
    for (const line of diffLines(write.before ?? "", write.after ?? "")) {
      if (line.kind === "skip") {
        diff.createDiv({ cls: "yami-diff-line", attr: { "data-kind": "skip" }, text: `${line.count} unchanged ${line.count === 1 ? "line" : "lines"}` });
        continue;
      }
      const el = diff.createDiv({ cls: "yami-diff-line", attr: { "data-kind": line.kind } });
      // Inside a create or a remove every piece is new or gone, so only a modify marks the pieces of a line.
      for (const part of line.parts) el.createSpan({ cls: part.mark && write.op === "modify" ? "is-mark" : undefined, text: part.text });
    }
  }

  /**
   * Does an act on a change, and shows how it went: the act in progress from when its run starts, which for a
   * reject is after the library's prompt, then the result or the refusal. Escape in the prompt changes nothing.
   */
  private async act(details: ChangeDetails, act: ChangeAct): Promise<void> {
    this.refusal = undefined;
    try {
      await this.yami.runChangeAct(act, {
        started: () => {
          this.pending = { path: details.path, kind: act.kind };
          void this.render();
        },
      });
    } catch (error) {
      this.refusal = { path: details.path, message: (error as Error).message };
    } finally {
      this.pending = undefined;
      void this.render();
    }
  }

  /** The path back up: Modules, then the module, then the session or the change. The last part is where the panel is. */
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
      const module = place.level === "modules" ? undefined : place.level === "change" ? this.wikiModule()?.id : place.module;
      link.addEventListener("click", () => this.go(i === 0 || !module ? { level: "modules" } : { level: "module", module }));
    });
  }

  private button(parent: HTMLElement, key: string, label: string, iconName: string | undefined, primary: boolean, run: () => Promise<void>, warning = false): HTMLButtonElement {
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
    return button;
  }
}

function depth(place: Place): number {
  return place.level === "modules" ? 0 : place.level === "module" ? 1 : 2;
}

/** The status as a shape: hollow before a run, turning while it works, filled when done, and a sign of its own for each other end. */
function mark(parent: HTMLElement, status: SessionStatus | ChangeStatus, label: string): HTMLElement {
  return parent.createSpan({ cls: "yami-mark", attr: { "data-status": status, role: "img", "aria-label": label } });
}

/** The counts of a change in a short line: `2 new · 1 changed · 1 removed`. */
function countsLine(counts: WriteCounts): string {
  return OPS.flatMap((look) => (counts[look.count] ? [`${counts[look.count]} ${look.short}`] : [])).join(" · ");
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

/** A promise's last check or review, or a policy's last review: undefined before any. */
function verdict(doc: SessionDocument): boolean | undefined {
  return doc.kind === "promises" ? doc.met : doc.kind === "policies" ? doc.followed : undefined;
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

/** A problem as one line of text, with the path that its message speaks of as "this file". */
function problemText(problem: ModuleProblem): string {
  return `${problem.path}: ${problem.message}`;
}

/** Writes text in which a long path wraps after a slash, not inside a name. */
function breakAtSlashes(el: HTMLElement, text: string): void {
  text.split("/").forEach((part, i) => {
    if (i) el.append("/", createEl("wbr"));
    el.append(part);
  });
}

async function copy(text: string, done: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    new Notice(done);
  } catch (error) {
    new Notice(`Yami could not copy: ${error instanceof Error ? error.message : String(error)}`);
  }
}
