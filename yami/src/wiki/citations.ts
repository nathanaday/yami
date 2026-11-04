import { linkTarget } from "../document/document.js";
import type { Vault } from "../document/vault.js";
import { ORIGINALS } from "./folders.js";
import { selectNotes, type Finding, type LintOptions } from "./lint.js";
import { countPages, sourceFile, type SourceFile } from "./source.js";
import type { Note, Wiki } from "./wiki.js";

/**
 * A citation in a topic: a parenthesis that starts with a link, as the drafter writes one after a claim.
 * `([[DINOv2]], p. 3)` cites one source at one place; `([[A]], p. 3; [[B]], slide 4)` cites two, and
 * gives two citations with the same text and range. A parenthesis that starts with a word, such as
 * `(see [[Decoder]])`, is prose, not a citation.
 */
export interface Citation {
  /** The citation as written, parentheses included. */
  text: string;
  /** Where it stands in the body, as offsets. */
  from: number;
  to: number;
  /** The link's target: a path or a name, as the wiki resolves it. */
  target: string;
  /** Where in the source: `p. 3`, `pp. 3-5`, `slide 4`, `lines 12-40`, `§ 2.1`, `Figure 2`. Absent for a bare link. */
  locator?: string;
  /** The sentence the citation ends, up to the citation: what the source must support. */
  claim: string;
}

/** A locator read: pages, slides, lines, or a part the text names, with the range when it has one. */
export interface Locator {
  text: string;
  kind: "page" | "slide" | "line" | "section" | "figure" | "table" | "other";
  /** The first and last page, slide, or line, when the locator counts them. */
  from?: number;
  to?: number;
  /** The name of a section, a figure, or a table. */
  name?: string;
}

const PART = String.raw`\[\[[^\]]+\]\][^;()\[\]]*`;
/** The citations of a body: a parenthesis that opens on a link, with parts cut by `;`. */
export const CITATION = new RegExp(String.raw`\(\s*(${PART}(?:;\s*${PART})*)\)`, "g");
const LINK_PART = /^(\[\[[^\]]+\]\])\s*,?\s*(.*)$/s;

/** The citations of a topic's body, in order, outside its code blocks and its Notes section. */
export function citations(body: string): Citation[] {
  const out: Citation[] = [];
  for (const { from, to } of visibleRanges(body)) {
    const text = body.slice(from, to);
    for (const match of text.matchAll(CITATION)) {
      const start = from + match.index;
      const claim = claimBefore(body, start);
      for (const part of match[1]!.split(";")) {
        const parsed = LINK_PART.exec(part.trim());
        if (!parsed) continue;
        const locator = parsed[2]!.replace(/\s+/g, " ").trim();
        out.push({ text: match[0], from: start, to: start + match[0].length, target: linkTarget(parsed[1]!), ...(locator && { locator }), claim });
      }
    }
  }
  return out;
}

/** The ranges of a body outside its fenced code blocks and its Notes section, as offsets. */
export function visibleRanges(body: string): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  let fence: string | undefined;
  let notes = false;
  let offset = 0;
  let open: number | undefined;
  const close = (at: number) => {
    if (open !== undefined && at > open) out.push({ from: open, to: at });
    open = undefined;
  };
  for (const line of body.split("\n")) {
    const opened = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    let skip = false;
    if (fence) {
      if (opened && opened[0] === fence[0] && opened.length >= fence.length) fence = undefined;
      skip = true;
    } else if (opened) {
      fence = opened;
      skip = true;
    } else {
      if (/^ {0,3}##(?:[ \t]|$)/.test(line)) notes = /^ {0,3}##[ \t]+Notes\s*$/.test(line);
      skip = notes;
    }
    if (skip) close(offset);
    else open ??= offset;
    offset += line.length + 1;
  }
  close(Math.min(offset, body.length));
  return out;
}

/** The sentence that ends at `at`: from the last sentence end or the start of the line, without a list marker or a heading mark. */
export function claimBefore(body: string, at: number): string {
  const lineStart = body.lastIndexOf("\n", at - 1) + 1;
  const line = body.slice(lineStart, at);
  let start = 0;
  for (const match of line.matchAll(/[.!?]["”’)]?\s+(?=\S)/g)) {
    const end = match.index + match[0].length;
    if (end < line.length) start = end;
  }
  return line
    .slice(start)
    .replace(/^\s*(?:[-*+]|\d+[.)]|#{1,6}|>)\s+/, "")
    .replace(/^\*Figure:\s*/i, "")
    .trim();
}

const RANGE = String.raw`(\d+)(?:\s*(?:-|–|—|to)\s*(\d+))?`;
const LOCATORS: [RegExp, Locator["kind"]][] = [
  [new RegExp(String.raw`^(?:pp?\.?|pages?)\s*${RANGE}$`, "i"), "page"],
  [new RegExp(String.raw`^slides?\s*${RANGE}$`, "i"), "slide"],
  [new RegExp(String.raw`^(?:l\.|ll\.|lines?)\s*${RANGE}$`, "i"), "line"],
];

/** Reads a locator: `p. 3`, `pp. 3-5`, `page 3`, `slides 4-6`, `lines 12-40`, `§ 2.1`, `section 2.1`, `Figure 2`, `Table 1`, or anything else as `other`. */
export function parseLocator(text: string): Locator {
  const clean = text.replace(/\s+/g, " ").trim().replace(/[.,;]+$/, "");
  for (const [pattern, kind] of LOCATORS) {
    const match = pattern.exec(clean);
    if (match) {
      const from = Number(match[1]);
      const to = match[2] ? Number(match[2]) : from;
      return { text: clean, kind, from: Math.min(from, to), to: Math.max(from, to) };
    }
  }
  const named = /^(§+|sections?|sec\.|ch\.|chapters?|figures?|fig\.|tables?)\s*(.+)$/i.exec(clean);
  if (named) {
    const word = named[1]!.toLowerCase();
    const kind: Locator["kind"] = word.startsWith("fig") ? "figure" : word.startsWith("tab") ? "table" : "section";
    return { text: clean, kind, name: named[2]!.trim() };
  }
  // A page range with a part after it, "p. 4, Figure 2", is read by its first part.
  const comma = clean.indexOf(",");
  if (comma > 0) {
    const first = parseLocator(clean.slice(0, comma));
    if (first.kind !== "other") return { ...first, text: clean };
  }
  return { text: clean, kind: "other" };
}

/** How far a source's file goes: its lines and its slides for a text, its pages for a PDF when they are known, nothing for another file. */
export interface Extent {
  /** Lines of a text file. */
  lines?: number;
  /** Slides of a captured deck: the `## Slide N` headings of its text. */
  slides?: number;
  /** Pages of a PDF. Absent when the PDF hides its page objects. */
  pages?: number;
}

/** A source's file and how far it goes. */
export type SourceExtent = SourceFile & Extent;

const extents = new WeakMap<Wiki, Map<string, Promise<SourceExtent>>>();

/**
 * The file a source cites, and how far it goes, for a locator to be checked against. A frozen copy never
 * changes, so its extent is read once per wiki; any other file is read each time.
 */
export async function sourceExtent(vault: Vault, wiki: Wiki, source: string): Promise<SourceExtent> {
  let cache = extents.get(wiki);
  if (!cache) extents.set(wiki, (cache = new Map()));
  const file = await sourceFile(vault, wiki, source);
  const frozen = file.file.startsWith(`${ORIGINALS}/`);
  const cached = frozen ? cache.get(file.file) : undefined;
  if (cached) return cached;
  const read = (async (): Promise<SourceExtent> => {
    if (file.kind === "lines") {
      const text = await vault.read(file.file);
      const lines = text.split("\n");
      const slides = lines.filter((line) => /^## Slide \d+/.test(line)).length;
      return { ...file, lines: lines.length, ...(slides && { slides }) };
    }
    if (file.kind === "pages") {
      const pages = countPages(await vault.readBinary(file.file));
      return { ...file, ...(pages && { pages }) };
    }
    return file;
  })();
  if (frozen) cache.set(file.file, read);
  return read;
}

/** A passage of a text file at a locator: its lines, from 1, and their text. Nothing when the locator names no part of the text. */
export interface Passage {
  from: number;
  to: number;
  text: string;
}

/** How many lines a passage shows at most, for a locator that names a part rather than lines. */
export const PASSAGE_LINES = 40;

/**
 * The passage of a text at a locator: the lines of a line range; a slide from its `## Slide N` heading to the
 * next; a section from the heading that holds its name or number to the next heading of its level; a figure or
 * a table from the line that names it. Nothing for a page, which a text has no notion of, or a part the text does
 * not hold.
 */
export function passage(text: string, locator: Locator | string): Passage | undefined {
  const where = typeof locator === "string" ? parseLocator(locator) : locator;
  const lines = text.split("\n");
  const cut = (from: number, to: number): Passage => ({ from, to, text: lines.slice(from - 1, to).join("\n") });
  if (where.kind === "line" && where.from) {
    if (where.from > lines.length) return undefined;
    return cut(where.from, Math.min(where.to ?? where.from, lines.length));
  }
  if (where.kind === "slide" && where.from) {
    const start = lines.findIndex((line) => new RegExp(`^## Slide ${where.from}(?:\\D|$)`).test(line));
    if (start < 0) return undefined;
    let end = lines.findIndex((line, i) => i > start && /^## Slide \d+/.test(line) && Number(/^## Slide (\d+)/.exec(line)![1]) > (where.to ?? where.from!));
    if (end < 0) end = lines.length;
    return cut(start + 1, end);
  }
  if (where.kind === "section" && where.name) {
    const wanted = where.name.toLowerCase().replace(/[.\s]+$/, "");
    const start = lines.findIndex((line) => {
      const heading = /^(#{1,6})\s+(.*)$/.exec(line);
      if (!heading) return false;
      const title = heading[2]!.toLowerCase();
      return title === wanted || title.startsWith(`${wanted} `) || title.startsWith(`${wanted}.`) || title.startsWith(`${wanted}:`) || title.includes(wanted);
    });
    if (start < 0) return undefined;
    const level = /^(#{1,6})/.exec(lines[start]!)![1]!.length;
    let end = lines.findIndex((line, i) => i > start && new RegExp(`^#{1,${level}}\\s`).test(line));
    if (end < 0) end = lines.length;
    return cut(start + 1, Math.min(end, start + PASSAGE_LINES));
  }
  if ((where.kind === "figure" || where.kind === "table") && where.name) {
    const label = new RegExp(`\\b${where.kind}\\s*${where.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    const start = lines.findIndex((line) => label.test(line));
    if (start < 0) return undefined;
    return cut(start + 1, Math.min(lines.length, start + 12));
  }
  return undefined;
}

/** A citation of a topic with where it leads: the source note, its file, and the lines to read when the file is a text. */
export interface ResolvedCitation extends Citation {
  /** The source note's path, when the target is one. */
  source?: string;
  /** The file to read: the frozen copy, or its text. */
  file?: string;
  /** What the file is read by: lines of a text, pages of a PDF, or whole. */
  kind?: SourceFile["kind"];
  /** The lines of the file the locator names, for a text. */
  lines?: { from: number; to: number };
  /** The pages the locator names, for a PDF. */
  pages?: { from: number; to: number };
  /** Why the citation cannot be followed: the target is no note, no source, or the locator is past the file. */
  problem?: string;
}

/** What a citation names: a link target, and a locator when it has one. */
export type CitationRef = Pick<Citation, "target" | "locator">;

/** Where one citation leads: the source, its file, and the part of the file, as `ResolvedCitation` has them. */
export type CitationTarget = Pick<ResolvedCitation, "source" | "file" | "kind" | "lines" | "pages" | "problem">;

/**
 * Where a citation leads: the source note, its file, and the lines or pages its locator names. A citation
 * whose target is no note, no source (with a locator), or whose locator is past the file says so in `problem`.
 * `texts` caches the files read, for the citations of one topic.
 */
export async function resolveCitation(vault: Vault, wiki: Wiki, citation: CitationRef, texts = new Map<string, Promise<string>>()): Promise<CitationTarget> {
  const path = wiki.resolve(citation.target);
  if (!path) return { problem: `[[${citation.target}]] is not a note` };
  const target = wiki.note(path);
  if (target?.type !== "source") return citation.locator ? { problem: `[[${citation.target}]] is not a source` } : {};
  let extent: SourceExtent;
  try {
    extent = await sourceExtent(vault, wiki, path);
  } catch {
    // A source whose file is not in the vault is the source note's problem, not the citation's.
    return { source: path };
  }
  const resolved: CitationTarget = { source: path, file: extent.file, kind: extent.kind };
  if (!citation.locator) return resolved;
  const where = parseLocator(citation.locator);
  const text = () => {
    if (!texts.has(extent.file)) texts.set(extent.file, vault.read(extent.file));
    return texts.get(extent.file)!;
  };
  if (where.kind === "page" && extent.kind === "pages") {
    resolved.pages = { from: where.from!, to: where.to! };
    if (extent.pages && where.from! > extent.pages) resolved.problem = `its copy has ${extent.pages} page${extent.pages === 1 ? "" : "s"}`;
  } else if (where.kind === "page" && extent.kind === "lines" && extent.slides) {
    resolved.problem = "its copy is a deck, cited by slide";
  } else if (where.kind === "slide" && extent.kind === "lines") {
    if (!extent.slides) resolved.problem = "its copy has no slides";
    else if (where.from! > extent.slides) resolved.problem = `its copy has ${extent.slides} slide${extent.slides === 1 ? "" : "s"}`;
    else {
      const found = passage(await text(), where);
      if (found) resolved.lines = { from: found.from, to: found.to };
    }
  } else if (where.kind === "line" && extent.kind === "lines") {
    if (extent.lines !== undefined && where.from! > extent.lines) resolved.problem = `its copy has ${extent.lines} line${extent.lines === 1 ? "" : "s"}`;
    else resolved.lines = { from: where.from!, to: Math.min(where.to!, extent.lines ?? where.to!) };
  } else if ((where.kind === "section" || where.kind === "figure" || where.kind === "table") && extent.kind === "lines") {
    const found = passage(await text(), where);
    if (found) resolved.lines = { from: found.from, to: found.to };
  }
  return resolved;
}

/**
 * The citations of a topic, each with the source it leads to and the part of its file to read. A citation
 * whose target is no source, or whose locator is past the file, says so in `problem`. `wiki_citations` gives
 * this to the verifier, and lint reads the problems as `bad-citation`.
 */
export async function resolveCitations(vault: Vault, wiki: Wiki, note: Note): Promise<ResolvedCitation[]> {
  const texts = new Map<string, Promise<string>>();
  const out: ResolvedCitation[] = [];
  for (const citation of citations(note.body)) out.push({ ...citation, ...(await resolveCitation(vault, wiki, citation, texts)) });
  return out;
}

/** The text of the lines a resolved citation names, at most `PASSAGE_LINES` of them, for a preview. Nothing for a PDF or a citation with no lines. */
export async function passageText(vault: Vault, resolved: CitationTarget): Promise<string | undefined> {
  if (!resolved.file || !resolved.lines) return undefined;
  const lines = (await vault.read(resolved.file)).split("\n");
  return lines.slice(resolved.lines.from - 1, Math.min(resolved.lines.to, resolved.lines.from - 1 + PASSAGE_LINES)).join("\n");
}

/**
 * The citations that lead nowhere, as findings: a locator on a note that is not a source, and a page, slide,
 * or line past the end of the source's copy. Each is a warning, `bad-citation`, since a locator the code cannot
 * read is not checked. A dead link is `dead-link`'s, not this check's.
 */
export async function lintCitations(wiki: Wiki, options: LintOptions = {}): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const note of selectNotes(wiki, options)) {
    if (note.type !== "topic") continue;
    const bad = (await resolveCitations(wiki.vault, wiki, note)).filter((c) => c.problem && wiki.resolve(c.target));
    if (!bad.length) continue;
    const shown = bad.slice(0, 3).map((c) => `${c.text}: ${c.problem}`);
    findings.push({
      path: note.path,
      check: "bad-citation",
      severity: "warning",
      message: `has ${bad.length} citation${bad.length === 1 ? "" : "s"} that lead${bad.length === 1 ? "s" : ""} nowhere: ${shown.join("; ")}${bad.length > 3 ? "; …" : ""}`,
      fix: "cite the source note at a place its copy has, or run a verify session on the topic (Wiki: new verify), which reads each citation and proposes the fix",
    });
  }
  return findings;
}
