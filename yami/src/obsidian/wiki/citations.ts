import { type EditorState, type Extension, RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { type App, type MarkdownPostProcessorContext, TFile } from "obsidian";
import { basename } from "../../document/document.js";
import type { Vault } from "../../document/vault.js";
import { citations, passageText, resolveCitation, type CitationRef, type CitationTarget } from "../../wiki/citations.js";
import type { Wiki } from "../../wiki/wiki.js";

/** The class of a citation in the editor and in Reading view, and of the popover that shows where it leads. */
export const CITATION_CLASS = "yami-citation";
export const CITATION_POPOVER_CLASS = "yami-citation-popover";
/** The attribute that holds the citation's parts, as JSON of `CitationRef[]`, on a marked citation. */
export const CITATION_ATTRIBUTE = "data-yami-citation";
/** How long the pointer rests on a citation before the popover shows, in milliseconds. */
export const HOVER_DELAY = 350;

/** One part of a citation, as the popover shows it: the source, the place, and the passage or a note on it. */
export interface CitationView {
  part: CitationRef;
  /** The source note's name, or the target as written when it is no source. */
  title: string;
  /** The locator, as written. */
  where?: string;
  /** The passage at the locator, for a text. */
  text?: string;
  /** One line when there is no passage to show: a page of a PDF, a problem, or a source with no file. */
  note?: string;
  target: CitationTarget;
}

/**
 * Where a citation leads, at a hover: the passage of the source's copy at the locator, or the page of a PDF,
 * in a popover under the citation; a click on the title opens the file there. One for the plugin, which the
 * editor extension and the Reading view post processor share.
 */
export class CitationPreview {
  #popover: HTMLElement | undefined;
  #anchor: HTMLElement | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #overPopover = false;
  #shown = 0;

  constructor(
    readonly app: App,
    readonly vault: Vault,
    readonly wiki: Wiki,
    private readonly delay = HOVER_DELAY,
  ) {}

  /** Whether a link target is a source note, as the index has it now. */
  isSource(target: string): boolean {
    const path = this.wiki.resolve(target);
    return path !== undefined && this.wiki.note(path)?.type === "source";
  }

  /** Where each part of a citation leads, with its passage, for the popover. */
  async lookup(parts: CitationRef[]): Promise<CitationView[]> {
    const texts = new Map<string, Promise<string>>();
    const out: CitationView[] = [];
    for (const part of parts) {
      const target = await resolveCitation(this.vault, this.wiki, part, texts);
      const view: CitationView = { part, title: target.source ? basename(target.source) : part.target, ...(part.locator && { where: part.locator }), target };
      if (target.problem) view.note = `This citation leads nowhere: ${target.problem}.`;
      else if (target.lines) view.text = await passageText(this.vault, target);
      else if (target.pages && target.file) view.note = `Page ${target.pages.from}${target.pages.to !== target.pages.from ? `–${target.pages.to}` : ""} of the PDF. Open it to read the page.`;
      else if (target.file) view.note = part.locator ? "The passage is not found in the copy. Open the source to look." : "The source, as a whole.";
      else if (target.source) view.note = "The source's file is not in the vault.";
      else view.note = "Not a source of the wiki.";
      out.push(view);
    }
    return out;
  }

  /**
   * Opens the file a citation part names, at its place: a text at the first line of the passage, a PDF at the
   * page, any other file as it is; a source with no file opens the source note.
   */
  async open(part: CitationRef): Promise<void> {
    const target = await resolveCitation(this.vault, this.wiki, part);
    const path = target.file ?? target.source;
    if (!path) return;
    const file = this.app.vault.getFileByPath(path);
    if (!(file instanceof TFile)) return;
    if (target.kind === "pages" && target.pages) {
      await this.app.workspace.openLinkText(`${path}#page=${target.pages.from}`, "");
      return;
    }
    await this.app.workspace.getLeaf(false).openFile(file, target.lines ? { eState: { line: target.lines.from - 1 } } : undefined);
  }

  /** Shows the popover for a marked citation when the pointer rests on one under `root`, and hides it when the pointer leaves. Returns the function that stops watching. */
  watch(root: HTMLElement): () => void {
    const over = (event: Event) => {
      const anchor = (event.target as HTMLElement | null)?.closest?.(`.${CITATION_CLASS}`) as HTMLElement | null;
      if (!anchor || anchor === this.#anchor) return;
      this.#cancel();
      this.#timer = setTimeout(() => void this.show(anchor), this.delay);
    };
    const out = (event: Event) => {
      const anchor = (event.target as HTMLElement | null)?.closest?.(`.${CITATION_CLASS}`);
      if (!anchor) return;
      const to = (event as MouseEvent).relatedTarget as Node | null;
      if (to && (anchor.contains(to) || this.#popover?.contains(to))) return;
      this.#cancel();
      // Leave a moment to reach the popover.
      this.#timer = setTimeout(() => {
        if (!this.#overPopover) this.hide();
      }, 150);
    };
    root.addEventListener("mouseover", over);
    root.addEventListener("mouseout", out);
    return () => {
      root.removeEventListener("mouseover", over);
      root.removeEventListener("mouseout", out);
      this.hide();
    };
  }

  /** The parts a marked citation holds, from its attribute. */
  static partsOf(element: HTMLElement): CitationRef[] {
    try {
      const parsed = JSON.parse(element.getAttribute(CITATION_ATTRIBUTE) ?? "[]") as unknown;
      return Array.isArray(parsed) ? parsed.filter((p): p is CitationRef => typeof p === "object" && p !== null && typeof (p as CitationRef).target === "string") : [];
    } catch {
      return [];
    }
  }

  /** Shows the popover under the citation, with where each of its parts leads. */
  async show(anchor: HTMLElement): Promise<void> {
    const parts = CitationPreview.partsOf(anchor);
    if (!parts.length) return;
    const shown = ++this.#shown;
    const views = await this.lookup(parts);
    // The pointer moved on while the files were read.
    if (shown !== this.#shown) return;
    this.hide();
    this.#anchor = anchor;
    const popover = anchor.ownerDocument.body.createDiv(CITATION_POPOVER_CLASS);
    popover.addEventListener("mouseenter", () => (this.#overPopover = true));
    popover.addEventListener("mouseleave", () => this.hide());
    for (const view of views) {
      const part = popover.createDiv("yami-citation-part");
      const title = part.createEl("a", { cls: "yami-citation-title", text: view.where ? `${view.title} · ${view.where}` : view.title, attr: { role: "button", tabindex: "0" } });
      title.addEventListener("click", (event) => {
        event.preventDefault();
        this.hide();
        void this.open(view.part);
      });
      if (view.text !== undefined) part.createEl("pre", { cls: "yami-citation-text", text: view.text || "(an empty passage)" });
      if (view.note) part.createDiv({ cls: "yami-citation-note", text: view.note });
    }
    const rect = anchor.getBoundingClientRect();
    popover.style.top = `${rect.bottom + 6}px`;
    popover.style.left = `${Math.max(8, rect.left)}px`;
    this.#popover = popover;
  }

  /** Removes the popover, if one shows. */
  hide(): void {
    this.#cancel();
    this.#popover?.remove();
    this.#popover = undefined;
    this.#anchor = undefined;
    this.#overPopover = false;
  }

  /** The popover that shows, for a test. */
  get popover(): HTMLElement | undefined {
    return this.#popover;
  }

  #cancel(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
  }
}

/** The citations of an editor's text that cite a source, grouped by their place, with their parts. */
function markedCitations(preview: CitationPreview, state: EditorState): { from: number; to: number; parts: CitationRef[] }[] {
  const out: { from: number; to: number; parts: CitationRef[] }[] = [];
  for (const citation of citations(state.doc.toString())) {
    const last = out.at(-1);
    const part: CitationRef = { target: citation.target, ...(citation.locator && { locator: citation.locator }) };
    if (last && last.from === citation.from) last.parts.push(part);
    else out.push({ from: citation.from, to: citation.to, parts: [part] });
  }
  return out.filter((c) => c.parts.some((p) => preview.isSource(p.target)));
}

function decorate(preview: CitationPreview, state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to, parts } of markedCitations(preview, state)) {
    builder.add(from, to, Decoration.mark({ class: CITATION_CLASS, attributes: { [CITATION_ATTRIBUTE]: JSON.stringify(parts) } }));
  }
  return builder.finish();
}

/**
 * Marks each citation of a source in the editor with `yami-citation`, and shows where it leads when the pointer
 * rests on it. The marks follow every change of the text.
 */
export function citationExtension(preview: CitationPreview): Extension {
  return ViewPlugin.define(
    (view) => {
      const stop = preview.watch(view.dom);
      return {
        decorations: decorate(preview, view.state),
        update(this: { decorations: DecorationSet }, update: ViewUpdate) {
          if (update.docChanged) this.decorations = decorate(preview, update.state);
        },
        destroy: stop,
      };
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

/**
 * Wraps each citation of a rendered block in a span with `yami-citation`: a `(` before a rendered link, through
 * the `)` after it, with the locator text between. Returns the spans. Rendered text has no positions, so the
 * citation is read from the nodes: the links give their targets, the text between them the locators.
 */
export function wrapCitations(element: HTMLElement, isSource: (target: string) => boolean = () => true): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const link of Array.from(element.querySelectorAll("a.internal-link"))) {
    if (link.closest(`.${CITATION_CLASS}`)) continue;
    const before = link.previousSibling;
    if (!(before instanceof Text) || !/\(\s*$/.test(before.data)) continue;
    const open = before.data.lastIndexOf("(");
    const parts: CitationRef[] = [];
    let node: Node | null = link;
    let locator = "";
    let end: { node: Text; offset: number } | undefined;
    let target = "";
    const close = () => {
      if (target) parts.push({ target, ...(locator.trim() && { locator: locator.replace(/^\s*,?\s*/, "").replace(/\s+/g, " ").trim() }) });
      locator = "";
    };
    while (node) {
      if (node instanceof Text) {
        const stop = node.data.indexOf(")");
        if (stop >= 0) {
          locator += node.data.slice(0, stop);
          close();
          end = { node, offset: stop + 1 };
          break;
        }
        const cut = node.data.indexOf(";");
        if (cut >= 0) {
          locator += node.data.slice(0, cut);
          close();
          locator = node.data.slice(cut + 1);
        } else locator += node.data;
      } else if (node instanceof HTMLElement && node.matches("a.internal-link")) {
        target = node.getAttribute("data-href") ?? node.textContent ?? "";
      } else break;
      node = node.nextSibling;
    }
    if (!end || !parts.length || !parts.some((p) => isSource(p.target))) continue;
    const range = element.ownerDocument.createRange();
    range.setStart(before, open);
    range.setEnd(end.node, end.offset);
    const span = element.ownerDocument.createElement("span");
    span.className = CITATION_CLASS;
    span.setAttribute(CITATION_ATTRIBUTE, JSON.stringify(parts));
    range.surroundContents(span);
    out.push(span);
  }
  return out;
}

/** Marks the citations of a Reading view block and shows where each leads at a hover. */
export function citationPostProcessor(preview: CitationPreview): (element: HTMLElement, context: MarkdownPostProcessorContext) => void {
  return (element) => {
    if (wrapCitations(element, (target) => preview.isSource(target)).length) preview.watch(element);
  };
}
