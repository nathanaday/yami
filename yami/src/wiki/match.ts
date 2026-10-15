import { Bm25, type Fields } from "./bm25.js";
import { normalizeName, tokens } from "./tokens.js";
import type { Note, Wiki } from "./wiki.js";

/** The normalized score above which a note is near a name. */
export const THRESHOLD = 0.35;
export const NEAR_NEIGHBORS = 5;
export const NEW_NEIGHBORS = 3;

export interface MatchOptions {
  /** The note types to match against. Default: topic and source. */
  types?: string[];
}

export interface Neighbor {
  path: string;
  score: number;
}

export interface Match {
  name: string;
  /** `hit`: a note holds the name or an alias. `near`: a note scores above the threshold. `new`: nothing close. */
  match: "hit" | "near" | "new";
  path?: string;
  neighbors: Neighbor[];
}

/** Matches each name against the names, aliases, and descriptions of the typed notes. */
export function match(wiki: Wiki, names: string[], options: MatchOptions = {}): Match[] {
  const types = options.types ?? ["topic", "source"];
  const notes = wiki.notes.filter((note) => note.type !== undefined && types.includes(note.type));
  const all = new Set([...notes.flatMap((note) => [note.name, ...note.aliases]), ...names].map(normalizeName));
  const fold = singular(all);
  const byName = new Map<string, Note>();
  for (const note of notes) for (const alias of [note.name, ...note.aliases]) byName.set(fold(alias), note);
  const corpus = new Bm25(
    notes.map((note): Fields => ({ title: note.fields.title, aliases: note.fields.aliases, description: note.fields.description })),
    { title: 3, aliases: 3, description: 2 },
  );
  return names.map((name) => {
    const hit = byName.get(fold(name));
    const terms = tokens(name);
    const ceiling = corpus.self(terms, "title");
    const scores = ceiling > 0 ? corpus.scores(terms) : new Float64Array(notes.length);
    const ranked = [...scores.keys()]
      .filter((i) => scores[i]! > 0 && notes[i] !== hit)
      .map((i) => ({ path: notes[i]!.path, score: Math.round(Math.min(1, scores[i]! / ceiling) * 100) / 100 }))
      .sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : 1));
    if (hit) return { name, match: "hit", path: hit.path, neighbors: ranked.filter((n) => n.score >= THRESHOLD).slice(0, NEAR_NEIGHBORS) };
    const near = ranked.some((n) => n.score >= THRESHOLD);
    return {
      name,
      match: near ? "near" : "new",
      neighbors: near ? ranked.filter((n) => n.score >= THRESHOLD).slice(0, NEAR_NEIGHBORS) : ranked.slice(0, NEW_NEIGHBORS),
    };
  });
}

/** Folds a name for comparison, and a trailing plural `s` only when the singular also occurs among the names. */
function singular(all: Set<string>): (name: string) => string {
  return (name) => {
    const normalized = normalizeName(name);
    const short = normalized.slice(0, -1);
    return normalized.length > 3 && normalized.endsWith("s") && !normalized.endsWith("ss") && all.has(short) ? short : normalized;
  };
}
