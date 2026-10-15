import { moduleLedger, vaultLedger } from "../document/bases.js";
import { link, readDocument, writeDocument, type Document } from "../document/document.js";
import { SESSION, timestamp, validate, withDefaults, type Schema } from "../document/schema.js";
import type { Properties, Vault } from "../document/vault.js";

export type LinkedKind = "articles" | "policies" | "promises" | "skills";

/** A document that a module installs into its internal folder. */
export interface ModuleDocument {
  type: "policy" | "promise" | "skill" | "article";
  name: string;
  properties?: Properties;
  body: string;
}

export interface Module {
  /** The folder name of the module. Letters, digits, and dashes. */
  id: string;
  name: string;
  description?: string;
  /** The module's own session fields, added to the core session schema. */
  schema?: Schema;
  documents?: ModuleDocument[];
  /** Names of the module's documents that every new session links to. */
  defaults?: Partial<Record<LinkedKind, string[]>>;
  /** Text added to the harness system prompt of each session. */
  instructions?: string;
}

export function policy(name: string, body: string, properties: Properties = {}): ModuleDocument {
  return { type: "policy", name, properties, body };
}

export function promise(name: string, properties: { check?: string; path?: string } & Properties, body: string): ModuleDocument {
  return { type: "promise", name, properties, body };
}

/** A skill in the standard `SKILL.md` form: a `name` and `description`, then the instructions. */
export function skill(name: string, description: string, body: string): ModuleDocument {
  return { type: "skill", name, properties: { name, description }, body };
}

/** The vault paths of a module. */
export interface Layout {
  /** The folder of the session documents. */
  sessions: string;
  ledger: string;
  internal: string;
  moduleDoc: string;
  folders: Record<LinkedKind, string>;
  logs: string;
}

export const VAULT_LEDGER = "Yami.base";
export const INTERNAL = "internal";

export function layout(module: Module): Layout {
  const internal = `${INTERNAL}/${module.id}`;
  return {
    sessions: module.id,
    ledger: `${module.id}/sessions.base`,
    internal,
    moduleDoc: `${internal}/${module.id}.md`,
    folders: {
      articles: `${internal}/articles`,
      policies: `${internal}/policies`,
      promises: `${internal}/promises`,
      skills: `${internal}/skills`,
    },
    logs: `${internal}/logs`,
  };
}

const FOLDER_OF: Record<ModuleDocument["type"], LinkedKind> = {
  article: "articles",
  policy: "policies",
  promise: "promises",
  skill: "skills",
};

export function documentPath(lay: Layout, doc: ModuleDocument): string {
  const folder = lay.folders[FOLDER_OF[doc.type]];
  return doc.type === "skill" ? `${folder}/${doc.name}/SKILL.md` : `${folder}/${doc.name}.md`;
}

/** The path of a session's skill, which is a folder with a `SKILL.md`. */
export function skillPath(lay: Layout, name: string): string {
  return `${lay.folders.skills}/${name}/SKILL.md`;
}

export function sessionSchema(module: Module): Schema {
  return { ...SESSION, ...module.schema };
}

/**
 * Writes the ledgers, the module document, and the module's documents. It
 * writes only files that do not exist, so edits in the vault stay, and a host
 * can call it on every start.
 */
export async function enableModule(vault: Vault, module: Module): Promise<Layout> {
  const lay = layout(module);
  if (!(await vault.exists(VAULT_LEDGER))) await vault.write(VAULT_LEDGER, vaultLedger(vault));
  if (!(await vault.exists(lay.ledger))) await vault.write(lay.ledger, moduleLedger(vault, module.id, lay.sessions));
  if (!(await vault.exists(lay.moduleDoc))) {
    await writeDocument(vault, {
      path: lay.moduleDoc,
      properties: { type: "module", module: module.id, name: module.name, description: module.description, created: timestamp() },
      body: `${module.description ?? ""}\n\nSessions: [[${module.id}/sessions.base|${module.name} sessions]]\n`,
    });
  }
  for (const doc of module.documents ?? []) {
    const path = documentPath(lay, doc);
    if (await vault.exists(path)) continue;
    const properties = doc.type === "skill" ? { ...doc.properties } : { type: doc.type, module: module.id, ...doc.properties };
    await writeDocument(vault, { path, properties, body: doc.body });
  }
  return lay;
}

/** Creates the session document with the module's defaults and `fields`, and returns its path. */
export async function createSession(vault: Vault, module: Module, name: string, fields: Properties = {}): Promise<string> {
  const lay = layout(module);
  const path = `${lay.sessions}/${name}.md`;
  if (await vault.exists(path)) throw new Error(`A session named ${name} exists.`);
  const defaults = module.defaults ?? {};
  const properties = withDefaults(
    {
      type: "session",
      module: module.id,
      created: timestamp(),
      articles: (defaults.articles ?? []).map((name) => link(`${lay.folders.articles}/${name}.md`)),
      policies: (defaults.policies ?? []).map((name) => link(`${lay.folders.policies}/${name}.md`)),
      promises: (defaults.promises ?? []).map((name) => link(`${lay.folders.promises}/${name}.md`)),
      skills: (defaults.skills ?? []).map((name) => link(skillPath(lay, name))),
      ...fields,
    },
    sessionSchema(module),
  );
  const errors = validate(properties, sessionSchema(module));
  if (errors.length > 0) throw new Error(`The session is not valid: ${errors.join("; ")}.`);
  const deliverables = (properties.promises as string[]).map((target) => `- [ ] ${target}`).join("\n") || "- none";
  const doc: Document = {
    path,
    properties,
    body: `# ${name}\n\n## Deliverables\n${deliverables}\n\n## Progress\n`,
  };
  await writeDocument(vault, doc);
  return path;
}

/** Reads a session document and checks that it belongs to the module. */
export async function readSession(vault: Vault, module: Module, path: string): Promise<Document> {
  const doc = await readDocument(vault, path);
  if (doc.properties.type !== "session" || doc.properties.module !== module.id) {
    throw new Error(`${path} is not a session of the ${module.id} module.`);
  }
  return doc;
}
