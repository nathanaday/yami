import { documentName, linksOf, resolveLink } from "../document/document.js";
import type { Properties, Vault } from "../document/vault.js";
import { skillPath, type Layout, type LinkedKind } from "./module.js";

/** The session fields that link documents, in the order a person reads them. */
export const LINKED_KINDS: readonly LinkedKind[] = ["promises", "policies", "skills", "articles"];

/** One document that a session links. */
export interface LinkedDocument {
  /** The session field that links it. */
  kind: LinkedKind;
  /** The link's target, as the session holds it. */
  target: string;
  /** What the document is called: its file name, or the folder name of a skill. */
  name: string;
  /** The document's vault path. Undefined when the link finds no note. */
  path: string | undefined;
}

/**
 * Finds each document that a session's properties link: a skill by its name in the module's skills, any
 * link by its path, or by its name in the module's folder for its kind, the module's internal folder, and
 * then the whole vault.
 */
export async function linkedDocuments(vault: Vault, layout: Layout, properties: Properties): Promise<LinkedDocument[]> {
  const found: LinkedDocument[] = [];
  for (const kind of LINKED_KINDS) {
    for (const target of linksOf(properties[kind])) {
      const path =
        kind === "skills" && (await vault.exists(skillPath(layout, target)))
          ? skillPath(layout, target)
          : await resolveLink(vault, target, [layout.folders[kind], layout.internal]);
      found.push({ kind, target, name: documentName(path ?? `${target}.md`), path });
    }
  }
  return found;
}
