import { normalizeNewlines, type TextOp } from "./text-ops.js";
import type { Vault } from "./vault.js";

/** The version of the map's form. A file of another version is not read. */
export const PROTECTED_VERSION = 1;

/**
 * One piece of text that a person protected against change by an agent. The mark is the text itself, not
 * a position, so it holds through edits elsewhere in the note, and a note that no longer holds the text
 * has lost the mark.
 */
export interface ProtectedMark {
  /** The protected text, exactly, with `\n` newlines. */
  text: string;
  /** When the person protected it, as `YYYY-MM-DDTHH:MM:SS`. */
  since: string;
  /** The person's note on why, when they gave one. */
  note?: string;
}

/** The map: for each note, by vault path, the texts a person protected in it. */
export interface ProtectedMap {
  version: typeof PROTECTED_VERSION;
  notes: Record<string, ProtectedMark[]>;
}

/** Where a mark's text sits in a note's text. */
export interface ProtectedRange {
  from: number;
  to: number;
  mark: ProtectedMark;
}

export function emptyProtected(): ProtectedMap {
  return { version: PROTECTED_VERSION, notes: {} };
}

/**
 * Reads the map, or an empty one when the vault has none. A file whose JSON does not parse, or of another
 * version, throws, so a broken map is seen and not silently taken as empty.
 */
export async function readProtected(vault: Vault, file = vault.folders.protected): Promise<ProtectedMap> {
  if (!(await vault.exists(file))) return emptyProtected();
  let data: unknown;
  try {
    data = JSON.parse(await vault.read(file));
  } catch (error) {
    throw new Error(`${file} does not parse: ${error instanceof Error ? error.message : String(error)}`);
  }
  const map = data as Partial<ProtectedMap> | null;
  if (!map || map.version !== PROTECTED_VERSION || typeof map.notes !== "object" || map.notes === null) {
    throw new Error(`${file} is not a protected text map of version ${PROTECTED_VERSION}.`);
  }
  const notes: Record<string, ProtectedMark[]> = {};
  for (const [path, marks] of Object.entries(map.notes)) {
    if (!Array.isArray(marks)) continue;
    const kept = marks.filter((mark): mark is ProtectedMark => typeof mark?.text === "string" && mark.text.length > 0 && typeof mark.since === "string");
    if (kept.length) notes[path] = kept;
  }
  return { version: PROTECTED_VERSION, notes };
}

/** Writes the map, also an empty one: a file that says nothing is protected is not a missing file. */
export async function writeProtected(vault: Vault, map: ProtectedMap, file = vault.folders.protected): Promise<void> {
  await vault.write(file, `${JSON.stringify(map, null, 2)}\n`);
}

/** The marks of a note, in the order they were made. */
export function marksOf(map: ProtectedMap, path: string): ProtectedMark[] {
  return map.notes[path] ?? [];
}

/** The text of a mark as the map keeps it: `\n` newlines, and no space at either end. */
function clean(text: string): string {
  return normalizeNewlines(text).trim();
}

/**
 * The map with a text of a note protected. It throws for an empty text, and for a text that the body does
 * not hold when a body is given. A text that a mark holds already adds nothing; a text that holds a mark
 * replaces it. Returns a new map; the one given is not changed.
 */
export function protect(map: ProtectedMap, path: string, text: string, options: { since?: string; note?: string; body?: string } = {}): ProtectedMap {
  const value = clean(text);
  if (!value) throw new Error("The text to protect is empty.");
  if (options.body !== undefined && !normalizeNewlines(options.body).includes(value)) throw new Error(`The note does not hold the text "${excerpt(value)}".`);
  const marks = marksOf(map, path);
  if (marks.some((mark) => mark.text.includes(value))) return map;
  const since = options.since ?? new Date().toISOString().slice(0, 19);
  const mark: ProtectedMark = { text: value, since, ...(options.note?.trim() && { note: options.note.trim() }) };
  return { ...map, notes: { ...map.notes, [path]: [...marks.filter((m) => !value.includes(m.text)), mark] } };
}

/**
 * The map without the marks of a note that the text touches: a mark whose text the given text holds, or
 * that holds the given text. With no text, every mark of the note. Returns a new map.
 */
export function unprotect(map: ProtectedMap, path: string, text?: string): ProtectedMap {
  const value = text === undefined ? undefined : clean(text);
  const kept = value ? marksOf(map, path).filter((mark) => !mark.text.includes(value) && !value.includes(mark.text)) : [];
  const notes = { ...map.notes };
  if (kept.length) notes[path] = kept;
  else delete notes[path];
  return { ...map, notes };
}

/** The map with a note's marks under its new path, after a rename. */
export function renameProtected(map: ProtectedMap, from: string, to: string): ProtectedMap {
  if (!(from in map.notes)) return map;
  const { [from]: marks, ...rest } = map.notes;
  return { ...map, notes: { ...rest, [to]: marks! } };
}

/** The marks of a note that a text no longer holds. */
export function protectedLost(map: ProtectedMap, path: string, text: string): ProtectedMark[] {
  const body = normalizeNewlines(text);
  return marksOf(map, path).filter((mark) => !body.includes(mark.text));
}

/** Where each mark of a note sits in a text: the first place it occurs. A mark the text does not hold has no range. */
export function protectedRanges(marks: ProtectedMark[], text: string): ProtectedRange[] {
  const body = normalizeNewlines(text);
  const ranges: ProtectedRange[] = [];
  for (const mark of marks) {
    const from = body.indexOf(mark.text);
    if (from !== -1) ranges.push({ from, to: from + mark.text.length, mark });
  }
  return ranges.sort((a, b) => a.from - b.from || a.to - b.to);
}

/** Whether a change of the range [from, to) touches a protected range: it overlaps it, or inserts strictly inside it. An edit at either edge does not. */
export function touches(range: { from: number; to: number }, change: { from: number; to: number }): boolean {
  if (change.from === change.to) return change.from > range.from && change.from < range.to;
  return change.from < range.to && change.to > range.from;
}

/**
 * The map after a person edited protected text: each mark whose range the ops touch takes the text of its
 * range after the change, so the mark follows the edit. A mark that is emptied is removed. The ranges are
 * those of `protectedRanges` in the text before the ops. Returns a new map.
 */
export function followEdit(map: ProtectedMap, path: string, before: string, ops: TextOp[]): ProtectedMap {
  const marks = marksOf(map, path);
  if (!marks.length || !ops.length) return map;
  const ranges = protectedRanges(marks, before);
  const after = applyShift(before, ops);
  const next: ProtectedMark[] = [];
  for (const range of ranges) {
    const { from, to } = mapThrough(range, ops);
    const text = clean(after.slice(from, Math.max(from, to)));
    if (text) next.push(text === range.mark.text ? range.mark : { ...range.mark, text });
  }
  // A mark the text did not hold before the edit stays as it is: it is lost, and lint says so.
  for (const mark of marks) if (!ranges.some((r) => r.mark === mark)) next.push(mark);
  const notes = { ...map.notes };
  if (next.length) notes[path] = next;
  else delete notes[path];
  return { ...map, notes };
}

function applyShift(text: string, ops: TextOp[]): string {
  let result = "";
  let position = 0;
  for (const op of ops) {
    result += text.slice(position, op.from) + op.insert;
    position = op.to;
  }
  return result + text.slice(position);
}

/** A range mapped through ascending ops on the text it was in: where the same text sits after them. Text inserted at either edge stays outside. */
export function mapThrough(range: { from: number; to: number }, ops: TextOp[]): { from: number; to: number } {
  const from = mapPosition(range.from, ops, "start");
  return { from, to: Math.max(from, mapPosition(range.to, ops, "end")) };
}

/** A position mapped through ascending ops: a start moves after text inserted at it, an end before, and a position inside a deleted range goes to its start. */
function mapPosition(position: number, ops: TextOp[], side: "start" | "end"): number {
  let shift = 0;
  for (const op of ops) {
    if (op.from >= position && !(side === "start" && op.from === position && op.to === op.from)) break;
    if (op.to <= position) {
      if (side === "end" && op.from === op.to && op.from === position) break;
      shift += op.insert.length - (op.to - op.from);
      continue;
    }
    // The position is inside the replaced range: it goes to the range's start, plus the insert for an end.
    return op.from + shift + (side === "end" ? op.insert.length : 0);
  }
  return position + shift;
}

/** The start of a text, for a message. */
export function excerpt(text: string, length = 60): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > length ? `${line.slice(0, length - 1)}…` : line;
}
