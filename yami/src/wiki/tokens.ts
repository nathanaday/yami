const STOP = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "for", "from", "has", "have", "if", "in", "into", "is", "it", "its",
  "no", "not", "of", "on", "or", "so", "than", "that", "the", "their", "them", "then", "there", "these", "they", "this", "those", "to",
  "was", "were", "will", "with", "what", "which", "does", "do", "how", "we", "our", "i", "my", "about", "also",
]);

/** Splits text into search terms: lower case letters and digits, without the commonest words, each plural folded to its singular. */
export function tokens(text: string): string[] {
  const out: string[] = [];
  for (const word of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (word.length < 2 || STOP.has(word)) continue;
    out.push(stem(word));
  }
  return out;
}

/** Folds a plural to its singular: `ies` to `y`, `sses`, `shes`, `ches`, and `xes` to their stem, and a trailing `s` that is not `ss`, `us`, or `is`. */
export function stem(term: string): string {
  if (term.length > 4 && term.endsWith("ies")) return `${term.slice(0, -3)}y`;
  if (term.length > 5 && /(ss|sh|ch|x)es$/.test(term)) return term.slice(0, -2);
  if (term.length > 3 && term.endsWith("s") && !/(ss|us|is)$/.test(term)) return term.slice(0, -1);
  return term;
}

/** Folds a name for comparison: lower case, trimmed, every run of space and punctuation made one space. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .join(" ");
}

/** A 53-bit hash of a string, as hex. The key of the embedding cache. */
export function hash(text: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}
