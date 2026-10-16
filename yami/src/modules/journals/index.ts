import { link } from "../../document/document.js";
import { timestamp } from "../../document/schema.js";
import type { Vault } from "../../document/vault.js";
import { createSession, freeSessionName, layout, policy, type Module } from "../../module/module.js";
import { captureSource, hashBytes, readSources, sourceOf } from "../../wiki/source.js";
import { wiki } from "../wiki.js";

/** The folder of the volumes: each folder directly under it is one volume of the user's writing. */
export const JOURNALS = "journals";
const POLICY = "Journal sources";

/** The journals module: the user's own writing, which the wiki learns from only when the user publishes a volume. */
export const journals: Module = {
  id: "journals",
  name: "Journals",
  description: `The user's own writing, one volume per folder of ${JOURNALS}/. Publishing a volume captures its new and changed notes as sources and starts a wiki ingest session, an edition.`,
  sessions: "none",
  documents: [
    policy(
      POLICY,
      `A source captured from \`${JOURNALS}/\` holds the user's own words. In its modify, set \`authority: primary\`. Cite it on each claim it supports. Where a topic quotes the user, quote the words exactly. Never make a claim that the note does not make: keep an opinion an opinion, and a question a question. Never change a note in \`${JOURNALS}/\`.`,
    ),
  ],
};

export interface Volume {
  /** The folder name, under `journals/`. */
  volume: string;
  /** How the folder reads: `cs566-notes` is "CS566 Notes". */
  name: string;
  notes: number;
  /** The notes whose latest source does not hold their text: new, or changed since their last publish. */
  unpublished: number;
}

/** Each volume, with its notes and how many of them wait to be published. */
export async function volumes(vault: Vault): Promise<Volume[]> {
  const sources = await readSources(vault);
  const byVolume = new Map<string, string[]>();
  for (const note of await vault.list(JOURNALS)) {
    const volume = note.split("/")[1]!;
    if (note.split("/").length > 2) byVolume.set(volume, [...(byVolume.get(volume) ?? []), note]);
  }
  const out: Volume[] = [];
  for (const [volume, notes] of [...byVolume].sort(([a], [b]) => (a < b ? -1 : 1))) {
    let unpublished = 0;
    for (const note of notes) if (!sourceOf(sources, note, await hashBytes(await vault.readBinary(note)))) unpublished += 1;
    out.push({ volume, name: volumeName(volume), notes: notes.length, unpublished });
  }
  return out;
}

export interface Edition {
  /** The wiki ingest session of the edition. */
  session: string;
  /** The sources the edition captured: the notes whose latest source did not hold their text. */
  sources: string[];
}

/**
 * Publishes a volume, the user's act: captures each note whose latest source does not hold its text,
 * and creates a wiki ingest session, the edition, that links those sources and adds the Journal
 * sources policy to the wiki's own. Refuses a volume with no note, and one with nothing new since its
 * last publish.
 */
export async function publish(vault: Vault, volume: string): Promise<Edition> {
  if (!volume || volume.includes("/") || volume.startsWith(".")) throw new Error(`"${volume}" is not a volume: name a folder directly under ${JOURNALS}/.`);
  const notes = await vault.list(`${JOURNALS}/${volume}`);
  if (!notes.length) throw new Error(`The volume ${volume} holds no note.`);
  // The name comes first, so a name no file can take never leaves sources behind with no session.
  const name = await freeSessionName(vault, wiki, `${volumeName(volume)} edition ${timestamp().slice(0, 10)}`);
  const index = await readSources(vault);
  const sources: string[] = [];
  for (const note of notes) {
    if (sourceOf(index, note, await hashBytes(await vault.readBinary(note)))) continue;
    sources.push(await captureSource(vault, note, index));
  }
  if (!sources.length) throw new Error(`The volume ${volume} has no change since its last publish.`);
  const policies = [...(wiki.defaults?.policies ?? []).map((p) => `${layout(wiki).folders.policies}/${p}.md`), `${layout(journals).folders.policies}/${POLICY}.md`];
  const session = await createSession(vault, wiki, name, { sources: sources.map(link), policies: policies.map(link) });
  return { session, sources };
}

/** How a volume's folder reads: `-` and `_` are spaces; a word of letters and digits is upper case, any other starts with a capital. */
export function volumeName(folder: string): string {
  return folder
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => (/\p{L}/u.test(word) && /\p{N}/u.test(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}
