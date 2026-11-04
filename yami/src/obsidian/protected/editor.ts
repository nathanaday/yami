import { EditorState, type Extension, StateEffect, StateField, Transaction } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { editorInfoField, type MarkdownPostProcessorContext } from "obsidian";
import { touches } from "../../document/protected.js";
import type { TextOp } from "../../document/text-ops.js";
import { syncAnnotation } from "../collab/binding.js";
import type { ProtectedStore } from "./store.js";

/** The class of protected text in the editor, and of a Reading view block that holds some. */
export const PROTECTED_CLASS = "yami-protected";
export const PROTECTED_BLOCK_CLASS = "yami-protected-block";

const refresh = StateEffect.define<null>();
const mark = Decoration.mark({ class: PROTECTED_CLASS, attributes: { title: "Protected text: an agent may not change it, and your edits are dropped unless Toggle editing of protected text is on." } });

/** The note that an editor shows, from Obsidian's editor info. */
function pathOf(state: EditorState): string | undefined {
  const info = state.field(editorInfoField, false) as { file?: { path?: string } | null } | undefined;
  return info?.file?.path;
}

/** Whether a transaction came from the shared note or another program, not from the person's typing. */
function fromElsewhere(tr: Transaction): boolean {
  return tr.annotation(syncAnnotation) !== undefined || tr.annotation(Transaction.remote) === true;
}

/**
 * Marks the protected text of the note in the editor, and keeps the person's edits out of it in `block`
 * mode or moves the marks with them in `track` mode. The marks come from the store by content, so they are
 * found again after every change; a change of the map redraws them.
 */
export function protectedExtension(store: ProtectedStore): Extension {
  const field = StateField.define<DecorationSet>({
    create: (state) => decorate(store, state),
    update: (marks, tr) => (tr.docChanged || tr.effects.some((e) => e.is(refresh)) ? decorate(store, tr.state) : marks),
    provide: (f) => EditorView.decorations.from(f),
  });

  const filter = EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged || fromElsewhere(tr) || store.editing === "track") return tr;
    const path = pathOf(tr.startState);
    if (!path || !store.marks(path).length) return tr;
    const ranges = store.ranges(path, tr.startState.doc.toString());
    let blocked = false;
    tr.changes.iterChanges((from, to) => {
      if (ranges.some((range) => touches(range, { from, to }))) blocked = true;
    });
    if (!blocked) return tr;
    store.blocked(path);
    return [];
  });

  const follow = EditorView.updateListener.of((update: ViewUpdate) => {
    if (!update.docChanged || store.editing !== "track") return;
    const path = pathOf(update.startState);
    if (!path || !store.marks(path).length) return;
    const own = update.transactions.filter((tr) => tr.docChanged && !fromElsewhere(tr));
    if (!own.length) return;
    const before = update.startState.doc.toString();
    const ops: TextOp[] = [];
    update.changes.iterChanges((from, to, _fromB, _toB, inserted) => ops.push({ from, to, insert: inserted.toString() }));
    const ranges = store.ranges(path, before);
    if (ops.some((op) => ranges.some((range) => touches(range, op)))) store.follow(path, before, ops);
  });

  const redraw = ViewPlugin.define((view) => {
    const stop = store.onChange((path) => {
      if (path === undefined || path === pathOf(view.state)) view.dispatch({ effects: refresh.of(null) });
    });
    return { destroy: stop };
  });

  return [field, filter, follow, redraw];
}

function decorate(store: ProtectedStore, state: EditorState): DecorationSet {
  const path = pathOf(state);
  if (!path) return Decoration.none;
  const ranges = store.ranges(path, state.doc.toString());
  return Decoration.set(ranges.map((range) => mark.range(range.from, range.to)));
}

/** Marks a Reading view block that holds protected text with `yami-protected-block`. The rendered text has no positions, so the block is marked as a whole. */
export function protectedPostProcessor(store: ProtectedStore): (element: HTMLElement, context: MarkdownPostProcessorContext) => void {
  return (element, context) => {
    const marks = store.marks(context.sourcePath);
    if (!marks.length) return;
    const info = context.getSectionInfo(element);
    if (!info) return;
    const section = info.text.split("\n").slice(info.lineStart, info.lineEnd + 1).join("\n");
    if (marks.some((m) => section.includes(m.text))) element.addClass(PROTECTED_BLOCK_CLASS);
  };
}
