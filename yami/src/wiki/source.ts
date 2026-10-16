import { link, linkTarget, readDocument, writeDocument } from "../document/document.js";
import { timestamp } from "../document/schema.js";
import type { Vault } from "../document/vault.js";
import { ORIGINALS, SOURCES, WIKI, WIKI_INTERNAL } from "./folders.js";
import type { Wiki } from "./wiki.js";

/** How many hex characters of the content hash name a copy in the originals folder. */
const HASH_NAME = 16;

/** Where each file's content stands among the sources: built once, and kept current as captures add to it. */
export interface Sources {
  folder: string;
  /** The latest source captured from each file, by the target of its `from` link, with that source's content hash. */
  latest: Map<string, { path: string; sha256: string }>;
  /** A source for each content hash. */
  byHash: Map<string, string>;
}

/** Reads the sources of a folder once, for any number of captures. */
export async function readSources(vault: Vault, folder = SOURCES): Promise<Sources> {
  const out: Sources = { folder: folder.replace(/\/$/, ""), latest: new Map(), byHash: new Map() };
  const order = (path: string) => Number(path.match(/\(source (\d+)\)\.md$/)?.[1] ?? 1);
  const all: { path: string; from: string; sha256: string; created: string }[] = [];
  for (const path of await vault.list(out.folder)) {
    const p = (await readDocument(vault, path)).properties;
    if (typeof p.sha256 !== "string") continue;
    all.push({ path, from: fromTarget(String(p.from ?? "")), sha256: p.sha256, created: String(p.created ?? "") });
  }
  // Oldest first, so a later capture of a file replaces an earlier one; captures in one second go by their number.
  all.sort((a, b) => (a.created < b.created ? -1 : a.created > b.created ? 1 : order(a.path) - order(b.path)));
  for (const source of all) {
    if (source.from) out.latest.set(source.from, { path: source.path, sha256: source.sha256 });
    if (!out.byHash.has(source.sha256)) out.byHash.set(source.sha256, source.path);
  }
  return out;
}

/**
 * The source that holds a file's content already, or nothing when the file needs a new one. A file
 * that has sources is compared with its latest: an edit back to an older text is still a change. A
 * file with no source of its own shares a source with any file of the same content.
 */
export function sourceOf(sources: Sources, file: string, sha256: string): string | undefined {
  const latest = sources.latest.get(fromKey(file));
  if (latest) return latest.sha256 === sha256 ? latest.path : undefined;
  return sources.byHash.get(sha256);
}

/**
 * Captures a file of the vault as a source. The file stays where it is. Yami copies it into
 * `internal/wiki/originals/`, named by its content hash, and writes the source note
 * `<name> (source).md`, which embeds the copy and links the file in `from`. The copy is what the
 * wiki reads and cites, so a later edit of the file does not change what a source said; and the
 * source note never shares a name with the file, so a link by name is never ambiguous.
 * Returns the note's path: a new one, or the source that holds the file's content already (`sourceOf`).
 */
export async function captureSource(vault: Vault, file: string, sources?: Sources): Promise<string> {
  if (!(await vault.exists(file))) throw new Error(`No file at ${file}.`);
  if (isWikiFile(file)) throw new Error(`${file} is part of the wiki itself; capture a file from elsewhere in the vault.`);
  sources ??= await readSources(vault);
  const data = await vault.readBinary(file);
  const sha256 = await hashBytes(data);
  const existing = sourceOf(sources, file, sha256);
  if (existing) return existing;
  const name = file.slice(file.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 ? name.slice(dot).toLowerCase() : "";
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const copy = `${ORIGINALS}/${sha256.slice(0, HASH_NAME)}${extension}`;
  if (!(await vault.exists(copy))) await vault.writeBinary(copy, data);
  let path = `${sources.folder}/${stem} (source).md`;
  for (let n = 2; await vault.exists(path); n++) path = `${sources.folder}/${stem} (source ${n}).md`;
  await writeDocument(vault, {
    path,
    properties: {
      type: "source",
      description: "",
      tags: [],
      file: `[[${copy}]]`,
      from: file.endsWith(".md") ? link(file) : `[[${file}]]`,
      sha256,
      status: "pending",
      created: timestamp(),
    },
    body: `![[${copy}]]\n\n## Summary\n\n## Structure\n\n## Notes\n`,
  });
  sources.latest.set(fromKey(file), { path, sha256 });
  if (!sources.byHash.has(sha256)) sources.byHash.set(sha256, path);
  return path;
}

/** Captures every file of a folder and its subfolders. Files of the wiki itself are skipped. Returns each source once. */
export async function captureSources(vault: Vault, folder: string): Promise<string[]> {
  const files = (await vault.files(folder.replace(/\/$/, ""))).filter((file) => !isWikiFile(file));
  if (!files.length) throw new Error(`No files under ${folder}.`);
  const sources = await readSources(vault);
  const out: string[] = [];
  for (const file of files) {
    const path = await captureSource(vault, file, sources);
    if (!out.includes(path)) out.push(path);
  }
  return out;
}

/** The target of a `from` link that code wrote: the text before the alias. It holds no heading, so a "#" in it is part of the path. */
function fromTarget(from: string): string {
  return from.replace(/^\[\[|\]\]$/g, "").split("|")[0]!.trim();
}

/** How a source's `from` link names its file: a note by its path without `.md`, any other file with its extension. */
function fromKey(file: string): string {
  return file.endsWith(".md") ? file.slice(0, -3) : file;
}

/** The knowledge base and what the wiki keeps for itself: nothing there is a source to capture. */
function isWikiFile(path: string): boolean {
  return path.startsWith(`${WIKI}/`) || path.startsWith(`${WIKI_INTERNAL}/`);
}

export async function hashBytes(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data.slice().buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The most one worker reads: lines of text, or pages of a PDF. */
export const LINES_PER_CHUNK = 800;
export const PAGES_PER_CHUNK = 20;

export interface SourceChunk {
  index: number;
  count: number;
  /** `lines` of a text file, `pages` of a PDF, or the `file` whole. */
  kind: "lines" | "pages" | "file";
  /** First and last line or page, from 1. Absent for a file read whole, or a PDF whose pages are not known. */
  from?: number;
  to?: number;
  /** How to cite the chunk: "lines 801-1600", "pages 21-40". */
  locator: string;
}

export interface SourceChunks {
  /** The source note. */
  source: string;
  /** The original the source stands for, as a vault path. */
  file: string;
  kind: SourceChunk["kind"];
  chunks: SourceChunk[];
}

/**
 * Splits a source's original for the workers of an ingest: a text file into runs of at most
 * 800 lines, cut at a heading or a blank line; a PDF into 20 pages at a time; any other file
 * whole. The workers read the ranges with their own Read tool.
 */
export async function sourceChunks(vault: Vault, wiki: Wiki, source: string): Promise<SourceChunks> {
  const named = wiki.resolve(source);
  const path = (named && wiki.note(named)?.type === "source" ? named : await sourceFrom(vault, source)) ?? named ?? source;
  if (!(await vault.exists(path))) throw new Error(`${source} is neither a source note nor a file that a source was captured from.`);
  const doc = await readDocument(vault, path);
  if (doc.properties.type !== "source") throw new Error(`${path} is not a source note.`);
  const target = linkTarget(String(doc.properties.file ?? ""));
  if (!target) throw new Error(`${path} names no file.`);
  const file = await resolveFile(vault, wiki, target);
  if (!file) throw new Error(`${path} links ${target}, which is not in the vault.`);
  const extension = file.slice(file.lastIndexOf(".") + 1).toLowerCase();
  if (["md", "markdown", "txt", "text", "csv", "json", "yaml", "yml", "html", "xml", "tex", "rst", "org"].includes(extension)) {
    const lines = (await vault.read(file)).split("\n");
    return { source: path, file, kind: "lines", chunks: lineChunks(lines) };
  }
  if (extension === "pdf") {
    const pages = countPages(await vault.readBinary(file));
    if (pages === 0) return { source: path, file, kind: "pages", chunks: [{ index: 1, count: 1, kind: "pages", locator: "the pages, 20 at a time, until the end" }] };
    const count = Math.ceil(pages / PAGES_PER_CHUNK);
    const chunks: SourceChunk[] = [];
    for (let i = 0; i < count; i++) {
      const from = i * PAGES_PER_CHUNK + 1;
      const to = Math.min(pages, from + PAGES_PER_CHUNK - 1);
      chunks.push({ index: i + 1, count, kind: "pages", from, to, locator: `pages ${from}-${to}` });
    }
    return { source: path, file, kind: "pages", chunks };
  }
  return { source: path, file, kind: "file", chunks: [{ index: 1, count: 1, kind: "file", locator: "the whole file" }] };
}

/** Cuts lines into runs of at most `LINES_PER_CHUNK`, at the heading or blank line nearest the limit. */
export function lineChunks(lines: string[]): SourceChunk[] {
  const spans: { from: number; to: number }[] = [];
  let start = 0;
  while (start < lines.length) {
    let end = Math.min(lines.length, start + LINES_PER_CHUNK);
    if (end < lines.length) {
      for (let i = end; i > start + LINES_PER_CHUNK / 2; i--) {
        if (/^#{1,6}\s/.test(lines[i]!) || lines[i]!.trim() === "") {
          end = i;
          break;
        }
      }
    }
    spans.push({ from: start + 1, to: end });
    start = end;
    while (start < lines.length && lines[start]!.trim() === "") start++;
  }
  if (!spans.length) spans.push({ from: 1, to: 1 });
  return spans.map((span, i) => ({ index: i + 1, count: spans.length, kind: "lines" as const, from: span.from, to: span.to, locator: `lines ${span.from}-${span.to}` }));
}

/**
 * Counts the pages of a PDF from its page objects. Zero when the PDF keeps its objects in
 * compressed streams, which hide them; the reader then goes until the end.
 */
export function countPages(data: Uint8Array): number {
  const text = latin1(data);
  const matches = text.match(/\/Type\s*\/Page(?![s\w])/g);
  return matches?.length ?? 0;
}

function latin1(data: Uint8Array): string {
  let out = "";
  for (let i = 0; i < data.length; i += 8192) out += String.fromCharCode(...data.subarray(i, i + 8192));
  return out;
}

/** The source note captured from a file, named by its path or its name, such as `papers/scan.pdf` or `[[scan.pdf]]`. */
async function sourceFrom(vault: Vault, file: string): Promise<string | undefined> {
  const wanted = linkTarget(file).replace(/\.md$/, "");
  const name = wanted.slice(wanted.lastIndexOf("/") + 1);
  let byName: string | undefined;
  for (const path of await vault.list(SOURCES)) {
    const from = linkTarget(String((await readDocument(vault, path)).properties.from ?? "")).replace(/\.md$/, "");
    if (!from) continue;
    if (from === wanted) return path;
    if (!wanted.includes("/") && from.slice(from.lastIndexOf("/") + 1) === name) byName ??= path;
  }
  return byName;
}

/** The vault path a source's `file` names: a note by link, or a file by path or by name. */
async function resolveFile(vault: Vault, wiki: Wiki, target: string): Promise<string | undefined> {
  const note = wiki.resolve(target);
  if (note) return note;
  if (await vault.exists(target)) return target;
  const name = target.slice(target.lastIndexOf("/") + 1).toLowerCase();
  return (await vault.files("")).find((file) => file.slice(file.lastIndexOf("/") + 1).toLowerCase() === name);
}
