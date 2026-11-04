import { basename, linksOf } from "../../document/document.js";
import { readProposal, type Proposal } from "../../wiki/change.js";
import type { Check, CheckContext } from "../checks.js";

/** Where a staged note of an import stands against the wiki. */
export type StagedStatus = "new" | "near" | "conflict";

/** One note of a bundle, staged in the session's folder for the run to merge. */
export interface StagedNote {
  /** The staged copy, in the session's folder. */
  staged: string;
  /** Where the note goes in the knowledge base. */
  target: string;
  type: "topic" | "source";
  status: StagedStatus;
  /** The notes of the wiki that stand in the way, or near: a note at the target, one that holds the name, or the neighbors. */
  with: string[];
  /** One line for the Import section. */
  reason: string;
}

/** What an import did: the session, the notes staged for it, and the ones it needed no run for. */
export interface ImportedBundle {
  session: string;
  /** The bundle's name. */
  name: string;
  staged: StagedNote[];
  /** The notes the wiki holds already, as they are, so they were not staged. */
  dropped: { target: string; reason: string }[];
  /** The files of the bundle that are not notes of the wiki. */
  skipped: { path: string; reason: string }[];
  /** The change that code proposed at once, when every note was new and nothing in the wiki was near one. */
  change?: string;
}

/** The changes a session links that stand: proposed or applied. */
async function standingChanges(context: CheckContext): Promise<Proposal[]> {
  const standing: Proposal[] = [];
  for (const target of linksOf(context.properties.changes)) {
    const path = context.wiki.locate(target);
    if (!path) throw new Error(`changes links ${target}, which is not a note`);
    const proposal = await readProposal(context.vault, path);
    if (proposal.properties.status === "proposed" || proposal.properties.status === "applied") standing.push(proposal);
  }
  return standing;
}

/**
 * Met when a standing change of the session covers every staged note: a write at a note of the same name, a
 * modify whose aliases or `why` name it, or the plan's notes that name it as left out, with the reason.
 */
export const imported: Check = async (_promise, context) => {
  const standing = await standingChanges(context);
  const writes = standing.flatMap((p) => p.writes);
  const notes = standing.map((p) => p.notes ?? "").join("\n");
  const uncovered: string[] = [];
  const missing: string[] = [];
  let count = 0;
  for (const target of linksOf(context.properties.staged)) {
    // The index leaves the staged notes out, and may not have seen them yet: the file is what counts.
    const file = target.endsWith(".md") ? target : `${target}.md`;
    const path = context.wiki.locate(target) ?? ((await context.vault.exists(file)) ? file : undefined);
    if (!path) {
      missing.push(target);
      continue;
    }
    count += 1;
    const name = basename(path);
    const covered = writes.some((w) => {
      if (w.op === "remove") return false;
      if (basename(w.path) === name) return true;
      const aliases = Array.isArray(w.properties?.aliases) ? (w.properties!.aliases as unknown[]) : [];
      return aliases.includes(name) || (w.why ?? "").includes(name);
    });
    if (!covered && !notes.includes(name)) uncovered.push(path);
  }
  if (missing.length) return { status: "unmet", detail: `staged links ${missing.join(", ")}, which are not notes` };
  if (!standing.length) return { status: "unmet", detail: "no change of the session is proposed or applied" };
  if (uncovered.length) return { status: "unmet", detail: `no standing change writes or names ${uncovered.map(basename).join(", ")}; create or merge each, or name it in the plan's notes with why it is left out` };
  return { status: "met", detail: count ? `${count} staged note(s) covered by the standing changes` : "staged links nothing" };
};

/** The skill of an import session, `/wiki:import`. */
export const importSkill = `---
name: import
description: "Merge a bundle of topics and sources into the wiki: create the new notes as written, merge each one that collides with a note the wiki has, link the new topics from their neighbors, and propose one change plan. To import from a conversation, call wiki_import, which stages the bundle and starts an import session."
---
# Import

**In a conversation**, with no import session, do not merge the notes yourself. Call \`wiki_import\` with the bundle: a folder of the vault, an absolute path, or a GitHub repository URL. It stages the notes, creates an import session, and starts its run, which runs this skill; when every note is new and nothing in the wiki is near one, it proposes the change at once and no run is needed. Tell the user the session's name, and that they approve its change in Obsidian. Then end.

**In an import session**, the session's \`staged\` property links the staged notes, in the folder of the session's name, and the session's Import section says where each one stands: \`new\` (nothing in the wiki holds its name), \`near\` (a topic is near it; the section names the neighbors), or \`conflict\` (a note holds its path or its name). The session is read-only: every change to the wiki goes through \`wiki_change\` as one plan. The staged notes are in the wiki's own form already, so \`page-forms.md\` is not needed.

1. **Read the Import section**, then each staged note and each note it stands with.
2. **New notes.** A \`create\` at the target path, with the staged note's properties and body as written. Do not rewrite them: they are a wiki's own topics, in its voice already. Fix a link that points at a note the bundle did not bring and this wiki does not have: point it at the nearest topic here, or unlink it.
3. **Near and conflict.** Read the staged note and the notes it stands with. The same subject: a \`modify\` of the wiki's note that merges the staged note's claims with their citations, keeps the clearer description, and adds the staged note's name as an alias when the names differ; the staged note itself is not created. Another subject with a shared name: create the staged note under a name that tells them apart, and link each from the other's Related section. A note that adds nothing to what the wiki has: leave it out, and name it in the plan's \`notes\` with the reason. With more than four to merge, run the agent \`drafter\` with \`yami_agent\`, one per slice of at most eight: give each the staged notes' paths and the paths of the notes they stand with, and say that the items of a subject are the claims of its staged note, cited as that note cites them.
4. **Sources.** A staged source is created as written; its original is in the vault already. A source the wiki has already was dropped at the staging, and the topics that cite it still resolve.
5. **Link the newcomers.** For each new topic, find two or three topics of this wiki that should link it (\`wiki_search\` with its description, \`types: ["topic"]\`), and add a line under their \`## Related\` with a \`modify\`. A topic nobody links is an orphan.
6. **Propose.** One plan for \`wiki_change\`: every write, a \`title\` ("Import <bundle>"), \`notes\` (what came in, what merged into what, each note left out with its reason), and \`session\` (this session document's path). When the tool refuses, fix the writes it names and call it again.
7. **End.** Your work ends when the plan is proposed and covers every staged note. Do not wait for the approval. Never edit the staged notes or the session document.
`;

/** The promise of an import session, which the `imported` check holds. */
export const bundleImported = `---
name: bundle-imported
description: Every staged note of the import is created, merged into a note of the wiki, or named in the plan's notes as left out.
check: imported
---
Every note that the session's \`staged\` property links is covered by a change of this session that is proposed or applied: a write at a note of the same name, a modify of a note that takes the staged note's name as an alias or names it in its \`why\`, or the plan's notes, which name it as left out with the reason.
`;

/** The folder that holds the staged notes of an import session: the folder of the session's name. */
export function stagingFolder(session: string): string {
  return session.replace(/\.md$/, "");
}
