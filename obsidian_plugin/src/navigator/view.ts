import { ItemView, setIcon, type TAbstractFile, type TFile, type WorkspaceLeaf } from "obsidian";
import { modeOf, type ObsidianYami } from "yami/obsidian";
import type { TagCount } from "yami/wiki";
import * as ui from "../ui";

export const NAVIGATOR_VIEW = "yami-wiki-navigator";

/** Where the navigator is: a note and its tags, or a tag and what is under it. The tag `""` is the top. */
type Place = { kind: "note"; path: string } | { kind: "tag"; tag: string };

/**
 * A sidebar view that walks the wiki by its tags, where `ml/vision` is below `ml`. On a note, it shows the
 * tags above the note's own, its own, and the tags one level below. On a tag, it shows the tags around it and
 * the notes that hold it. It follows the note open in the editor. Its data is the wiki's `neighbors` and `tag`.
 */
export class WikiNavigator extends ItemView {
  private place: Place = { kind: "tag", tag: "" };
  private readonly history: Place[] = [];
  private ticket = 0;
  private unsubscribe: (() => void) | undefined;
  /** A redraw that waits until the view shows: a hidden view reads nothing, so it costs nothing. */
  private stale = false;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly yami: ObsidianYami,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return NAVIGATOR_VIEW;
  }

  getDisplayText(): string {
    return "Wiki navigator";
  }

  getIcon(): string {
    return "compass";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("yami-panel", "yami-navigator");
    this.contentEl.tabIndex = -1;
    this.contentEl.addEventListener("keydown", (evt) => {
      if (evt.key === "Backspace" || (evt.altKey && evt.key === "ArrowLeft")) {
        evt.preventDefault();
        this.back();
      }
    });
    this.unsubscribe = this.yami.onWikiChange(() => void this.render());
    this.registerEvent(this.app.workspace.on("file-open", (file: TFile | null) => file?.extension === "md" && this.follow(file.path)));
    this.registerEvent(this.app.vault.on("rename", (file: TAbstractFile, old: string) => this.renamed(old, file.path)));
    // A hidden view has no size; it gets one when its sidebar or its tab shows it, and then draws what it skipped.
    const shown = new ResizeObserver(() => this.stale && this.containerEl.isShown() && void this.render());
    shown.observe(this.containerEl);
    this.register(() => shown.disconnect());
    const active = this.app.workspace.getActiveFile();
    if (active?.extension === "md") this.place = { kind: "note", path: active.path };
    await this.render();
  }

  async onClose(): Promise<void> {
    this.unsubscribe?.();
  }

  /** Keeps the place and the history on a note that the person renamed or moved. */
  private renamed(old: string, path: string): void {
    const move = (place: Place): Place => (place.kind === "note" && place.path === old ? { kind: "note", path } : place);
    this.place = move(this.place);
    this.history.splice(0, this.history.length, ...this.history.map(move));
  }

  /** Goes to a place, and remembers where it was. */
  go(place: Place): void {
    this.history.push(this.place);
    if (this.history.length > 50) this.history.shift();
    this.place = place;
    void this.render("back");
  }

  private back(): void {
    const place = this.history.pop();
    if (!place) return;
    this.place = place;
    void this.render("back");
  }

  /** Shows the note open in the editor, unless the navigator shows it already. */
  private follow(path: string): void {
    if (this.place.kind === "note" && this.place.path === path) return;
    this.go({ kind: "note", path });
  }

  /** Draws the place off screen, then swaps it in. A redraw keeps the scroll and gives the focus back to the same element. */
  private async render(focus?: string): Promise<void> {
    const ticket = ++this.ticket;
    this.stale = !this.containerEl.isShown();
    if (this.stale) return;
    const page = createDiv({ cls: "yami-panel-page has-spine" });
    page.style.setProperty("--yami-module-color", this.yami.module("wiki")!.colors.folder);
    this.header(page);
    const place = this.place;
    if (place.kind === "note") await this.drawNote(page, place.path);
    else await this.drawTag(page, place.tag);
    if (ticket !== this.ticket) return;

    // The focus moves only when it is in the navigator already: following the editor never takes it from the editor.
    const inside = this.contentEl.contains(document.activeElement);
    const focused = inside ? (document.activeElement as HTMLElement).closest<HTMLElement>("[data-key]")?.dataset.key : undefined;
    const scroll = this.contentEl.scrollTop;
    this.contentEl.empty();
    this.contentEl.appendChild(page);
    if (focus) page.addClass("is-entering-in");
    else this.contentEl.scrollTop = scroll;
    if (!inside) return;
    const target = focus ? page.querySelector<HTMLElement>(`[data-key="${focus}"]:not([disabled])`) ?? page.querySelector<HTMLElement>(".yami-row") : page.querySelector<HTMLElement>(`[data-key="${CSS.escape(focused ?? "")}"]`);
    (target ?? this.contentEl).focus();
  }

  /** Back to the place before, and the top of the wiki. */
  private header(page: HTMLElement): void {
    const nav = page.createEl("nav", { cls: "yami-breadcrumb", attr: { "aria-label": "Wiki navigator" } });
    const back = nav.createEl("button", { cls: "yami-back clickable-icon", attr: { "aria-label": "Back", "data-key": "back" } });
    setIcon(back, "chevron-left");
    back.disabled = !this.history.length;
    back.addEventListener("click", () => this.back());
    if (this.place.kind === "tag" && this.place.tag === "") return;
    const top = nav.createEl("button", { cls: "yami-breadcrumb-part", text: "Wiki", attr: { "data-key": "crumb:top" } });
    top.addEventListener("click", () => this.go({ kind: "tag", tag: "" }));
  }

  private async drawNote(page: HTMLElement, path: string): Promise<void> {
    const wiki = this.yami.wiki;
    const neighbors = await wiki.neighbors(path);
    const note = wiki.note(path);
    page.createEl("h2", { cls: "yami-panel-title", text: note?.name ?? path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "") });
    if (!note || !neighbors) {
      const gone = !(await this.yami.vault.exists(path));
      page.createDiv({ cls: "yami-panel-empty", text: gone ? "This note was removed." : "This note is not in the wiki: its folder or its type stays out of the index." });
      return;
    }
    if (note.description) page.createEl("p", { cls: "yami-panel-lede", text: note.description });
    if (!neighbors.tags.length) {
      page.createDiv({ cls: "yami-panel-empty", text: "This note has no tags. A tag in its properties, such as ml/vision, places it in the wiki." });
      return;
    }
    this.tags(page, "Above", neighbors.above);
    this.tags(page, "Tags", neighbors.tags);
    this.tags(page, "Below", neighbors.below);
  }

  private async drawTag(page: HTMLElement, tag: string): Promise<void> {
    const wiki = this.yami.wiki;
    const view = await wiki.tag(tag);
    if (tag) {
      const trail = page.createDiv({ cls: "yami-tag-trail" });
      for (const above of view?.above ?? []) {
        const part = trail.createEl("button", { cls: "yami-breadcrumb-part", text: leaf(above.tag), attr: { "data-key": `trail:${above.tag}` } });
        part.addEventListener("click", () => this.go({ kind: "tag", tag: above.tag }));
        trail.createSpan({ cls: "yami-breadcrumb-sep", text: "/" });
      }
    }
    page.createEl("h2", { cls: "yami-panel-title", text: tag ? leaf(tag) : "Wiki" });
    if (!view) {
      page.createDiv({ cls: "yami-panel-empty", text: `No note holds the tag ${tag} now.` });
      return;
    }
    const notes = (n: number) => (n === 1 ? "1 note" : `${n} notes`);
    page.createEl("p", { cls: "yami-panel-lede", text: tag ? `${notes(view.count)} with this tag or one below it` : `${notes(view.count)} with tags` });
    if (!tag && !view.below.length) {
      page.createDiv({ cls: "yami-panel-empty", text: "No note has tags yet. A tag in a note's properties, such as ml/vision, places it here." });
      return;
    }
    this.tags(page, tag ? "Below" : "Tags", view.below);
    if (!view.notes.length) return;
    const group = ui.section(page, "Notes", `${view.notes.length}`);
    const open = this.app.workspace.getActiveFile()?.path;
    for (const path of view.notes) {
      const note = wiki.note(path);
      const row = ui.row(group, `note:${path}`, (evt) => void this.yami.open(path, modeOf(evt)));
      row.addClass("yami-note-row");
      if (path === open) row.addClass("is-active");
      ui.icon(row, "file-text");
      const text = row.createDiv({ cls: "yami-row-text" });
      text.createDiv({ cls: "yami-row-name", text: note?.name ?? path });
      if (note?.description) text.createDiv({ cls: "yami-row-desc", text: note.description });
    }
  }

  /** A section of tags, each with the tags above it in its name, and its count of notes. */
  private tags(page: HTMLElement, title: string, tags: TagCount[]): void {
    if (!tags.length) return;
    const group = ui.section(page, title, `${tags.length}`);
    for (const { tag, count } of tags) {
      const row = ui.row(group, `tag:${title}:${tag}`, () => this.go({ kind: "tag", tag }));
      row.setAttribute("aria-label", `${tag}, ${count === 1 ? "1 note" : `${count} notes`}`);
      ui.icon(row, "hash");
      const name = row.createDiv({ cls: "yami-row-name yami-tag-name" });
      const slash = tag.lastIndexOf("/");
      if (slash !== -1) name.createSpan({ cls: "yami-tag-above", text: `${tag.slice(0, slash + 1)}` });
      name.createSpan({ text: leaf(tag) });
      row.createDiv({ cls: "yami-row-note", text: `${count}` });
    }
  }
}

/** The last part of a tag: `ml/vision` gives `vision`. */
function leaf(tag: string): string {
  return tag.slice(tag.lastIndexOf("/") + 1);
}
