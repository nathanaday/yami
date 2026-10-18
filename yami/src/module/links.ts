import { documentName, linksOf, linkTarget, resolveLink } from "../document/document.js";
import { FORMS, type FormKind } from "../document/schema.js";
import type { Properties, Vault } from "../document/vault.js";
import { formPath, KIND_OF, moduleLayout, type LinkedKind } from "./module.js";

/** The session fields that link documents, in the order a person reads them. */
export const LINKED_KINDS: readonly LinkedKind[] = ["promises", "policies", "skills", "agents", "articles"];

/** One document that a session links. */
export interface LinkedDocument {
  /** The session field that links it. */
  kind: LinkedKind;
  /** The link's target, as the session holds it. */
  target: string;
  /** What the document is called: the name of a form's folder, or an article's file name. */
  name: string;
  /** The document's vault path. Undefined when the link finds no note. */
  path: string | undefined;
}

/** A form's name: `name` for the caller's module, or `<module>:<name>`. */
const NAME = /^(?:([a-z0-9]+(?:-[a-z0-9]+)*):)?([a-z0-9]+(?:-[a-z0-9]+)*)$/;

/** The module and the name of a form's name, `<module>:<name>` or a bare name of `module`. Undefined for text that is no name. */
export function parseName(value: string, module: string | undefined): { module: string; name: string } | undefined {
  const match = NAME.exec(value.trim());
  const owner = match?.[1] ?? module;
  return match && owner ? { module: owner, name: match[2]! } : undefined;
}

/** How a module names a form at a path: its bare name in the module, and `<module>:<name>` in another. */
export function nameOf(path: string, module: string | undefined): string {
  const owner = path.split("/")[1];
  return owner === module ? documentName(path) : `${owner}:${documentName(path)}`;
}

/**
 * The vault path of a form that a flow or a session names: a bare name in `module`, `<module>:<name>` in
 * another module, or a `[[link]]` or a path, which Yami writes. Undefined when no file is there.
 */
export async function resolveForm(vault: Vault, kind: FormKind, value: string, module: string | undefined): Promise<string | undefined> {
  const target = linkTarget(value);
  const named = parseName(target, module);
  const path = named ? formPath(moduleLayout(named.module), kind, named.name) : target.endsWith(FORMS[kind].file) ? target : `${target}.md`;
  return (await vault.exists(path)) ? path : undefined;
}

/**
 * Finds each document that a session's properties link: a form by its name or its link, and an article by
 * its link, by path or by name in the module's articles, its internal folder, and then the whole vault.
 */
export async function linkedDocuments(vault: Vault, module: string, properties: Properties): Promise<LinkedDocument[]> {
  const layout = moduleLayout(module);
  const found: LinkedDocument[] = [];
  for (const kind of LINKED_KINDS) {
    for (const target of linksOf(properties[kind])) {
      const form = KIND_OF[kind];
      const path = form === "article" ? await resolveLink(vault, target, [layout.folders.articles, layout.internal]) : await resolveForm(vault, form, target, module);
      found.push({ kind, target, name: path ? documentName(path) : (parseName(target, module)?.name ?? documentName(`${target}.md`)), path });
    }
  }
  return found;
}
