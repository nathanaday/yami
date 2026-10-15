import { normalize } from "../bm25.js";
import type { Algorithm } from "./index.js";

export const SEEDS = 12;
export const HOPS = 2;
export const DECAY = 0.6;
export const TAG_BONUS = 0.1;
export const HUB_BONUS = 0.05;

/**
 * Two-hop decay with four signals: a note's own lexical score, the score it inherits from a
 * seed through links (cut by `DECAY` for each hop), the tags it shares with the seeds, and
 * its backlink count. Almagest's checkout ranking, with the last two signals added.
 */
export const hop2: Algorithm = (wiki, query) => {
  const seeds = wiki.seeds(query, SEEDS);
  if (!seeds.length) return [];
  const own = new Map<string, number>();
  if (query.text?.trim()) {
    const scores = wiki.lexical(query.text);
    wiki.notes.forEach((note, i) => scores[i]! > 0 && own.set(note.path, scores[i]!));
  }
  const best = new Map<string, { score: number; via?: string }>();
  let frontier = seeds.map((seed) => seed.path);
  for (const seed of seeds) best.set(seed.path, { score: seed.weight });
  for (let hop = 1; hop <= HOPS; hop++) {
    const next: string[] = [];
    for (const from of frontier) {
      const inherited = best.get(from)!.score * DECAY;
      for (const path of wiki.graph.neighbors(from)) {
        const score = Math.max(inherited, own.get(path) ?? 0);
        const seen = best.get(path);
        if (seen) {
          if (score > seen.score && seen.via) Object.assign(seen, { score, via: from });
          continue;
        }
        best.set(path, { score, via: from });
        next.push(path);
      }
    }
    frontier = next;
  }
  const seedTags = new Set(seeds.flatMap((seed) => wiki.note(seed.path)!.tags));
  const maxBacklinks = Math.max(1, ...[...best.keys()].map((path) => wiki.note(path)!.backlinks.length));
  const paths = [...best.keys()];
  const scores = paths.map((path) => {
    const note = wiki.note(path)!;
    const shared = note.tags.filter((tag) => seedTags.has(tag)).length;
    const overlap = seedTags.size ? shared / seedTags.size : 0;
    return best.get(path)!.score + TAG_BONUS * overlap + HUB_BONUS * (Math.log1p(note.backlinks.length) / Math.log1p(maxBacklinks));
  });
  const normalized = normalize(scores);
  return paths.map((path, i) => {
    const via = best.get(path)!.via;
    return { path, score: normalized[i]!, why: via ? `linked from ${wiki.note(via)!.name}` : "seed: text match" };
  });
};
