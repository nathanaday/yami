import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import { link, LINK, linkTarget, parseDocument, PropertiesError, updateDocument, writeDocument } from "../document/document.js";
import { timestamp } from "../document/schema.js";
import type { Properties, Vault } from "../document/vault.js";
import { algorithms, type Algorithm, type Hit, type Query, type Scored } from "./algorithms/index.js";
import { Bm25, normalize, type Fields } from "./bm25.js";
import { applyWrites, changeDocument, changePath, validatePlan, type AppliedChange, type ChangePlan } from "./change.js";
import { chunk, type Chunk } from "./chunks.js";
import { EmbeddingCache, type Embedder } from "./embed.js";
import { CACHE_PATH, ORIGINALS } from "./folders.js";
import { lint, type Finding, type LintOptions } from "./lint.js";
import { match, type Match, type MatchOptions } from "./match.js";
import { TagIndex, type Neighbors, type TagCount, type TagView } from "./tags.js";
import { tokens } from "./tokens.js";
import { captured, snapshot, versions, writeArchive, type Captured, type SnapshotOptions, type Version } from "./versions.js";

/** One note of the vault, as the index holds it. */
export interface Note {
  path: string;
  /** The file name without `.md`: what a `[[link]]` names. */
  name: string;
  type?: string;
  properties: Properties;
  body: string;
  aliases: string[];
  /** Lower case, without `#`. A note holds a tag and every tag above it. */
  tags: string[];
  /** The tags that the note's `tags` property holds itself, in the same form, without the tags above them. */
  ownTags: string[];
  description: string;
  /** The notes this note links, as paths. */
  links: string[];
  /** Link targets that resolve to no note. */
  unresolved: string[];
  /** The notes that link this note, as paths. */
  backlinks: string[];
  chunks: Chunk[];
  /** The search terms of each ranked field. */
  fields: Fields;
  /** The Louvain community, when the graph has edges. */
  community?: number;
  /** Why the note's properties do not parse. The index holds the note with no properties until they do. */
  problem?: string;
}

export interface WikiOptions {
  /** Folders and files that stay out of the index. A function is read at each refresh, so it can follow a setting. */
  exclude?: string[] | (() => string[]);
  /** Note types that stay out of the index. Default: the records that are not knowledge, and copy it: conversation, session, module, change, snapshot. */
  skipTypes?: string[];
  embedder?: Embedder;
  /** Where the embeddings are kept. Default `internal/wiki/cache/embeddings.json`. */
  cachePath?: string;
  /** The algorithm of a query that names none. Default `bm25`. */
  defaultAlgorithm?: string;
}

export const FIELD_WEIGHTS = { title: 3, aliases: 3, tags: 2, description: 2, body: 1 };

/** Files that are not knowledge: the instructions of module skills and agents, and the frozen copies that sources embed. */
const UNINDEXED = [/^internal\/[^/]+\/(skills|agents)\//, new RegExp(`^${ORIGINALS}/`)];

/** A seed of a graph query: a note and its weight. */
export interface Seed {
  path: string;
  weight: number;
}

/**
 * The knowledge base: every note of the vault, the link graph over them, and the queries.
 * `refresh()` reads the vault again; the index has no state of its own to go stale.
 */
export class Wiki {
  notes: Note[] = [];
  readonly graph = new Graph({ type: "directed" });
  private byPath = new Map<string, Note>();
  private tagIndex = new TagIndex([]);
  /** Every note of the vault, indexed or not, by path and by lower-case name: what a link can name. */
  private everyPath = new Set<string>();
  private everyName = new Map<string, string[]>();
  private bm25 = new Bm25([], FIELD_WEIGHTS);
  private chunkList: { note: Note; chunk: Chunk }[] = [];
  private chunkBm25 = new Bm25([], { text: 1 });
  private cache: EmbeddingCache | undefined;
  private fresh = false;
  /** Counts the invalidations, so a refresh that a change overtook does not mark the index fresh. */
  private changes = 0;
  private pending: Promise<void> | undefined;
  /** Snapshots, restores, and changes run one at a time, in the order they arrive. */
  private serial: Promise<unknown> = Promise.resolve();
  readonly options: Required<Pick<WikiOptions, "exclude" | "skipTypes" | "defaultAlgorithm">> & WikiOptions;

  constructor(
    readonly vault: Vault,
    options: WikiOptions = {},
  ) {
    this.options = {
      exclude: [],
      skipTypes: ["conversation", "session", "module", "change", "snapshot"],
      defaultAlgorithm: "bm25",
      ...options,
    };
    if (options.embedder) this.cache = new EmbeddingCache(vault, options.embedder, options.cachePath ?? CACHE_PATH);
  }

  get embedder(): Embedder | undefined {
    return this.options.embedder;
  }

  /** Reads every note and builds the index, the graph, and the communities. */
  async refresh(): Promise<void> {
    const changes = this.changes;
    const exclude = this.excluded();
    const all = await this.vault.list("");
    this.everyPath = new Set(all);
    this.everyName = new Map();
    for (const path of all) {
      const key = path.slice(path.lastIndexOf("/") + 1, -3).toLowerCase();
      this.everyName.set(key, [...(this.everyName.get(key) ?? []), path]);
    }
    const paths = all.filter((path) => this.reads(path, exclude));
    const notes: Note[] = [];
    for (const path of paths) {
      // One note with broken properties must not stop the index: it goes in with its body, and lint names it.
      let doc;
      let problem: string | undefined;
      try {
        doc = parseDocument(this.vault, path, await this.vault.read(path));
      } catch (error) {
        if (!(error instanceof PropertiesError)) throw error;
        doc = { path, properties: {}, body: error.body };
        problem = error.reason;
      }
      if (!this.keeps(doc.properties)) continue;
      const type = typeof doc.properties.type === "string" ? doc.properties.type : undefined;
      const name = path.slice(path.lastIndexOf("/") + 1, -3);
      const aliases = list(doc.properties.aliases);
      const ownTags = [...new Set(list(doc.properties.tags).map(normalizeTag).filter(Boolean))];
      const tags = expandTags(ownTags);
      const description = typeof doc.properties.description === "string" ? doc.properties.description : "";
      notes.push({
        path,
        name,
        type,
        properties: doc.properties,
        body: doc.body,
        aliases,
        tags,
        ownTags,
        description,
        links: [],
        unresolved: [],
        backlinks: [],
        ...(problem && { problem }),
        chunks: chunk(doc.body, name),
        fields: {
          title: tokens(name),
          aliases: tokens(aliases.join(" ")),
          tags: tokens(tags.join(" ")),
          description: tokens(description),
          body: tokens(doc.body),
        },
      });
    }
    this.notes = notes.sort((a, b) => (a.path < b.path ? -1 : 1));
    this.byPath = new Map(notes.map((note) => [note.path, note]));
    this.tagIndex = new TagIndex(notes);
    this.graph.clear();
    for (const note of notes) this.graph.addNode(note.path);
    for (const note of notes) {
      for (const target of linkTargets(note.body, note.properties)) {
        const path = this.locate(target);
        if (!path) {
          if (!/\.[a-z0-9]{1,5}$/i.test(target) && !note.unresolved.includes(target)) note.unresolved.push(target);
          continue;
        }
        // A link to a note the index leaves out, such as a session, works; it is not an edge of the graph.
        if (!this.byPath.has(path) || path === note.path || note.links.includes(path)) continue;
        note.links.push(path);
        this.byPath.get(path)!.backlinks.push(note.path);
        this.graph.mergeEdge(note.path, path);
      }
    }
    this.bm25 = new Bm25(
      notes.map((note) => note.fields),
      FIELD_WEIGHTS,
    );
    this.chunkList = notes.flatMap((note) => note.chunks.map((chunk) => ({ note, chunk })));
    this.chunkBm25 = new Bm25(
      this.chunkList.map(({ chunk }) => ({ text: tokens(chunk.text) })),
      { text: 1 },
    );
    if (this.graph.size > 0) {
      const communities = louvain(this.graph, { rng: mulberry32(1) });
      for (const note of notes) note.community = communities[note.path];
    }
    this.fresh = changes === this.changes;
  }

  /** Refreshes when the index is stale. Calls that arrive during a refresh wait for that one. */
  async ensure(): Promise<void> {
    while (!this.fresh) {
      this.pending ??= this.refresh().finally(() => (this.pending = undefined));
      await this.pending;
    }
  }

  /** Reads the vault again, and says what the index holds now and how long the read took. */
  async rebuild(): Promise<{ notes: number; links: number; communities: number; ms: number }> {
    const started = performance.now();
    await this.refresh();
    const communities = new Set(this.notes.map((note) => note.community).filter((c) => c !== undefined)).size;
    return { notes: this.notes.length, links: this.graph.size, communities, ms: Math.round(performance.now() - started) };
  }

  /** Marks the index stale, so the next query reads the vault again. */
  invalidate(): void {
    this.fresh = false;
    this.changes += 1;
  }

  note(path: string): Note | undefined {
    return this.byPath.get(path);
  }

  /**
   * Finds the note a link names, as Obsidian does, among every note of the vault: a path, with or
   * without `.md`, or a name; a name that several notes share goes to the shortest path. The note may
   * be one the index leaves out, such as a session or a change.
   */
  locate(target: string): string | undefined {
    const clean = linkTarget(target);
    if (!clean) return undefined;
    // A target with another file's extension names an attachment, not a note.
    if (/\.[a-z0-9]{1,5}$/i.test(clean) && !clean.endsWith(".md")) return undefined;
    const file = clean.endsWith(".md") ? clean : `${clean}.md`;
    if (this.everyPath.has(file)) return file;
    const name = (clean.endsWith(".md") ? clean.slice(0, -3) : clean).split("/").pop()!.toLowerCase();
    const matches = this.everyName.get(name);
    if (!matches?.length) return undefined;
    return [...matches].sort((a, b) => a.length - b.length || (a < b ? -1 : 1))[0];
  }

  /** The indexed note a link names: what `locate` finds, when the index holds it. */
  resolve(target: string): string | undefined {
    const path = this.locate(target);
    return path && this.byPath.has(path) ? path : undefined;
  }

  /** Ranks the notes with an algorithm, then applies the query's filters and limit. */
  async search(text: string, query: Omit<Query, "text"> = {}): Promise<Hit[]> {
    await this.ensure();
    const full: Query = { ...query, text };
    const name = full.algorithm ?? this.options.defaultAlgorithm;
    const algorithm: Algorithm | undefined = algorithms[name];
    if (!algorithm) throw new Error(`No algorithm named "${name}". The algorithms are ${Object.keys(algorithms).join(", ")}.`);
    const scored = await algorithm(this, full);
    const keep = this.filter(full);
    const hits = scored
      .filter((hit) => hit.score > 0 && keep(this.byPath.get(hit.path)!))
      .sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : 1))
      .slice(0, full.limit ?? 20);
    const terms = tokens(text);
    return hits.map((hit) => ({
      ...hit,
      score: Math.round(hit.score * 1000) / 1000,
      snippet: hit.snippet ?? snippet(this.byPath.get(hit.path)!, terms),
    }));
  }

  /** Where each name stands in the wiki: a note holds it, a note is near it, or it is new. */
  async match(names: string[], options: MatchOptions = {}): Promise<Match[]> {
    await this.ensure();
    return match(this, names, options);
  }

  /** The health of the notes: each finding names its fix. */
  async lint(options: LintOptions = {}): Promise<Finding[]> {
    await this.ensure();
    return lint(this, options);
  }

  /** The notes that a query's `types`, `tags`, and `folder` keep. */
  filter(query: Pick<Query, "types" | "tags" | "folder">): (note: Note) => boolean {
    const tags = (query.tags ?? []).map(normalizeTag);
    return (note) =>
      (!query.types?.length || (note.type !== undefined && query.types.includes(note.type))) &&
      tags.every((tag) => note.tags.includes(tag)) &&
      (!query.folder || note.path.startsWith(`${query.folder.replace(/\/$/, "")}/`));
  }

  /** BM25 over the notes, as scores in `[0, 1]`, one for each note in `notes` order. */
  lexical(text: string): Float64Array {
    return normalize(this.bm25.scores(tokens(text)));
  }

  /** The seeds of a graph query: the query's own seeds with weight 1, and the best lexical hits. */
  seeds(query: Query, limit = 20): Seed[] {
    const seeds = new Map<string, number>();
    for (const target of query.seeds ?? []) {
      const path = this.resolve(target);
      if (path) seeds.set(path, 1);
    }
    if (query.text?.trim()) {
      const scores = this.lexical(query.text);
      const ranked = [...scores.keys()].filter((i) => scores[i]! > 0).sort((a, b) => scores[b]! - scores[a]!);
      for (const i of ranked.slice(0, limit)) {
        const path = this.notes[i]!.path;
        seeds.set(path, Math.max(seeds.get(path) ?? 0, scores[i]!));
      }
    }
    return [...seeds].map(([path, weight]) => ({ path, weight }));
  }

  /** The chunks of every note, with BM25 scores against the text. */
  chunks(): { note: Note; chunk: Chunk }[] {
    return this.chunkList;
  }

  chunkLexical(text: string): Float64Array {
    return this.chunkBm25.scores(tokens(text));
  }

  /** The vector of each chunk, from the cache or the embedder. Undefined without an embedder. */
  async vectors(): Promise<Map<string, Float32Array> | undefined> {
    if (!this.cache) return undefined;
    return this.cache.vectorsOf(
      this.chunkList.map(({ chunk }) => chunk.hash),
      this.chunkList.map(({ chunk }) => chunk.text),
    );
  }

  async queryVector(text: string): Promise<Float32Array | undefined> {
    return this.cache?.query(text);
  }

  /** The score ceiling for a text made only of these terms, against the notes' names, aliases, and descriptions. */
  nameCeiling(terms: string[]): number {
    return this.bm25.self(terms, "title");
  }
  /**
   * A tag and what is around it in the tag hierarchy, where `a/b` is below `a`: the tags above it, the tags
   * one level below it, and the notes that hold it. With no tag, the top: each tag with no `/`. Undefined for a
   * tag that no note holds. It reads the vault again first when the index is stale.
   */
  async tag(tag = ""): Promise<TagView | undefined> {
    await this.ensure();
    return this.tagIndex.view(normalizeTag(tag));
  }

  /**
   * Where a note sits in the tag hierarchy: its own tags, the tags above them, and the tags one level below
   * them, each with the count of notes under it. The note is a path or a link name. Undefined for a note that
   * the index does not hold. It reads the vault again first when the index is stale.
   */
  async neighbors(note: string): Promise<Neighbors | undefined> {
    await this.ensure();
    const path = this.resolve(note);
    const found = path ? this.byPath.get(path) : undefined;
    return found ? this.tagIndex.neighbors(found) : undefined;
  }

  /** The tags of the indexed notes with the count of notes that hold each or a tag below it, most used first. */
  tags(): TagCount[] {
    return this.tagIndex.all();
  }

  /**
   * Whether the index holds the note at a path that has these properties: a note outside the excluded
   * folders, the module skills and agents, and the originals, of no skipped type, and no copy of another
   * note. A host's change feed uses it to pass over a change that cannot change the wiki.
   */
  holds(path: string, properties: Properties = {}): boolean {
    return path.endsWith(".md") && this.reads(path, this.excluded()) && this.keeps(properties);
  }

  private excluded(): string[] {
    return (typeof this.options.exclude === "function" ? this.options.exclude() : this.options.exclude).map((entry) => entry.replace(/\/$/, ""));
  }

  /** Whether the index reads a note at this path. */
  private reads(path: string, exclude: string[]): boolean {
    return !UNINDEXED.some((pattern) => pattern.test(path)) && !exclude.some((entry) => path === entry || path.startsWith(`${entry}/`));
  }

  /** Whether the index keeps a note with these properties. A copy of another note, such as a checkout copy, is not knowledge of its own. */
  private keeps(properties: Properties): boolean {
    const type = typeof properties.type === "string" ? properties.type : undefined;
    return !(type && this.options.skipTypes.includes(type)) && properties.copy_of === undefined;
  }

  /** Every version of the knowledge base, oldest first. */
  versions(): Promise<Version[]> {
    return versions(this.vault);
  }

  /** Whether the latest snapshot holds the knowledge base as it is now. */
  captured(): Promise<Captured> {
    return captured(this.vault);
  }

  /** Saves the knowledge base as the next version. */
  snapshot(options: SnapshotOptions = {}): Promise<Version> {
    return this.queued(() => snapshot(this.vault, options));
  }

  /**
   * Puts the knowledge base back as a version holds it, and records the result as a new version,
   * so the history stays one line. The state before the restore is snapshotted first when it is not.
   */
  restore(version: number): Promise<Version> {
    return this.queued(async () => {
      const target = (await versions(this.vault)).find((v) => v.version === version);
      if (!target) throw new Error(`There is no version ${version}.`);
      if (!(await captured(this.vault)).captured) await snapshot(this.vault);
      await writeArchive(this.vault, target);
      this.invalidate();
      return snapshot(this.vault, { restored: version });
    });
  }

  /**
   * Applies a change plan as one step: validates it, snapshots the knowledge base when its state is
   * not captured, writes the change document, applies the writes, snapshots again, and links the
   * change from the session. A write that fails puts the knowledge base back at the version before.
   */
  change(plan: ChangePlan): Promise<AppliedChange> {
    return this.queued(async () => {
      await this.refresh();
      const warnings = await validatePlan(this, plan);
      const state = await captured(this.vault);
      const before = state.captured && state.latest ? state.latest : await snapshot(this.vault);
      const now = timestamp();
      const path = await changePath(this.vault, plan.title, now);
      const counts = {
        creates: plan.writes.filter((w) => w.op === "create").length,
        modifies: plan.writes.filter((w) => w.op === "modify").length,
        removes: plan.writes.filter((w) => w.op === "remove").length,
      };
      const properties: Properties = { status: "applying", before: before.version, ...counts };
      if (plan.session) properties.session = link(plan.session);
      await writeDocument(this.vault, changeDocument(this.vault, path, plan, properties, this));
      try {
        await applyWrites(this.vault, plan, now);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await writeArchive(this.vault, before);
        this.invalidate();
        await updateDocument(this.vault, path, (doc) => Object.assign(doc.properties, { status: "failed", error: message }));
        throw new Error(`The change failed, and the wiki is back at version ${before.version}: ${message}`);
      }
      this.invalidate();
      const after = await snapshot(this.vault, { change: path });
      await updateDocument(this.vault, path, (doc) => Object.assign(doc.properties, { status: "applied", applied: timestamp(), after: after.version }));
      if (plan.session) {
        await updateDocument(this.vault, plan.session, (doc) => {
          const list = Array.isArray(doc.properties.changes) ? (doc.properties.changes as unknown[]) : [];
          doc.properties.changes = [...list, link(path)];
        });
      }
      return { path, before: before.version, after: after.version, ...counts, warnings };
    });
  }

  private queued<T>(work: () => Promise<T>): Promise<T> {
    const run = this.serial.then(work, work);
    this.serial = run.catch(() => undefined);
    return run;
  }
}

export type { Algorithm, Hit, Query, Scored };

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item !== "");
  return typeof value === "string" && value ? value.split(",").map((item) => item.trim()).filter(Boolean) : [];
}

/** A tag as the index holds it: lower case, without `#`, and with no empty part between `/`. */
export function normalizeTag(tag: string): string {
  return tag
    .trim()
    .replace(/^#+/, "")
    .toLowerCase()
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
}

/** A tag list with every tag above each tag: `a/b/c` adds `a/b` and `a`. */
export function expandTags(tags: string[]): string[] {
  const out = new Set<string>();
  for (const raw of tags) {
    const tag = normalizeTag(raw);
    if (!tag) continue;
    const parts = tag.split("/");
    for (let i = 1; i <= parts.length; i++) out.add(parts.slice(0, i).join("/"));
  }
  return [...out];
}


/** The targets of every `[[link]]` in a body and in the link properties. */
function linkTargets(body: string, properties: Properties): string[] {
  const out: string[] = [];
  const text = body.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  for (const match of text.matchAll(LINK)) out.push(match[1]!.trim());
  for (const value of Object.values(properties)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (typeof item === "string") for (const match of item.matchAll(LINK)) out.push(match[1]!.trim());
    }
  }
  return out;
}

/** The body line that holds the most query terms, cut to 200 characters. */
export function snippet(note: Note, terms: string[]): string {
  const want = new Set(terms);
  let best = "";
  let bestCount = 0;
  for (const raw of note.body.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("|---") || line.startsWith("#")) continue;
    const count = new Set(tokens(line).filter((term) => want.has(term))).size;
    if (count > bestCount) {
      best = line;
      bestCount = count;
    }
  }
  if (!best) best = note.description || note.body.split("\n").find((line) => line.trim() && !line.startsWith("#"))?.trim() || "";
  return best.length > 200 ? `${best.slice(0, 197)}…` : best;
}

/** A small seeded random generator, so walks and communities repeat in tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
