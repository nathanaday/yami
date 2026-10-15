import { normalize } from "../bm25.js";
import { mulberry32 } from "../wiki.js";
import type { Algorithm } from "./index.js";

/** The chance a walk follows a link rather than restarting at a seed. */
export const DAMPING = 0.85;

/**
 * Personalized PageRank over the link graph, with the seeds as the restart vector. Power
 * iteration by default, exact and deterministic. `params.walks` switches to Monte Carlo:
 * that many random walks with restart, with `params.seed` for the generator.
 */
export const ppr: Algorithm = (wiki, query) => {
  const seeds = wiki.seeds(query);
  if (!seeds.length) return [];
  const index = new Map(wiki.notes.map((note, i) => [note.path, i]));
  const n = wiki.notes.length;
  const restart = new Float64Array(n);
  const total = seeds.reduce((sum, seed) => sum + seed.weight, 0);
  for (const seed of seeds) restart[index.get(seed.path)!] += seed.weight / total;
  const neighbors = wiki.notes.map((note) => wiki.graph.neighbors(note.path).map((path) => index.get(path)!));
  const damping = query.params?.alpha ?? DAMPING;
  const scores = query.params?.walks ? monteCarlo(restart, neighbors, damping, query.params.walks, query.params.seed ?? 1) : power(restart, neighbors, damping);
  const normalized = normalize(scores);
  const seedSet = new Set(seeds.map((seed) => seed.path));
  return wiki.notes.flatMap((note, i) =>
    normalized[i]! > 0 ? [{ path: note.path, score: normalized[i]!, why: seedSet.has(note.path) ? "seed: text match" : "reached by links from the seeds" }] : [],
  );
};

function power(restart: Float64Array, neighbors: number[][], damping: number, iterations = 50): Float64Array {
  const n = restart.length;
  let p = Float64Array.from(restart);
  for (let round = 0; round < iterations; round++) {
    const next = new Float64Array(n);
    let dangling = 0;
    for (let u = 0; u < n; u++) {
      if (p[u] === 0) continue;
      const out = neighbors[u]!;
      if (!out.length) {
        dangling += p[u]!;
        continue;
      }
      const share = (damping * p[u]!) / out.length;
      for (const v of out) next[v] += share;
    }
    // Mass that reached a note without links restarts, as a walk would.
    const back = 1 - damping + damping * dangling;
    let delta = 0;
    for (let i = 0; i < n; i++) {
      next[i] += back * restart[i]!;
      delta += Math.abs(next[i]! - p[i]!);
    }
    p = next;
    if (delta < 1e-9) break;
  }
  return p;
}

function monteCarlo(restart: Float64Array, neighbors: number[][], damping: number, walks: number, seed: number): Float64Array {
  const random = mulberry32(seed);
  const n = restart.length;
  const cumulative = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += restart[i]!;
    cumulative[i] = sum;
  }
  const pick = () => {
    const r = random() * sum;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid]! < r) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const visits = new Float64Array(n);
  for (let w = 0; w < walks; w++) {
    let at = pick();
    visits[at] += 1;
    while (random() < damping) {
      const out = neighbors[at]!;
      if (!out.length) break;
      at = out[Math.floor(random() * out.length)]!;
      visits[at] += 1;
    }
  }
  return visits;
}
