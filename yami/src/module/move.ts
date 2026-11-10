import { FOLDER_SETTINGS, Folders, folderSettingsText, WIKI_ID, type FolderSettings } from "../document/folders.js";
import { readProtected, writeProtected } from "../document/protected.js";
import type { Vault } from "../document/vault.js";
import { listChanges, moveWritePaths } from "../wiki/change.js";
import type { Yami } from "./yami.js";

/** What a move of the folders did. */
export interface MovedFolders {
  from: FolderSettings;
  to: FolderSettings;
  /** The folders that moved, each from its old path to its new one. A folder that the vault did not hold yet has nothing to move. */
  moved: { from: string; to: string }[];
}

function within(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`);
}

/** A path under `from` as the same path under `to`; any other path as it is. */
function movedPath(path: string, from: string, to: string): string {
  return within(path, from) ? `${to}${path.slice(from.length)}` : path;
}

/**
 * Moves the vault's internal folder and wiki folder to the paths that the settings give, and writes the
 * settings file. Every link and embed in the vault's notes that leads into a moved folder follows it, also
 * where the host's own link updates are off, and so do the records that hold vault paths as text: each
 * module's `installed.json`, the protected text map, and the notes that each change document names. It refuses settings that are
 * not valid, a folder that would move into the other folder or into itself, a path where something is
 * already, a path that a module's own folder has, and a move of the wiki while a change plan waits for
 * approval, since the plan names its notes by path. A Yami keeps the folders it started with: the host
 * builds it again, in Obsidian by a reload, before anything else runs.
 */
export async function moveFolders(yami: Yami, settings: Partial<FolderSettings>): Promise<MovedFolders> {
  const vault = yami.vault;
  const from = vault.folders;
  const to = new Folders({ ...from.settings, ...settings });
  const keys = (["internal", "wiki"] as const).filter((key) => from[key] !== to[key]);
  const label = { internal: "The internal folder", wiki: "The wiki folder" };
  for (const key of keys) {
    const other = key === "internal" ? from.wiki : from.internal;
    if (within(to[key], from[key])) throw new Error(`${label[key]} cannot move into itself: ${to[key]} is in ${from[key]}.`);
    if (within(to[key], other) || within(other, to[key])) throw new Error(`${label[key]} cannot move to ${to[key]}, which overlaps ${other}. Move one folder at a time.`);
    if (await vault.exists(to[key])) throw new Error(`${label[key]} cannot move to ${to[key]}: something is there already. Choose another path, or move it away first.`);
    const owner = yami.modules.find((module) => module.id !== WIKI_ID && within(to[key], module.layout.folder));
    if (owner) throw new Error(`${label[key]} cannot move to ${to[key]}: the ${owner.name} module keeps its notes in ${owner.layout.folder}.`);
  }
  if (keys.includes("wiki") && (await listChanges(vault, "proposed")).length) {
    throw new Error("A change plan waits for approval, and it names its notes by path. Approve or reject each one, then move the wiki folder.");
  }
  const moved: MovedFolders["moved"] = [];
  for (const key of keys) {
    if (!(await vault.exists(from[key]))) continue;
    await vault.rename(from[key], to[key]);
    moved.push({ from: from[key], to: to[key] });
  }
  const move = (path: string) => movedPath(movedPath(path, from.internal, to.internal), from.wiki, to.wiki);
  const installed = await moveRecords(vault, to, move);
  if (moved.length) {
    // What Yami installed it writes again for the new folders at the next start; an edit here would read as a person's.
    for (const path of await vault.list("")) {
      if (installed.has(path)) continue;
      const text = await vault.read(path);
      const links = moveLinks(text, move);
      const next = path.startsWith(`${to.changes}/`) ? moveWritePaths(links, move) : links;
      if (next !== text) await vault.write(path, next);
    }
  }
  await vault.write(FOLDER_SETTINGS, folderSettingsText(to.settings));
  return { from: from.settings, to: to.settings, moved };
}

const WIKILINK = /(!?\[\[)([^\]|#^\n]+)/g;
const MARKDOWN_LINK = /(\]\()([^)\s]+)/g;

/** A text with the target of each wiki link and markdown link moved, as `move` moves a path. Prose is left as it is. */
export function moveLinks(text: string, move: (path: string) => string): string {
  const markdown = (target: string) => {
    let path: string;
    try {
      path = decodeURI(target);
    } catch {
      return target;
    }
    const moved = move(path);
    return moved === path ? target : encodeURI(moved);
  };
  return text.replace(WIKILINK, (all, open: string, target: string) => `${open}${move(target)}`).replace(MARKDOWN_LINK, (all, open: string, target: string) => `${open}${markdown(target)}`);
}

/**
 * Rewrites the vault paths in the records that hold them as text: each module's installed record, and the
 * protected text map. Returns the paths that the installed records list, as they are now.
 */
async function moveRecords(vault: Vault, folders: Folders, move: (path: string) => string): Promise<Set<string>> {
  const installed = new Set<string>();
  for (const path of await vault.files(folders.internal)) {
    if (!path.endsWith("/installed.json")) continue;
    const record = JSON.parse(await vault.read(path)) as Record<string, string>;
    const next = Object.fromEntries(Object.entries(record).map(([file, hash]) => [move(file), hash]));
    for (const file of Object.keys(next)) installed.add(file);
    if (JSON.stringify(next) !== JSON.stringify(record)) await vault.write(path, `${JSON.stringify(next, null, 2)}\n`);
  }
  // The vault's folders are still the ones from before the move, so the map's new path is given.
  if (!(await vault.exists(folders.protected))) return installed;
  const map = await readProtected(vault, folders.protected);
  const notes = Object.fromEntries(Object.entries(map.notes).map(([path, marks]) => [move(path), marks]));
  if (JSON.stringify(notes) !== JSON.stringify(map.notes)) await writeProtected(vault, { ...map, notes }, folders.protected);
  return installed;
}
