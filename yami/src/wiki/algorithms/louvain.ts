import { normalize } from "../bm25.js";
import type { Algorithm } from "./index.js";

/** How much of the score comes from the note's community, against its own lexical score. */
export const COMMUNITY_WEIGHT = 0.5;

/**
 * Louvain community detection, computed over the link graph at refresh. The seeds pick
 * their communities, weighted by seed score, and every member of those communities
 * ranks: half by its own lexical score, half by its community's weight.
 */
export const louvain: Algorithm = (wiki, query) => {
  const seeds = wiki.seeds(query);
  if (!seeds.length) return [];
  const own = new Map<string, number>();
  if (query.text?.trim()) {
    const scores = wiki.lexical(query.text);
    wiki.notes.forEach((note, i) => scores[i]! > 0 && own.set(note.path, scores[i]!));
  }
  const weights = new Map<number, { weight: number; top: string }>();
  for (const seed of seeds) {
    const community = wiki.note(seed.path)!.community;
    if (community === undefined) continue;
    const entry = weights.get(community) ?? { weight: 0, top: seed.path };
    entry.weight += seed.weight;
    if (seed.weight > (weights.get(community)?.weight ?? 0)) entry.top = seed.path;
    weights.set(community, entry);
  }
  const maxWeight = Math.max(1e-9, ...[...weights.values()].map((entry) => entry.weight));
  const scores = wiki.notes.map((note) => {
    const community = note.community !== undefined ? weights.get(note.community) : undefined;
    const fromCommunity = community ? community.weight / maxWeight : 0;
    return (1 - COMMUNITY_WEIGHT) * (own.get(note.path) ?? 0) + COMMUNITY_WEIGHT * fromCommunity;
  });
  const normalized = normalize(scores);
  return wiki.notes.flatMap((note, i) => {
    if (normalized[i]! <= 0) return [];
    const community = note.community !== undefined ? weights.get(note.community) : undefined;
    const why = own.has(note.path) ? "text match" : community ? `in the community of ${wiki.note(community.top)!.name}` : "text match";
    return [{ path: note.path, score: normalized[i]!, why }];
  });
};
