import { YamiModule } from "yami";
import { linksOf, timestamp } from "yami/document";
import { hashBytes, readSources, sourceOf } from "yami/wiki";
import journalPolicy from "./policies/Journal sources.md";

/** The folder of the volumes: each folder directly under it is one volume of the user's writing. */
export const JOURNALS = "journals";

export interface Volume {
  /** The folder name, under `journals/`. */
  volume: string;
  /** How the folder reads: `cs566-notes` is "CS566 Notes". */
  name: string;
  notes: number;
  /** The notes whose latest source does not hold their text: new, or changed since their last publish. */
  unpublished: number;
}

export interface Edition {
  /** The wiki ingest session of the edition. */
  session: string;
  /** The sources the edition captured: the notes whose latest source did not hold their text. */
  sources: string[];
}

/** The user's own writing, which the wiki learns from only when the user publishes a volume. */
export class Journals extends YamiModule {
  readonly id = "journals";
  readonly name = "Journals";
  readonly description = `The user's own writing, one volume per folder of ${JOURNALS}/. Publishing a volume captures its new and changed notes as sources and starts a wiki ingest session, an edition.`;
  readonly sessionsIn = "none";

  readonly journalSources = this.policy("Journal sources", journalPolicy);

  readonly publishVolume = this.action({
    id: "publish",
    name: "Publish a volume",
    choose: {
      items: async () => [...(await this.volumes())].sort((a, b) => Number(b.unpublished > 0) - Number(a.unpublished > 0)),
      label: (v) => `${v.name} · ${v.unpublished ? `${v.unpublished} of ${v.notes} notes to publish` : "nothing new"}`,
      placeholder: "The volume to publish",
      empty: `No volume: a volume is a folder directly under ${JOURNALS}/.`,
    },
    run: async (picked) => {
      const edition = await this.publish(picked.volume);
      return { message: `Published ${picked.name}: ${edition.sources.length} source(s). Run the edition's session to absorb them.`, open: edition.session };
    },
  });

  /** Each volume, with its notes and how many of them wait to be published. */
  async volumes(): Promise<Volume[]> {
    const vault = this.vault;
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

  /**
   * Publishes a volume, the user's act: captures each note whose latest source does not hold its text,
   * and creates a wiki ingest session, the edition, with those sources and the Journal sources policy on
   * top of the wiki's own. Refuses a volume with no note, and one with nothing new since its last publish.
   */
  async publish(volume: string): Promise<Edition> {
    const vault = this.vault;
    if (!volume || volume.includes("/") || volume.startsWith(".")) throw new Error(`"${volume}" is not a volume: name a folder directly under ${JOURNALS}/.`);
    const notes = await vault.list(`${JOURNALS}/${volume}`);
    if (!notes.length) throw new Error(`The volume ${volume} holds no note.`);
    const index = await readSources(vault);
    const changed: string[] = [];
    for (const note of notes) if (!sourceOf(index, note, await hashBytes(await vault.readBinary(note)))) changed.push(note);
    if (!changed.length) throw new Error(`The volume ${volume} has no change since its last publish.`);
    const session = await this.yami.ingest({ files: changed, name: `${volumeName(volume)} edition ${timestamp().slice(0, 10)}`, policies: [this.journalSources] });
    return { session: session.path, sources: linksOf((await session.read()).properties.sources).map((target) => `${target}.md`) };
  }
}

/** How a volume's folder reads: `-` and `_` are spaces; a word of letters and digits is upper case, any other starts with a capital. */
export function volumeName(folder: string): string {
  return folder
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => (/\p{L}/u.test(word) && /\p{N}/u.test(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}
