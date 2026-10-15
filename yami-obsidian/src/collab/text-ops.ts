import { DIFF_DELETE, DIFF_INSERT, diffCleanupSemantic, diffMain } from "diff-match-patch-es";

/** Replaces the range [from, to) of the original text with `insert`. */
export interface TextOp {
  from: number;
  to: number;
  insert: string;
}

/**
 * Returns the changes that turn `before` into `after`, in ascending order and without overlaps.
 * The diff is cleaned up to word and line boundaries, so each change reads as an edit a person would make.
 */
export function diffOps(before: string, after: string): TextOp[] {
  if (before === after) return [];
  const diffs = diffMain(before, after);
  diffCleanupSemantic(diffs);
  const ops: TextOp[] = [];
  let position = 0;
  for (const [kind, text] of diffs) {
    if (kind === DIFF_DELETE || kind === DIFF_INSERT) {
      const last = ops.at(-1);
      // A delete next to an insert becomes one replacement.
      const op = last && last.to === position ? last : { from: position, to: position, insert: "" };
      if (op !== last) ops.push(op);
      if (kind === DIFF_DELETE) op.to += text.length;
      else op.insert += text;
    }
    if (kind !== DIFF_INSERT) position += text.length;
  }
  return ops;
}

/** Applies ascending, non-overlapping ops to a text. */
export function applyOps(text: string, ops: TextOp[]): string {
  let result = "";
  let position = 0;
  for (const op of ops) {
    result += text.slice(position, op.from) + op.insert;
    position = op.to;
  }
  return result + text.slice(position);
}

/** Turns a Yjs text delta into ascending ops on the text before the change. */
export function deltaOps(delta: { insert?: unknown; delete?: number; retain?: number }[]): TextOp[] {
  const ops: TextOp[] = [];
  let position = 0;
  for (const part of delta) {
    if (part.retain) {
      position += part.retain;
    } else if (part.delete) {
      const last = ops.at(-1);
      if (last && last.to === position) last.to += part.delete;
      else ops.push({ from: position, to: position + part.delete, insert: "" });
      position += part.delete;
    } else if (typeof part.insert === "string") {
      const last = ops.at(-1);
      if (last && last.to === position) last.insert += part.insert;
      else ops.push({ from: position, to: position, insert: part.insert });
    }
  }
  return ops;
}

/** Shifts ops by `offset` characters. */
export function shiftOps(ops: TextOp[], offset: number): TextOp[] {
  return ops.map((op) => ({ from: op.from + offset, to: op.to + offset, insert: op.insert }));
}

export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}
