/**
 * The folders of the knowledge base and of what the wiki keeps for itself. The wiki module's id
 * is `wiki`, so its internal folder is `internal/wiki`, as `layout()` in `yami/module` has it.
 */
export const WIKI = "wiki";
export const TOPICS = `${WIKI}/topics`;
export const SOURCES = `${WIKI}/sources`;
/** The folders a snapshot holds and a change may write. */
export const KNOWLEDGE = [TOPICS, SOURCES];
export const WIKI_INTERNAL = `internal/${WIKI}`;
export const SNAPSHOTS = `${WIKI_INTERNAL}/snapshots`;
export const CHANGES = `${WIKI_INTERNAL}/changes`;
export const CACHE_PATH = `${WIKI_INTERNAL}/cache/embeddings.json`;
/** Frozen copies of what the sources were captured from, each named by the start of its content hash. */
export const ORIGINALS = `${WIKI_INTERNAL}/originals`;

/** Whether a path is a note of the knowledge base. */
export function inKnowledge(path: string): boolean {
  return path.endsWith(".md") && KNOWLEDGE.some((folder) => path.startsWith(`${folder}/`));
}
