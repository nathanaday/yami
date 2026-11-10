import { DIFF_DELETE, DIFF_EQUAL, DIFF_INSERT, diffCharsToLines, diffLinesToChars, diffMain } from "diff-match-patch-es";
import { linkTarget, readDocument } from "../document/document.js";
import type { Vault } from "../document/vault.js";
import { citations, parseLocator } from "./citations.js";
import { lineChunks, sourceChunks, sourceFile, type SourceChunk, type SourceChunks } from "./source.js";
import type { Note, Wiki } from "./wiki.js";

/** A run of lines, from 1, both ends included. */
export interface LineRange {
  from: number;
  to: number;
}

/** How two texts differ, line by line: where each old line went, and which runs changed. */
export interface LineDelta {
  /** For each old line, from 1, the new line it became, or 0 when the line changed or went. Index 0 is unused. */
  map: Int32Array;
  /** The runs of the new text that are new or changed. */
  changed: LineRange[];
  /** The runs of the old text that are gone or changed. */
  removed: LineRange[];
}

/** Lines of unchanged text read around each changed run, so a worker sees the passage whole. */
export const CONTEXT_LINES = 20;

/** The line diff of two texts: where each old line went, the changed runs of the new text, and the removed runs of the old. */
export function lineDelta(before: string, after: string): LineDelta {
  // A newline at the very end is form, not a line: with or without it, the last line is the same line.
  before = before.replace(/\n$/, "");
  after = after.replace(/\n$/, "");
  const { chars1, chars2, lineArray } = diffLinesToChars(before, after);
  const diffs = diffMain(chars1, chars2, { diffTimeout: 0 }, false);
  diffCharsToLines(diffs, lineArray);
  const oldCount = before.split("\n").length;
  const map = new Int32Array(oldCount + 1);
  const changed: LineRange[] = [];
  const removed: LineRange[] = [];
  let oldLine = 1;
  let newLine = 1;
  const push = (runs: LineRange[], from: number, to: number) => {
    const last = runs.at(-1);
    if (last && last.to + 1 >= from) last.to = Math.max(last.to, to);
    else runs.push({ from, to });
  };
  for (const [kind, text] of diffs) {
    const count = lines(text);
    if (!count) continue;
    if (kind === DIFF_EQUAL) {
      for (let i = 0; i < count; i++) map[oldLine + i] = newLine + i;
      oldLine += count;
      newLine += count;
    } else if (kind === DIFF_DELETE) {
      push(removed, oldLine, oldLine + count - 1);
      oldLine += count;
    } else if (kind === DIFF_INSERT) {
      push(changed, newLine, newLine + count - 1);
      newLine += count;
    }
  }
  return { map, changed, removed };
}

/** The lines a diff run holds: each `\n` ends one, and a last line without one counts. */
function lines(text: string): number {
  if (!text) return 0;
  const breaks = text.split("\n").length - 1;
  return text.endsWith("\n") ? breaks : breaks + 1;
}

/** The runs of the new text that a worker reads: each changed run with its context, joined when they touch. */
export function changedRuns(delta: LineDelta, lineCount: number, context = CONTEXT_LINES): LineRange[] {
  const runs: LineRange[] = [];
  for (const run of delta.changed) {
    const from = Math.max(1, run.from - context);
    const to = Math.min(lineCount, run.to + context);
    const last = runs.at(-1);
    if (last && last.to + 1 >= from) last.to = Math.max(last.to, to);
    else runs.push({ from, to });
  }
  return runs;
}

/** Where a citation of the superseded source stands against the new text. */
export interface MovedCitation {
  /** The topic that holds it. */
  topic: string;
  /** The citation as written. */
  text: string;
  /** Its locator in the old source, when it has one. */
  locator?: string;
  /** The claim the citation ends. */
  claim: string;
  /**
   * `kept`: the passage is unchanged, and `moved` is its locator in the new source; `changed`: the passage
   * changed or went, so the claim must be read against the new text; `unknown`: the locator is not a line
   * range, so the drafter looks.
   */
  status: "kept" | "changed" | "unknown";
  /** The locator in the new source, for a kept citation with a line range. */
  moved?: string;
}

/** The old line range mapped through the delta, when every line of it is unchanged and still in one run. */
export function mapRange(delta: LineDelta, range: LineRange): LineRange | undefined {
  const from = delta.map[range.from];
  if (!from) return undefined;
  for (let line = range.from; line <= range.to; line++) {
    const mapped = delta.map[line];
    if (!mapped || mapped !== from + (line - range.from)) return undefined;
  }
  return { from, to: from + (range.to - range.from) };
}

/**
 * The citations of the topics that cite the old source, each with where it stands against the new text:
 * kept with its new locator, changed, or unknown. With no delta (the files are not texts), every citation
 * with a locator is unknown, and a bare link is kept.
 */
export function movedCitations(wiki: Wiki, oldSource: string, delta: LineDelta | undefined): MovedCitation[] {
  const out: MovedCitation[] = [];
  const topics = wiki.notes.filter((note): note is Note => wiki.isPage(note) && note.links.includes(oldSource));
  for (const topic of topics) {
    for (const citation of citations(topic.body)) {
      if (wiki.resolve(citation.target) !== oldSource) continue;
      const base = { topic: topic.path, text: citation.text, ...(citation.locator && { locator: citation.locator }), claim: citation.claim };
      if (!citation.locator) {
        out.push({ ...base, status: "kept" });
        continue;
      }
      const where = parseLocator(citation.locator);
      if (!delta || where.kind !== "line" || !where.from) {
        out.push({ ...base, status: "unknown" });
        continue;
      }
      const mapped = mapRange(delta, { from: where.from, to: where.to ?? where.from });
      if (mapped) out.push({ ...base, status: "kept", moved: mapped.from === mapped.to ? `line ${mapped.from}` : `lines ${mapped.from}-${mapped.to}` });
      else out.push({ ...base, status: "changed" });
    }
  }
  return out;
}

/** The chunks of a source that supersedes another, with where each citation of the old source stands. */
export interface DeltaChunks extends SourceChunks {
  /** The source this one supersedes: the earlier capture of the same file. */
  supersedes?: string;
  /**
   * Whether the chunks are the changed passages alone. True when both copies are texts: the workers read
   * only what changed, and `citations` says where each old citation stands. False when they are not, such
   * as two PDFs: the chunks are the whole file, and every cited passage is unknown.
   */
  delta?: boolean;
  /** The runs of the old text that are gone or changed, for the drafter to find the claims cited to them. */
  removed?: LineRange[];
  /** The citations of the superseded source in the topics, each with where it stands against the new text. */
  citations?: MovedCitation[];
}

/**
 * The chunks of a source for the workers of an ingest, as `sourceChunks` gives them, and for a source that
 * supersedes an earlier capture of its file, the delta: when both copies are texts, only the changed passages,
 * each with `CONTEXT_LINES` around it, and the citations of the old source mapped to the new text. A file
 * whose text did not change gives no chunk. `wiki_chunks` calls it.
 */
export async function deltaChunks(vault: Vault, wiki: Wiki, source: string): Promise<DeltaChunks> {
  const whole = await sourceChunks(vault, wiki, source);
  const supersedes = linkTarget(String((await readDocument(vault, whole.source)).properties.supersedes ?? ""));
  const old = supersedes ? wiki.resolve(supersedes) : undefined;
  if (!old || wiki.note(old)?.type !== "source") return whole;
  let oldFile;
  try {
    oldFile = await sourceFile(vault, wiki, old);
  } catch {
    return { ...whole, supersedes: old, delta: false, citations: movedCitations(wiki, old, undefined) };
  }
  if (whole.kind !== "lines" || oldFile.kind !== "lines") return { ...whole, supersedes: old, delta: false, citations: movedCitations(wiki, old, undefined) };
  const before = await vault.read(oldFile.file);
  const after = await vault.read(whole.file);
  const delta = lineDelta(before, after);
  const lines = after.split("\n");
  const chunks: SourceChunk[] = [];
  for (const run of changedRuns(delta, lines.length)) {
    for (const chunk of lineChunks(lines.slice(run.from - 1, run.to))) chunks.push({ ...chunk, from: run.from + chunk.from! - 1, to: run.from + chunk.to! - 1 });
  }
  const numbered = chunks.map((chunk, i) => ({ ...chunk, index: i + 1, count: chunks.length, locator: `lines ${chunk.from}-${chunk.to}` }));
  return { ...whole, chunks: numbered, supersedes: old, delta: true, removed: delta.removed, citations: movedCitations(wiki, old, delta) };
}
