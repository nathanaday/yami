import { tokens } from "../tokens.js";
import type { Algorithm } from "./index.js";

/** BM25F over the title, aliases, tags, description, and body of each note. The baseline, and the seed step of the graph algorithms. */
export const bm25: Algorithm = (wiki, query) => {
  const text = query.text ?? "";
  if (!text.trim()) return [];
  const scores = wiki.lexical(text);
  const terms = new Set(tokens(text));
  return wiki.notes.flatMap((note, i) => {
    const score = scores[i]!;
    if (score <= 0) return [];
    const inTitle = note.fields.title.some((term) => terms.has(term)) || note.fields.aliases.some((term) => terms.has(term));
    return [{ path: note.path, score, why: inTitle ? "title match" : "text match" }];
  });
};
