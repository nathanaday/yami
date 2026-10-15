/** BM25F: BM25 over several weighted fields of each document. */
export interface Bm25Options {
  k1?: number;
  b?: number;
}

export type Fields = Record<string, string[]>;

export class Bm25 {
  private readonly tf: Map<string, number>[] = [];
  private readonly lengths: number[] = [];
  private readonly df = new Map<string, number>();
  private avg = 1;
  private readonly k1: number;
  private readonly b: number;

  constructor(
    docs: Fields[],
    private readonly weights: Record<string, number>,
    options: Bm25Options = {},
  ) {
    this.k1 = options.k1 ?? 1.2;
    this.b = options.b ?? 0.75;
    let total = 0;
    for (const doc of docs) {
      const tf = new Map<string, number>();
      let length = 0;
      for (const [field, weight] of Object.entries(weights)) {
        for (const term of doc[field] ?? []) {
          tf.set(term, (tf.get(term) ?? 0) + weight);
          length += weight;
        }
      }
      for (const term of tf.keys()) this.df.set(term, (this.df.get(term) ?? 0) + 1);
      this.tf.push(tf);
      this.lengths.push(length);
      total += length;
    }
    if (docs.length && total > 0) this.avg = total / docs.length;
  }

  get size(): number {
    return this.tf.length;
  }

  /** The score of each document against the terms. Zero where no term occurs. */
  scores(terms: string[]): Float64Array {
    const n = this.tf.length;
    const query = [...new Set(terms)];
    const idf = query.map((term) => {
      const df = this.df.get(term) ?? 0;
      return Math.log(1 + (n - df + 0.5) / (df + 0.5));
    });
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const tf = this.tf[i]!;
      const norm = this.k1 * (1 - this.b + (this.b * this.lengths[i]!) / this.avg);
      let score = 0;
      for (let q = 0; q < query.length; q++) {
        const w = tf.get(query[q]!);
        if (!w) continue;
        score += (idf[q]! * (w * (this.k1 + 1))) / (w + norm);
      }
      out[i] = score;
    }
    return out;
  }

  /** The score a document made of the terms alone, in `field`, would get: the ceiling for normalizing. */
  self(terms: string[], field: string): number {
    const weight = this.weights[field] ?? 1;
    const n = this.tf.length + 1;
    const length = weight * terms.length;
    const avg = (this.avg * this.tf.length + length) / n;
    const norm = this.k1 * (1 - this.b + (this.b * length) / avg);
    const counts = new Map<string, number>();
    for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);
    let score = 0;
    for (const [term, count] of counts) {
      const df = (this.df.get(term) ?? 0) + 1;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      const w = count * weight;
      score += (idf * (w * (this.k1 + 1))) / (w + norm);
    }
    return score;
  }
}

/** Scales scores so the best is 1. Leaves all-zero scores as they are. */
export function normalize(scores: ArrayLike<number>): Float64Array {
  let max = 0;
  for (let i = 0; i < scores.length; i++) max = Math.max(max, scores[i]!);
  const out = new Float64Array(scores.length);
  if (max <= 0) return out;
  for (let i = 0; i < scores.length; i++) out[i] = scores[i]! / max;
  return out;
}
