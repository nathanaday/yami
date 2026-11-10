import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { harnessEnv } from "../agent/executable.js";
import { basename, link, linksOf, linkTarget, parseDocument, PropertiesError, serializeDocument, type Document } from "../document/document.js";
import { timestamp } from "../document/schema.js";
import type { Properties, Vault } from "../document/vault.js";
import { DEFAULT_FOLDERS, mapFolders } from "../document/folders.js";
import { isAbsolute } from "./source.js";
import type { Note, Wiki } from "./wiki.js";

/** How far a bundle reaches from its topic. Each size caps the topics; the sources they cite always come along. */
export const BUNDLE_SIZES = ["minimal", "small", "medium", "extensive"] as const;
export type BundleSize = (typeof BUNDLE_SIZES)[number];

/** The most topics a bundle of each size holds. */
export const TOPIC_CAPS: Record<BundleSize, number> = { minimal: 1, small: 8, medium: 25, extensive: 80 };

/** The property that marks a note as part of an exported bundle, so the index skips it. Its value names the bundle. */
export const BUNDLE_PROPERTY = "bundle";

/** The notes and files that a bundle holds, as vault paths. */
export interface BundleSelection {
  /** The topic the selection started from, when it did. */
  topic?: string;
  size?: BundleSize;
  topics: string[];
  sources: string[];
  /** The frozen copies, texts, and pictures that the sources embed, under `internal/wiki/originals/`. */
  originals: string[];
}

/** The topics of the knowledge base that a note links or that link it. */
function neighbors(wiki: Wiki, note: Note): string[] {
  return [...new Set([...note.links, ...note.backlinks])].filter((path) => wiki.note(path)?.type === "topic");
}

/**
 * Chooses the notes of a bundle around a topic: the topic, then one neighbor at a time over links and
 * backlinks among the topics, each time the one that connects to the most topics chosen so far (then the
 * first by name), up to the cap of the size. So a bundle that is cut holds the part that hangs together.
 * Every source that a chosen topic cites comes along, with the originals it embeds, so the citations resolve
 * in the bundle. The topic is a path or a link name; it throws for a note that is not a topic of the wiki.
 */
export async function selectBundle(wiki: Wiki, topic: string, size: BundleSize = "medium"): Promise<BundleSelection> {
  await wiki.ensure();
  const start = wiki.resolve(topic);
  const note = start ? wiki.note(start) : undefined;
  if (!note || note.type !== "topic") throw new Error(`${topic} is not a topic of the wiki.`);
  const cap = TOPIC_CAPS[size];
  if (!cap) throw new Error(`"${size}" is not a size. The sizes are ${BUNDLE_SIZES.join(", ")}.`);
  const chosen = new Set<string>([start!]);
  while (chosen.size < cap) {
    const candidates = new Map<string, number>();
    for (const path of chosen) {
      for (const next of neighbors(wiki, wiki.note(path)!)) {
        if (!chosen.has(next)) candidates.set(next, (candidates.get(next) ?? 0) + 1);
      }
    }
    if (!candidates.size) break;
    const best = [...candidates.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]![0];
    chosen.add(best);
  }
  const topics = [...chosen];
  return { topic: start, size, topics, ...(await withSources(wiki, topics, [])) };
}

/** The sources that the topics cite, with the originals they embed, plus the sources given. */
async function withSources(wiki: Wiki, topics: string[], given: string[]): Promise<Pick<BundleSelection, "sources" | "originals">> {
  const sources = new Set<string>(given);
  for (const path of topics) {
    const note = wiki.note(path)!;
    for (const target of [...note.links, ...linksOf(note.properties.sources).map((t) => wiki.resolve(t) ?? "")]) {
      if (target && wiki.note(target)?.type === "source") sources.add(target);
    }
  }
  const originals: string[] = [];
  const { originals: folder } = wiki.folders;
  const files = await wiki.vault.files(folder);
  for (const path of sources) {
    const { properties } = wiki.note(path)!;
    for (const key of ["file", "text"]) {
      const target = linkTarget(String(properties[key] ?? ""));
      if (!target.startsWith(`${folder}/`)) continue;
      const file = target.endsWith(".md") || /\.[a-z0-9]{1,5}$/i.test(target) ? target : `${target}.md`;
      if (files.includes(file) && !originals.includes(file)) originals.push(file);
      // The pictures of a captured text sit in the folder of its name.
      if (key === "text") for (const picture of files) if (picture.startsWith(`${file.replace(/\.md$/, "")}/`) && !originals.includes(picture)) originals.push(picture);
    }
  }
  return { sources: [...sources].sort(), originals: originals.sort() };
}

/**
 * The notes given, as a selection: topics and sources by path or link name, with the sources that the topics
 * cite and the originals. It throws for a note that is not knowledge.
 */
export async function selectDocuments(wiki: Wiki, documents: string[]): Promise<BundleSelection> {
  await wiki.ensure();
  const topics: string[] = [];
  const sources: string[] = [];
  for (const document of documents) {
    const path = wiki.resolve(document);
    const note = path ? wiki.note(path) : undefined;
    if (!note || (note.type !== "topic" && note.type !== "source")) throw new Error(`${document} is not a topic or a source of the wiki.`);
    (note.type === "topic" ? topics : sources).push(path!);
  }
  return { topics: [...new Set(topics)], ...(await withSources(wiki, [...new Set(topics)], sources)) };
}

/** Where a bundle is written: a folder of the vault, or an absolute path outside it. */
interface Destination {
  write(path: string, text: string): Promise<void>;
  writeBinary(path: string, data: Uint8Array): Promise<void>;
}

function destination(vault: Vault, folder: string): Destination {
  if (isAbsolute(folder)) {
    const abs = (path: string) => join(folder, ...path.split("/"));
    return {
      write: async (path, text) => {
        await mkdir(dirname(abs(path)), { recursive: true });
        await writeFile(abs(path), text);
      },
      writeBinary: async (path, data) => {
        await mkdir(dirname(abs(path)), { recursive: true });
        await writeFile(abs(path), data);
      },
    };
  }
  const clean = folder.replace(/\/+$/, "");
  return {
    write: (path, text) => vault.write(`${clean}/${path}`, text),
    writeBinary: (path, data) => vault.writeBinary(`${clean}/${path}`, data),
  };
}

export interface WriteBundleOptions {
  /** The bundle's name: the value of each note's `bundle` property, and the README's title. Default: the topic's name, or "Bundle". */
  name?: string;
  /** Whether the originals come along. Default true. */
  originals?: boolean;
}

/** A bundle as written: where, and what. */
export interface WrittenBundle {
  /** The folder, as given: a vault path, or an absolute path. */
  folder: string;
  name: string;
  /** The README, as a path under the folder. */
  readme: string;
  topics: string[];
  sources: string[];
  originals: string[];
}

/** The file name of a bundle's README. */
export const BUNDLE_README = "README.md";

/**
 * Writes a selection as a bundle: the notes in the vault's own layout (`wiki/topics/`, `wiki/sources/`,
 * `internal/wiki/originals/`) and a README that lists them. Each note gets the property `bundle`, the
 * bundle's name, so the index of this vault skips a bundle written inside it; an import removes it. The
 * folder is a vault path, or an absolute path outside the vault. It refuses a folder under `wiki/`.
 */
export async function writeBundle(wiki: Wiki, selection: BundleSelection, folder: string, options: WriteBundleOptions = {}): Promise<WrittenBundle> {
  const { vault, folders } = wiki;
  if (!folder.trim()) throw new Error("Give the folder to write the bundle to.");
  if (!isAbsolute(folder) && (folder === folders.wiki || folder.startsWith(`${folders.wiki}/`) || folder.includes(".."))) throw new Error(`${folder} is in the knowledge base; write the bundle elsewhere.`);
  const portable = (text: string) => mapFolders(text, folders, DEFAULT_FOLDERS);
  const name = options.name?.trim() || (selection.topic ? basename(selection.topic) : "Bundle");
  const out = destination(vault, folder);
  const rows = { topics: [] as string[], sources: [] as string[] };
  for (const [kind, paths] of [
    ["topics", selection.topics],
    ["sources", selection.sources],
  ] as const) {
    for (const path of paths) {
      const note = wiki.note(path);
      if (!note) throw new Error(`${path} is not a note of the wiki.`);
      const doc: Document = { path, properties: { ...note.properties, [BUNDLE_PROPERTY]: name }, body: note.body };
      await out.write(portable(path), portable(serializeDocument(vault, doc)));
      rows[kind].push(`- ${link(portable(path))}${note.description ? ` · ${note.description}` : ""}`);
    }
  }
  const originals = options.originals === false ? [] : selection.originals;
  for (const path of originals) await out.writeBinary(portable(path), await vault.readBinary(path));
  const readme: Document = {
    path: BUNDLE_README,
    properties: {
      [BUNDLE_PROPERTY]: name,
      ...(selection.topic && { topic: link(portable(selection.topic)) }),
      ...(selection.size && { size: selection.size }),
      exported: timestamp(),
      topics: selection.topics.length,
      sources: selection.sources.length,
    },
    body: [
      `# ${name}`,
      "",
      `A bundle of ${selection.topics.length} topic${selection.topics.length === 1 ? "" : "s"} and ${selection.sources.length} source${selection.sources.length === 1 ? "" : "s"} of a Yami wiki${selection.topic ? `, around ${link(selection.topic)}` : ""}. Import it into another vault with Wiki: import a bundle, or the tool \`wiki_import\`, which merges the notes into that wiki through a change plan that a person approves.`,
      "",
      "## Topics",
      "",
      ...(rows.topics.length ? rows.topics : ["- none"]),
      "",
      "## Sources",
      "",
      ...(rows.sources.length ? rows.sources : ["- none"]),
      "",
      ...(originals.length ? ["## Originals", "", `${originals.length} file${originals.length === 1 ? "" : "s"} under \`${DEFAULT_FOLDERS.originals}/\`: the frozen copies that the sources embed.`, ""] : []),
    ].join("\n"),
  };
  await out.write(BUNDLE_README, serializeDocument(vault, readme));
  return { folder, name, readme: BUNDLE_README, topics: selection.topics, sources: selection.sources, originals };
}

/** One note of a bundle, read: where it goes in the knowledge base, and its content with the `bundle` property removed. */
export interface BundleNote {
  /** The note's path in this vault's knowledge base: `<topics>/<name>.md` or `<sources>/<name>.md`. */
  path: string;
  type: "topic" | "source";
  properties: Properties;
  body: string;
}

/** A bundle as read from a folder or a repository. */
export interface Bundle {
  /** Where it was read from, as given. */
  from: string;
  /** The bundle's name, from its README or its notes, when it has one. */
  name?: string;
  notes: BundleNote[];
  /** The originals, each at its path in this vault's originals folder. */
  originals: { path: string; data: Uint8Array }[];
  /** The markdown files that are neither topics nor sources, by their path in the bundle, with the reason. */
  skipped: { path: string; reason: string }[];
}

/** Whether a string names a git repository to clone: an `https://` or `http://` URL, or an `ssh` address. */
export function isRepository(from: string): boolean {
  return /^(https?:\/\/|git@|ssh:\/\/)/.test(from.trim());
}

/** The clone command of a repository address: a GitHub URL may name a branch and a folder as `/tree/<branch>/<folder>`. */
export function repositoryParts(from: string): { url: string; branch?: string; folder: string } {
  const trimmed = from.trim();
  const tree = /^(https?:\/\/[^/]+\/[^/]+\/[^/]+?)(?:\.git)?\/tree\/([^/]+)(?:\/(.*))?$/.exec(trimmed);
  if (tree) return { url: tree[1]!, branch: tree[2], folder: tree[3] ?? "" };
  return { url: trimmed.replace(/\/+$/, ""), folder: "" };
}

const CLONE_TIMEOUT_MS = 120_000;

/** Clones a repository into a temporary folder with the person's own git, and returns the folder to read and the function that removes it. */
async function cloneRepository(from: string): Promise<{ folder: string; done: () => Promise<void> }> {
  const { url, branch, folder } = repositoryParts(from);
  const root = await mkdtemp(join(tmpdir(), "yami-bundle-"));
  const args = ["clone", "--depth", "1", "--quiet", ...(branch ? ["--branch", branch] : []), url, root];
  const env = await harnessEnv();
  try {
    await new Promise<void>((resolve, reject) => {
      execFile("git", args, { env, timeout: CLONE_TIMEOUT_MS }, (error, _stdout, stderr) => {
        if (error) reject(new Error(`git could not clone ${url}${branch ? ` (${branch})` : ""}: ${String(stderr || error.message).trim()}`));
        else resolve();
      });
    });
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
  return { folder: folder ? join(root, ...folder.split("/")) : root, done: () => rm(root, { recursive: true, force: true }) };
}

/** The files of a folder on disk and its subfolders, as paths relative to it with `/`, without the hidden ones and `.git`. */
async function diskFiles(folder: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(folder, { withFileTypes: true, recursive: true });
  } catch (error) {
    throw new Error(`Yami cannot read the folder ${folder}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return entries
    .filter((e) => e.isFile())
    .map((e) => relative(folder, join(e.parentPath, e.name)).split(sep).join("/"))
    .filter((file) => !file.split("/").some((part) => part.startsWith(".")))
    .sort();
}

/**
 * Reads a bundle: a folder of the vault, an absolute path, or a git repository to clone (a GitHub URL, which
 * may name a branch and a folder as `/tree/<branch>/<folder>`). Every markdown file with `type: topic` or
 * `type: source` is a note of the bundle, wherever it sits in the folder, so a folder of notes made by hand
 * imports as a bundle does; the `bundle` property is removed. Files under `internal/wiki/originals/` are the
 * originals. The paths of the default layout are mapped to this vault's folders, in the notes too. Anything
 * else is skipped with its reason. It throws for a folder it cannot read, and for one
 * with no note.
 */
export async function readBundle(vault: Vault, from: string): Promise<Bundle> {
  let clone: { folder: string; done: () => Promise<void> } | undefined;
  if (isRepository(from)) clone = await cloneRepository(from);
  try {
    const folder = clone?.folder ?? from.replace(/\/+$/, "");
    const onDisk = clone !== undefined || isAbsolute(folder);
    const files = onDisk ? await diskFiles(folder) : (await vault.files(folder)).map((path) => path.slice(folder.length + 1));
    if (!files.length) throw new Error(`No files under ${from}.`);
    const read = (file: string) => (onDisk ? readFile(join(folder, ...file.split("/")), "utf8") : vault.read(`${folder}/${file}`));
    const readBinary = async (file: string) => (onDisk ? new Uint8Array(await readFile(join(folder, ...file.split("/")))) : vault.readBinary(`${folder}/${file}`));
    const bundle: Bundle = { from, notes: [], originals: [], skipped: [] };
    const local = (text: string) => mapFolders(text, DEFAULT_FOLDERS, vault.folders);
    for (const file of files) {
      if (file.startsWith(`${DEFAULT_FOLDERS.originals}/`)) {
        bundle.originals.push({ path: local(file), data: await readBinary(file) });
        continue;
      }
      if (!file.endsWith(".md")) continue;
      let doc: Document;
      try {
        doc = parseDocument(vault, file, local(await read(file)));
      } catch (error) {
        bundle.skipped.push({ path: file, reason: error instanceof PropertiesError ? `its properties do not parse: ${error.reason}` : String(error) });
        continue;
      }
      const { [BUNDLE_PROPERTY]: bundleName, ...properties } = doc.properties;
      if (typeof bundleName === "string" && bundleName) bundle.name ??= bundleName;
      const type = properties.type;
      if (type !== "topic" && type !== "source") {
        if (file !== BUNDLE_README) bundle.skipped.push({ path: file, reason: type ? `its type is ${String(type)}, not topic or source` : "it has no type" });
        continue;
      }
      const name = file.slice(file.lastIndexOf("/") + 1);
      bundle.notes.push({ path: `${type === "topic" ? vault.folders.topics : vault.folders.sources}/${name}`, type, properties, body: doc.body });
    }
    if (!bundle.notes.length) throw new Error(`No topic or source under ${from}: a bundle is a folder of notes with type: topic or type: source.`);
    return bundle;
  } finally {
    await clone?.done();
  }
}
