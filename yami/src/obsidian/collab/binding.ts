import { Annotation, type ChangeSpec, type Transaction as CmTransaction, Transaction } from "@codemirror/state";
import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { editorInfoField, MarkdownView, type TFile } from "obsidian";
import type * as Y from "yjs";
import type { NoteView, SharedNote } from "./shared-note.js";
import { diffOps } from "../../document/text-ops.js";

/** Marks editor transactions that came from the shared note. The value is the Yjs transaction origin. */
export const syncAnnotation = Annotation.define<unknown>();
/** Marks an empty transaction that redraws agent presence. */
export const presenceAnnotation = Annotation.define<true>();

export interface BindingHost {
  bindings: Set<EditorBinding>;
  get(path: string): SharedNote | undefined;
}

/** A range in the editor that follows the user's edits, for example a reply callout before the note is shared. */
export interface TrackedRange {
  from: number;
  to: number;
}

/**
 * Keeps one CodeMirror editor and one shared note in sync. Every Obsidian editor gets a binding;
 * it stays idle until the note that the editor shows becomes shared.
 *
 * Changes from the note reach the editor with `addToHistory: false`, so Cmd+Z undoes only the user's
 * own typing. Sub-editors, such as table cells and embeds, are never bound: they write their text back
 * into the note themselves.
 */
export class EditorBinding implements NoteView {
  note: SharedNote | undefined;
  private readonly tracked = new Set<TrackedRange>();
  private redraw: number | undefined;
  /** Live Preview renders widgets, such as callouts, after the text changes. Cursors re-measure then. */
  private readonly rendered = new MutationObserver(() => this.onPresence());

  constructor(
    readonly view: EditorView,
    private readonly host: BindingHost,
  ) {
    host.bindings.add(this);
    queueMicrotask(() => this.refresh());
  }

  static of(view: EditorView): EditorBinding | undefined {
    return view.plugin(bindingPlugin) ?? undefined;
  }

  /** The Obsidian note that this editor shows, when the editor is the main editor of a Markdown view. */
  get markdownView(): MarkdownView | undefined {
    const info = this.view.state.field(editorInfoField, false);
    if (!(info instanceof MarkdownView)) return undefined;
    return (info.editor as unknown as { cm?: EditorView }).cm === this.view ? info : undefined;
  }

  get file(): TFile | undefined {
    return this.markdownView?.file ?? undefined;
  }

  get visible(): boolean {
    const dom = this.view.dom;
    return dom.isConnected && dom.checkVisibility() && !document.hidden;
  }

  /** Follows a range through the user's edits until `untrack`. */
  track(from: number, to: number): TrackedRange {
    const range = { from, to };
    this.tracked.add(range);
    return range;
  }

  untrack(range: TrackedRange): void {
    this.tracked.delete(range);
  }

  /** Binds to the shared note of the editor's file, or unbinds when the file is no longer shared. */
  refresh(): void {
    const file = this.file;
    const note = file && this.host.get(file.path);
    if (note === this.note) return;
    this.unbind();
    if (note && ![...note.views].some((view) => view !== this && view instanceof EditorBinding)) this.bind(note);
  }

  update(update: ViewUpdate): void {
    for (const range of this.tracked) {
      range.from = update.changes.mapPos(range.from, -1);
      range.to = update.changes.mapPos(range.to, 1);
    }
    // Obsidian sets the editor's file before it replaces the text when a pane opens another note.
    if (this.note && this.file?.path !== this.note.path) {
      this.unbind();
      queueMicrotask(() => this.refresh());
      return;
    }
    if (!this.note || !update.docChanged) return;
    for (const transaction of update.transactions) {
      if (transaction.docChanged && transaction.annotation(syncAnnotation) === undefined) this.applyToNote(transaction);
    }
  }

  destroy(): void {
    const path = this.note?.path;
    this.unbind();
    this.host.bindings.delete(this);
    // Another editor of the same note takes over.
    for (const binding of this.host.bindings) if (path && binding.file?.path === path) binding.refresh();
  }

  private bind(note: SharedNote): void {
    this.note = note;
    note.views.add(this);
    note.text.observe(this.onNoteChange);
    note.presence.on("change", this.onPresence);
    this.rendered.observe(this.view.contentDOM, { childList: true, subtree: true, characterData: true });
    const text = this.view.state.doc.toString();
    if (text !== note.content) {
      this.dispatchSync(
        diffOps(text, note.content).map(({ from, to, insert }) => ({ from, to, insert })),
        undefined,
      );
    }
    this.onPresence();
  }

  private unbind(): void {
    const note = this.note;
    if (!note) return;
    this.note = undefined;
    note.views.delete(this);
    note.text.unobserve(this.onNoteChange);
    note.presence.off("change", this.onPresence);
    this.rendered.disconnect();
    this.onPresence();
  }

  private applyToNote(transaction: CmTransaction): void {
    const note = this.note!;
    // Obsidian replaces the whole text with userEvent "set". Its positions can refer to an older text.
    if (transaction.isUserEvent("set") || note.text.length !== transaction.startState.doc.length) {
      note.applyOps(diffOps(note.content, transaction.newDoc.toString()), this);
      return;
    }
    note.doc.transact(() => {
      let shift = 0;
      transaction.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        const insert = inserted.toString();
        if (toA > fromA) note.text.delete(fromA + shift, toA - fromA);
        if (insert) note.text.insert(fromA + shift, insert);
        shift += insert.length - (toA - fromA);
      });
    }, this);
  }

  private readonly onNoteChange = (event: Y.YTextEvent, transaction: Y.Transaction): void => {
    if (transaction.origin === this) return;
    const changes: { from: number; to: number; insert: string }[] = [];
    let position = 0;
    for (const delta of event.delta) {
      if (typeof delta.insert === "string") {
        const last = changes.at(-1);
        // CodeMirror can drop an insert at the end of a separate delete, so join them.
        if (last && last.to === position && last.from !== last.to && !last.insert) last.insert = delta.insert;
        else changes.push({ from: position, to: position, insert: delta.insert });
      } else if (delta.delete) {
        const last = changes.at(-1);
        if (last && last.from === position && last.to === position) last.to = position + delta.delete;
        else changes.push({ from: position, to: position + delta.delete, insert: "" });
        position += delta.delete;
      } else if (delta.retain) {
        position += delta.retain;
      }
    }
    this.dispatchSync(changes, transaction.origin);
  };

  /**
   * Applies changes that the note already has. Transaction filters must not touch them: Obsidian's Live
   * Preview filters rewrite edits near frontmatter, which would make the editor and the note differ.
   */
  private dispatchSync(changes: ChangeSpec, origin: unknown): void {
    try {
      this.view.dispatch({
        changes,
        filter: false,
        annotations: [syncAnnotation.of(origin), Transaction.addToHistory.of(false), Transaction.remote.of(true)],
      });
    } catch (error) {
      console.error("Yami: could not apply a shared change to the editor", error);
    }
    if (this.note && this.view.state.doc.length !== this.note.text.length) queueMicrotask(() => this.resync());
  }

  /** Makes the editor text equal to the note text. */
  private resync(): void {
    const note = this.note;
    if (!note) return;
    const text = this.view.state.doc.toString();
    if (text !== note.content) this.dispatchSync(diffOps(text, note.content), undefined);
  }

  private readonly onPresence = (): void => {
    if (this.redraw !== undefined) return;
    this.redraw = window.requestAnimationFrame(() => {
      this.redraw = undefined;
      if (this.view.dom.isConnected) this.view.dispatch({ annotations: presenceAnnotation.of(true) });
    });
  };
}

let host: BindingHost | undefined;

/** One binding for each editor. `setBindingHost` must run before editors open. */
export const bindingPlugin = ViewPlugin.define((view) => new EditorBinding(view, host!));

export function setBindingHost(value: BindingHost): void {
  host = value;
}
