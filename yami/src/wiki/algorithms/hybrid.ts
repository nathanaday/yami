import { normalize } from "../bm25.js";
import { cosine } from "../embed.js";
import type { Algorithm, Scored } from "./index.js";

/** The constant of reciprocal rank fusion. */
export const RRF_K = 60;
/** How many chunks each ranking contributes to the fusion. */
export const DEPTH = 100;

/**
 * BM25 over chunks and cosine over chunk embeddings, fused with reciprocal rank fusion,
 * then rolled up to notes by their best chunk. Without an embedder, the lexical ranking
 * alone, and the reason says so.
 */
export const hybrid: Algorithm = async (wiki, query) => {
  const text = query.text ?? "";
  if (!text.trim()) return [];
  const chunks = wiki.chunks();
  const lexical = wiki.chunkLexical(text);
  const lexicalRank = rank([...lexical.keys()].filter((i) => lexical[i]! > 0), (i) => lexical[i]!);
  let semanticRank = new Map<number, number>();
  const vectors = await wiki.vectors();
  const queryVector = vectors ? await wiki.queryVector(text) : undefined;
  if (vectors && queryVector) {
    const similarity = chunks.map(({ chunk }) => cosine(queryVector, vectors.get(chunk.hash)!));
    semanticRank = rank([...similarity.keys()].filter((i) => similarity[i]! > 0), (i) => similarity[i]!);
  }
  const fused = new Map<number, number>();
  for (const [i, r] of lexicalRank) fused.set(i, (fused.get(i) ?? 0) + 1 / (RRF_K + r));
  for (const [i, r] of semanticRank) fused.set(i, (fused.get(i) ?? 0) + 1 / (RRF_K + r));
  const byNote = new Map<string, Scored>();
  for (const [i, score] of fused) {
    const { note, chunk } = chunks[i]!;
    const current = byNote.get(note.path);
    if (current && current.score >= score) continue;
    const kinds = [lexicalRank.has(i) && "lexical", semanticRank.has(i) && "semantic"].filter(Boolean).join(" + ");
    byNote.set(note.path, {
      path: note.path,
      score,
      why: `chunk "${chunk.heading}": ${kinds}${vectors ? "" : " (no embedder)"}`,
      snippet: chunk.text.length > 200 ? `${chunk.text.slice(0, 197)}…` : chunk.text,
    });
  }
  const list = [...byNote.values()];
  const normalized = normalize(list.map((hit) => hit.score));
  return list.map((hit, i) => ({ ...hit, score: normalized[i]! }));
};

/** The rank of each index, from 1, among the best `DEPTH` by value. */
function rank(indices: number[], value: (i: number) => number): Map<number, number> {
  const sorted = indices.sort((a, b) => value(b) - value(a)).slice(0, DEPTH);
  return new Map(sorted.map((i, r) => [i, r + 1]));
}
