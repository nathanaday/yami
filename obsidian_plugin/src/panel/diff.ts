// The lines of a diff for the change page, from the library's text ops. No Obsidian, so a unit test runs it.
import { diffOps } from "yami/document";

/** A piece of a line; `mark` says it was inserted or deleted. */
export interface Part {
  text: string;
  mark?: boolean;
}

/** One line of the diff: kept as it was, removed, added, or a run of unchanged lines folded away. */
export type DiffLine = { kind: "same" | "del" | "add"; parts: Part[] } | { kind: "skip"; count: number };

/** The default lines of unchanged context around each change. */
export const CONTEXT = 2;

/**
 * The diff of two texts as lines, with the changed pieces of each line marked, and runs of unchanged lines
 * longer than twice `context` folded to their edges. An empty `before` is all added, an empty `after` all removed.
 */
export function diffLines(before: string, after: string, context = CONTEXT): DiffLine[] {
  return fold(lines(ended(before), ended(after)), context);
}

/** The text with a final newline, so a line added at the end is one added line and not a change to the line before. */
function ended(text: string): string {
  return text && !text.endsWith("\n") ? `${text}\n` : text;
}

/** Each line of both texts: a line that both have as `same`, and otherwise the old line as `del` and the new one as `add`. */
function lines(before: string, after: string): DiffLine[] {
  const out: DiffLine[] = [];
  let old: Part[] = [];
  let neu: Part[] = [];
  let oldChanged = false;
  let newChanged = false;
  const flushOld = () => {
    if (old.length || oldChanged) out.push({ kind: "del", parts: old });
    old = [];
    oldChanged = false;
  };
  const flushNew = () => {
    if (neu.length || newChanged) out.push({ kind: "add", parts: neu });
    neu = [];
    newChanged = false;
  };
  const flushBoth = () => {
    if (!oldChanged && !newChanged && same(old, neu)) {
      out.push({ kind: "same", parts: old });
      old = [];
      neu = [];
      return;
    }
    flushOld();
    flushNew();
  };
  const push = (side: "old" | "new" | "both", text: string, mark: boolean) => {
    const pieces = text.split("\n");
    pieces.forEach((piece, i) => {
      if (piece) {
        if (side !== "new") old.push(mark ? { text: piece, mark } : { text: piece });
        if (side !== "old") neu.push(mark ? { text: piece, mark } : { text: piece });
      }
      const last = i === pieces.length - 1;
      if (mark && (piece || !last)) {
        if (side !== "new") oldChanged = true;
        if (side !== "old") newChanged = true;
      }
      if (last) return;
      if (side === "both") flushBoth();
      else if (side === "old") flushOld();
      else flushNew();
    });
  };
  let at = 0;
  for (const op of diffOps(before, after)) {
    push("both", before.slice(at, op.from), false);
    push("old", before.slice(op.from, op.to), true);
    push("new", op.insert, true);
    at = op.to;
  }
  push("both", before.slice(at), false);
  if (old.length || neu.length || oldChanged || newChanged) flushBoth();
  return out;
}

function same(a: Part[], b: Part[]): boolean {
  return a.map((p) => p.text).join("") === b.map((p) => p.text).join("");
}

/** Folds each run of unchanged lines longer than the context on both sides to its edges, and the ends to one edge. */
function fold(all: DiffLine[], context: number): DiffLine[] {
  const out: DiffLine[] = [];
  let i = 0;
  while (i < all.length) {
    if (all[i]!.kind !== "same") {
      out.push(all[i]!);
      i++;
      continue;
    }
    let j = i;
    while (j < all.length && all[j]!.kind === "same") j++;
    const run = all.slice(i, j);
    const head = i === 0 ? 0 : context;
    const tail = j === all.length ? 0 : context;
    if (run.length > head + tail) {
      out.push(...run.slice(0, head));
      out.push({ kind: "skip", count: run.length - head - tail });
      if (tail) out.push(...run.slice(-tail));
    } else out.push(...run);
    i = j;
  }
  return out;
}
