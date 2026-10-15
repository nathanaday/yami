import { link, readDocument, writeDocument } from "../document/document.js";
import { timestamp } from "../document/schema.js";
import type { Vault } from "../document/vault.js";
import { KNOWLEDGE, SNAPSHOTS } from "./folders.js";
import { hash } from "./tokens.js";

/** One version of the knowledge base, as its snapshot document records it. */
export interface Version {
  version: number;
  path: string;
  archive: string;
  hash: string;
  created: string;
  notes: number;
  change?: string;
  restored?: number;
}

/** What an archive holds: every note of the knowledge base, by path. */
export interface Archive {
  version: number;
  created: string;
  hash: string;
  notes: Record<string, string>;
}

export interface Captured {
  /** True when the latest snapshot holds the knowledge base as it is now. */
  captured: boolean;
  hash: string;
  latest?: Version;
}

/** The notes of the knowledge base, by path, and the hash of all of them. */
export async function knowledge(vault: Vault): Promise<{ notes: Record<string, string>; hash: string }> {
  const paths = (await Promise.all(KNOWLEDGE.map((folder) => vault.list(folder)))).flat().sort();
  const notes: Record<string, string> = {};
  for (const path of paths) notes[path] = await vault.read(path);
  return { notes, hash: hashOf(notes) };
}

export function hashOf(notes: Record<string, string>): string {
  const paths = Object.keys(notes).sort();
  return hash(paths.map((path) => `${path}\0${notes[path]}\0`).join(""), paths.length);
}

/** Every version, oldest first. */
export async function versions(vault: Vault): Promise<Version[]> {
  const out: Version[] = [];
  for (const path of await vault.list(SNAPSHOTS)) {
    const doc = await readDocument(vault, path);
    if (doc.properties.type !== "snapshot" || typeof doc.properties.version !== "number") continue;
    out.push({
      version: doc.properties.version,
      path,
      archive: String(doc.properties.archive ?? ""),
      hash: String(doc.properties.hash ?? ""),
      created: String(doc.properties.created ?? ""),
      notes: Number(doc.properties.notes ?? 0),
      change: typeof doc.properties.change === "string" ? doc.properties.change : undefined,
      restored: typeof doc.properties.restored === "number" ? doc.properties.restored : undefined,
    });
  }
  return out.sort((a, b) => a.version - b.version);
}

/** Whether the latest snapshot holds the knowledge base as it is now. */
export async function captured(vault: Vault): Promise<Captured> {
  const [{ hash: current }, all] = await Promise.all([knowledge(vault), versions(vault)]);
  const latest = all.at(-1);
  return { captured: latest?.hash === current, hash: current, latest };
}

export interface SnapshotOptions {
  /** The change document that led to this version. */
  change?: string;
  /** The version this snapshot restored. */
  restored?: number;
}

/**
 * Saves the knowledge base as the next version: a gzip archive of every note, and a snapshot
 * document beside it that the ledger lists. The document's body names what changed since the
 * version before.
 */
export async function snapshot(vault: Vault, options: SnapshotOptions = {}): Promise<Version> {
  const [{ notes, hash: current }, all] = await Promise.all([knowledge(vault), versions(vault)]);
  const previous = all.at(-1);
  const version = (previous?.version ?? 0) + 1;
  const created = timestamp();
  const archivePath = `${SNAPSHOTS}/v${version}.json.gz`;
  const path = `${SNAPSHOTS}/v${version}.md`;
  const archive: Archive = { version, created, hash: current, notes };
  await vault.writeBinary(archivePath, await gzip(JSON.stringify(archive)));
  const before = previous ? (await readArchive(vault, previous)).notes : {};
  const body = [`# Version ${version}`, "", ...describe(before, notes, previous?.version)].join("\n");
  await writeDocument(vault, {
    path,
    properties: {
      type: "snapshot",
      module: "wiki",
      version,
      created,
      hash: current,
      notes: Object.keys(notes).length,
      archive: archivePath,
      ...(options.change ? { change: link(options.change) } : {}),
      ...(options.restored !== undefined ? { restored: options.restored } : {}),
    },
    body: `${body}\n`,
  });
  return { version, path, archive: archivePath, hash: current, created, notes: Object.keys(notes).length, change: options.change && link(options.change), restored: options.restored };
}

/** Puts the knowledge base back as a version holds it. The notes that the version lacks are removed. */
export async function writeArchive(vault: Vault, version: Version): Promise<{ written: number; removed: number }> {
  const { notes } = await readArchive(vault, version);
  const current = await knowledge(vault);
  let written = 0;
  let removed = 0;
  for (const path of Object.keys(current.notes)) {
    if (!(path in notes)) {
      await vault.remove(path);
      removed += 1;
    }
  }
  for (const [path, text] of Object.entries(notes)) {
    if (current.notes[path] === text) continue;
    await vault.write(path, text);
    written += 1;
  }
  return { written, removed };
}

export async function readArchive(vault: Vault, version: Version): Promise<Archive> {
  return JSON.parse(await gunzip(await vault.readBinary(version.archive))) as Archive;
}

/** Lines that say which notes a version added, changed, and removed since the one before. */
function describe(before: Record<string, string>, after: Record<string, string>, previous: number | undefined): string[] {
  const added = Object.keys(after).filter((path) => !(path in before));
  const removed = Object.keys(before).filter((path) => !(path in after));
  const changed = Object.keys(after).filter((path) => path in before && before[path] !== after[path]);
  if (previous === undefined) return [`The first snapshot: ${Object.keys(after).length} note(s).`];
  if (!added.length && !removed.length && !changed.length) return [`No note differs from version ${previous}.`];
  const list = (title: string, paths: string[]) => (paths.length ? [`## ${title}`, "", ...paths.map((path) => `- ${link(path)}`), ""] : []);
  return [`Since version ${previous}: ${added.length} added, ${changed.length} changed, ${removed.length} removed.`, "", ...list("Added", added), ...list("Changed", changed), ...list("Removed", removed)];
}

export async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzip(data: Uint8Array): Promise<string> {
  const stream = new Blob([data.slice().buffer as ArrayBuffer]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}
