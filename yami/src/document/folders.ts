import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The vault file that says where Yami keeps its folders. Hidden, so the vault root stays the person's. */
export const FOLDER_SETTINGS = ".yami.json";

/** The wiki module's id, which names its internal folder. */
export const WIKI_ID = "wiki";

/** Where a vault keeps Yami's folders, as vault paths. */
export interface FolderSettings {
  /** The folder of what the modules need, out of the person's way. */
  internal: string;
  /** The wiki's folder: the knowledge base, for a person to read. */
  wiki: string;
}

export const DEFAULT_FOLDER_SETTINGS: Readonly<FolderSettings> = Object.freeze({ internal: "internal", wiki: "wiki" });

const LABELS: Record<keyof FolderSettings, string> = { internal: "The internal folder", wiki: "The wiki folder" };

/** A folder path as a vault path: trimmed, with `/` between its parts and none at either end. */
export function normalizeFolder(folder: string): string {
  return folder
    .trim()
    .split(/[\\/]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
}

function within(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`);
}

/**
 * Why settings cannot be the vault's folders, or undefined when they can. A folder whose name starts with a
 * dot is refused: Obsidian leaves hidden folders out of its index, so their notes, links, and embeds stop working.
 */
export function folderProblem(settings: FolderSettings): string | undefined {
  for (const key of ["internal", "wiki"] as const) {
    const label = LABELS[key];
    const folder = normalizeFolder(settings[key]);
    if (!folder) return `${label} needs a name.`;
    if (folder.split("/").some((part) => part.startsWith("."))) return `${label} cannot be ${folder}: Obsidian hides a folder whose name starts with a dot, so its notes and links stop working.`;
    const bad = folder.match(/[:*?"<>|#^[\]\p{Cc}]/u);
    if (bad) return `${label} cannot be ${folder}: a folder name cannot hold "${bad[0]}".`;
  }
  const internal = normalizeFolder(settings.internal);
  const wiki = normalizeFolder(settings.wiki);
  if (within(internal, wiki) || within(wiki, internal)) return `The wiki folder and the internal folder must be apart: ${wiki} and ${internal} overlap.`;
  return undefined;
}

/**
 * The folders of one vault, from its settings: Yami's internal folder, the wiki, and the folders under each.
 * Every path that Yami builds for these starts here.
 */
export class Folders {
  /** What the modules need, out of the person's way: one folder for each module, by its id. */
  readonly internal: string;
  /** The knowledge base, for a person to read. */
  readonly wiki: string;
  readonly topics: string;
  readonly sources: string;
  /** The folders a snapshot holds and a change may write. */
  readonly knowledge: readonly string[];
  /** What the wiki keeps for itself: the wiki module's internal folder. */
  readonly wikiInternal: string;
  readonly snapshots: string;
  readonly changes: string;
  readonly cache: string;
  /** Frozen copies of what the sources were captured from, each named by the start of its content hash. */
  readonly originals: string;
  /** The figures that a figures session makes: `<figures>/<topic>/<name>.svg`. */
  readonly figures: string;
  /** The text that a person protected, in Yami's own folder. */
  readonly protected: string;

  constructor(settings: Partial<FolderSettings> = {}) {
    const all = { ...DEFAULT_FOLDER_SETTINGS, ...settings };
    const problem = folderProblem(all);
    if (problem) throw new Error(problem);
    this.internal = normalizeFolder(all.internal);
    this.wiki = normalizeFolder(all.wiki);
    this.topics = `${this.wiki}/topics`;
    this.sources = `${this.wiki}/sources`;
    this.knowledge = [this.topics, this.sources];
    this.wikiInternal = this.internalOf(WIKI_ID);
    this.snapshots = `${this.wikiInternal}/snapshots`;
    this.changes = `${this.wikiInternal}/changes`;
    this.cache = `${this.wikiInternal}/cache/embeddings.json`;
    this.originals = `${this.wikiInternal}/originals`;
    this.figures = `${this.wikiInternal}/figures`;
    this.protected = `${this.internalOf("yami")}/protected.json`;
  }

  /** The settings these folders come from. */
  get settings(): FolderSettings {
    return { internal: this.internal, wiki: this.wiki };
  }

  /** A module's internal folder: `<internal>/<id>`. */
  internalOf(id: string): string {
    return `${this.internal}/${id}`;
  }

  /** Whether a path is a note of the knowledge base. */
  inKnowledge(path: string): boolean {
    return path.endsWith(".md") && this.knowledge.some((folder) => path.startsWith(`${folder}/`));
  }

  /** Whether a path is the wiki's own: in the knowledge base, or in what the wiki keeps for itself. */
  inWiki(path: string): boolean {
    return path.startsWith(`${this.wiki}/`) || path.startsWith(`${this.wikiInternal}/`);
  }
}

export const DEFAULT_FOLDERS = new Folders();

/** The settings file's text for these settings. A setting at its default is left out. */
export function folderSettingsText(settings: FolderSettings): string {
  const own = Object.fromEntries(Object.entries(settings).filter(([key, value]) => normalizeFolder(value) !== DEFAULT_FOLDER_SETTINGS[key as keyof FolderSettings]).map(([key, value]) => [key, normalizeFolder(value)]));
  return `${JSON.stringify(own, null, 2)}\n`;
}

/** The folders that a settings file's text gives. It throws, with the file's name, for a text that is not valid settings. */
export function parseFolderSettings(text: string): Folders {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`${FOLDER_SETTINGS} does not parse: ${error instanceof Error ? error.message : String(error)}. Fix it, or remove it for the default folders.`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(`${FOLDER_SETTINGS} must hold an object, such as { "wiki": "library/wiki" }.`);
  const settings: Partial<FolderSettings> = {};
  for (const key of ["internal", "wiki"] as const) {
    const value = (data as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (typeof value !== "string") throw new Error(`${FOLDER_SETTINGS}: ${key} must be a folder path, as text.`);
    settings[key] = value;
  }
  try {
    return new Folders(settings);
  } catch (error) {
    throw new Error(`${FOLDER_SETTINGS}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The folders of the vault at an absolute path: its settings file's, or the defaults when it has none. */
export function readFolders(root: string): Folders {
  let text: string;
  try {
    text = readFileSync(join(root, FOLDER_SETTINGS), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return DEFAULT_FOLDERS;
    throw error;
  }
  return parseFolderSettings(text);
}

/** A text as a regular expression that matches it, and only it. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A path or a text with the wiki's folders of one layout as another has them: the topics, the sources, the
 * originals, and the figures. A path is mapped only where it starts, so a word that holds one is left alone.
 */
export function mapFolders(text: string, from: Folders, to: Folders): string {
  const pairs = (["topics", "sources", "originals", "figures"] as const).map((key) => [from[key], to[key]] as const).filter(([a, b]) => a !== b);
  if (!pairs.length) return text;
  const target = new Map(pairs);
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_./-])(${pairs.map(([a]) => escapeRegExp(a)).join("|")})(?=/)`, "gu");
  return text.replace(pattern, (folder) => target.get(folder)!);
}
