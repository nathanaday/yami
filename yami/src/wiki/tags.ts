import type { Note } from "./wiki.js";

/** A tag of the hierarchy, where `a/b` is below `a`, and how many notes hold it or a tag below it. */
export interface TagCount {
  tag: string;
  count: number;
}

/** One tag and what is around it: the tags above it, the tags one level below it, and the notes that hold it. */
export interface TagView {
  /** The tag, or `""` for the top of the hierarchy. */
  tag: string;
  /** The notes that hold the tag or a tag below it. At the top: the notes that hold any tag. */
  count: number;
  /** The tags above it, the top first: `a/b/c` has `a`, then `a/b`. */
  above: TagCount[];
  /** The tags one level below it, most notes first. At the top: each tag with no `/`. */
  below: TagCount[];
  /** The notes that hold the tag itself, as paths, by name. A note that holds only a tag below it is under that tag. At the top: none. */
  notes: string[];
}

/** Where a note sits in the tag hierarchy. */
export interface Neighbors {
  path: string;
  /** The tags that the note holds itself, without the tags above them. */
  tags: TagCount[];
  /** The tags above the note's tags, the top first, without the note's own. */
  above: TagCount[];
  /** The tags one level below the note's tags, most notes first, without the note's own. */
  below: TagCount[];
}

/** The tag above a tag: `a/b/c` gives `a/b`, and `a` gives `""`, the top. */
function parentTag(tag: string): string {
  const slash = tag.lastIndexOf("/");
  return slash === -1 ? "" : tag.slice(0, slash);
}

/** The tags above a tag, the top first: `a/b/c` gives `a`, then `a/b`. */
function tagsAbove(tag: string): string[] {
  const parts = tag.split("/");
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
}

/** The tag hierarchy of the indexed notes. Built at each refresh; it stores nothing. */
export class TagIndex {
  private readonly counts = new Map<string, number>();
  private readonly holders = new Map<string, Note[]>();
  private readonly children = new Map<string, Set<string>>();
  private readonly tagged: number;

  constructor(notes: Note[]) {
    for (const note of notes) {
      for (const tag of note.tags) this.counts.set(tag, (this.counts.get(tag) ?? 0) + 1);
      for (const tag of note.ownTags) {
        const holders = this.holders.get(tag);
        if (holders) holders.push(note);
        else this.holders.set(tag, [note]);
      }
    }
    for (const tag of this.counts.keys()) {
      const parent = parentTag(tag);
      let set = this.children.get(parent);
      if (!set) this.children.set(parent, (set = new Set()));
      set.add(tag);
    }
    this.tagged = notes.filter((note) => note.ownTags.length).length;
  }

  /** A tag and what is around it, or the top of the hierarchy for `""`. Undefined for a tag that no note holds. */
  view(tag: string): TagView | undefined {
    if (tag === "") return { tag, count: this.tagged, above: [], below: this.below([""]), notes: [] };
    const count = this.counts.get(tag);
    if (count === undefined) return undefined;
    const notes = [...(this.holders.get(tag) ?? [])].sort(byName).map((note) => note.path);
    return { tag, count, above: tagsAbove(tag).map((t) => this.count(t)), below: this.below([tag]), notes };
  }

  /** Where a note sits: its own tags, the tags above them, and the tags one level below them. */
  neighbors(note: Note): Neighbors {
    const own = new Set(note.ownTags);
    const above = [...new Set(note.ownTags.flatMap(tagsAbove))].filter((tag) => !own.has(tag));
    above.sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
    return {
      path: note.path,
      tags: [...own].sort((a, b) => a.localeCompare(b)).map((tag) => this.count(tag)),
      above: above.map((tag) => this.count(tag)),
      // A tag above one of the note's tags can be below another, as ml/vision for ml and ml/vision/detection: it shows once, above.
      below: this.below([...own]).filter(({ tag }) => !own.has(tag) && !above.includes(tag)),
    };
  }

  /** Every tag, most notes first, then by name. */
  all(): TagCount[] {
    return [...this.counts.keys()].map((tag) => this.count(tag)).sort(byCount);
  }

  private count(tag: string): TagCount {
    return { tag, count: this.counts.get(tag) ?? 0 };
  }

  /** The tags one level below any of the given tags, most notes first, then by name. */
  private below(tags: string[]): TagCount[] {
    const found = new Set(tags.flatMap((tag) => [...(this.children.get(tag) ?? [])]));
    return [...found].map((tag) => this.count(tag)).sort(byCount);
  }
}

function byCount(a: TagCount, b: TagCount): number {
  return b.count - a.count || a.tag.localeCompare(b.tag);
}

function byName(a: Note, b: Note): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.path.localeCompare(b.path);
}
