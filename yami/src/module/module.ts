import { type LedgerView, moduleLedger, vaultLedger } from "../document/bases.js";
import { link, readDocument, writeDocument, type Document } from "../document/document.js";
import { SESSION, timestamp, validate, withDefaults, type Schema } from "../document/schema.js";
import type { AgentTool } from "../agent/types.js";
import type { Check } from "./checks.js";
import type { Properties, Vault } from "../document/vault.js";
import type { Wiki } from "../wiki/wiki.js";

export type LinkedKind = "articles" | "policies" | "promises" | "skills";

/** A document that a module installs into its internal folder. */
export interface ModuleDocument {
  type: "policy" | "promise" | "skill" | "article" | "agent";
  name: string;
  properties?: Properties;
  body: string;
  /** A skill's other files, by name: what it tells the agent, or a worker, to read when needed. */
  files?: Record<string, string>;
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
  /** Tools that the agent gets while the module is enabled. They run in the host. */
  tools?: (context: ToolContext) => AgentTool[];
  /** Checks that the module's promises can name. They come before the core checks of the same name. */
  checks?: Record<string, Check>;
  /**
   * Where the session documents live. Default: the module's own folder, for a person to read.
   * `internal`: under `internal/<module>/sessions`, when the module's folder is for its output instead.
   * `none`: the module has no sessions of its own, and no ledger.
   */
  sessions?: "internal" | "none";
  /** What a session's agent may change. `read-only`: nothing, except through the module's tools. Default: `edit`. */
  access?: "edit" | "read-only";
  /** Tables that the module adds to its ledger, beyond the session tables. */
  ledgerViews?: LedgerView[];
}

/** What the host gives every module: the vault, and the vault's one wiki. */
export interface Host {
  vault: Vault;
  wiki: Wiki;
}

export interface ToolContext extends Host {
  module: Module;
}

export function policy(name: string, body: string, properties: Properties = {}): ModuleDocument {
  return { type: "policy", name, properties, body };
}

export function promise(name: string, properties: { check?: string; path?: string } & Properties, body: string): ModuleDocument {
  return { type: "promise", name, properties, body };
}

/**
 * A Claude Code subagent of the module's skill set, invoked as `<module id>:<name>`. Its `tools` are the
 * only tools it gets, so an agent without an edit tool cannot change a file. Codex has no subagents.
 */
export function agent(name: string, description: string, tools: string[], body: string): ModuleDocument {
  return { type: "agent", name, properties: { name, description, tools: tools.join(", ") }, body };
}

/**
 * A skill in the standard `SKILL.md` form: a `name` and `description`, then the instructions. `files`
 * go into the skill's folder beside `SKILL.md`, for the agent or its workers to read when they need them.
 */
export function skill(name: string, description: string, body: string, files?: Record<string, string>): ModuleDocument {
  return { type: "skill", name, properties: { name, description }, body, ...(files && { files }) };
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
  const sessions = module.sessions === "internal" ? `${internal}/sessions` : module.id;
  return {
    sessions,
    ledger: module.sessions === "internal" ? `${internal}/sessions.base` : `${module.id}/sessions.base`,
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

const FOLDER_OF: Record<Exclude<ModuleDocument["type"], "agent">, LinkedKind> = {
  article: "articles",
  policy: "policies",
  promise: "promises",
  skill: "skills",
};

export function documentPath(lay: Layout, doc: ModuleDocument): string {
  if (doc.type === "agent") return `${lay.internal}/agents/${doc.name}.md`;
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
  const sessions = module.sessions !== "none";
  if (!(await vault.exists(VAULT_LEDGER))) await vault.write(VAULT_LEDGER, vaultLedger(vault));
  if (sessions && !(await vault.exists(lay.ledger))) await vault.write(lay.ledger, moduleLedger(vault, module.id, module.ledgerViews));
  if (!(await vault.exists(lay.moduleDoc))) {
    const ledger = sessions ? `\n\nSessions: [[${lay.ledger}|${module.name} sessions]]` : "";
    await writeDocument(vault, {
      path: lay.moduleDoc,
      properties: { type: "module", module: module.id, name: module.name, description: module.description, created: timestamp() },
      body: `${module.description ?? ""}${ledger}\n`,
    });
  }
  for (const doc of module.documents ?? []) {
    const path = documentPath(lay, doc);
    if (!(await vault.exists(path))) {
      // A skill and an agent are files in their harness's own form, with no Yami properties.
      const properties = doc.type === "skill" || doc.type === "agent" ? { ...doc.properties } : { type: doc.type, module: module.id, ...doc.properties };
      await writeDocument(vault, { path, properties, body: doc.body });
    }
    for (const [name, text] of Object.entries(doc.files ?? {})) {
      const file = `${path.slice(0, path.lastIndexOf("/"))}/${name}`;
      if (!(await vault.exists(file))) await vault.write(file, text);
    }
  }
  return lay;
}

/**
 * The skill sets of the modules, for the agents of a vault: each module's internal folder, whose
 * `skills/` holds its skills, as an absolute path. An agent invokes a skill as `/<module id>:<skill>`.
 */
export function moduleSkills(vault: Vault, modules: Module[]): string[] {
  return modules.filter((module) => module.documents?.some((doc) => doc.type === "skill")).map((module) => `${vault.root.replace(/\/$/, "")}/${layout(module).internal}`);
}

/** The command of a module skill's `SKILL.md`, as a vault path: `internal/wiki/skills/ingest/SKILL.md` is `wiki:ingest`. */
export function skillCommand(path: string): { command: string; root: string } | undefined {
  const match = path.match(/^(.*\/([^/]+))\/skills\/([^/]+)\/SKILL\.md$/);
  return match ? { command: `${match[2]}:${match[3]}`, root: match[1]! } : undefined;
}

/** Creates the session document with the module's defaults and `fields`, and returns its path. */
export async function createSession(vault: Vault, module: Module, name: string, fields: Properties = {}): Promise<string> {
  if (module.sessions === "none") throw new Error(`The ${module.id} module has no sessions.`);
  checkName(name);
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

/** Refuses a name that cannot be one file name: empty, with a space at either end, starting with a dot, or with a character a file or a link cannot take. */
export function checkName(name: string): void {
  if (!name.trim() || name.trim() !== name || name.startsWith(".")) throw new Error(`"${name}" cannot name a file: give a name with no space at either end, and no dot at the start.`);
  const bad = name.match(/[\\/:*?"<>|#^[\]\p{Cc}]/u);
  if (bad) throw new Error(`"${name}" cannot name a file: it holds "${bad[0]}". Leave out \\ / : * ? " < > | # ^ [ ].`);
}

/**
 * A name for a new session of the module, from `base`: each character a file name cannot take becomes
 * a space, and a name in use gets " (2)", " (3)", and so on. Use it for a name that code or a file gives.
 */
export async function freeSessionName(vault: Vault, module: Module, base: string): Promise<string> {
  const clean = base.replace(/[\\/:*?"<>|#^[\]\p{Cc}]/gu, " ").replace(/\s+/g, " ").trim().replace(/^\.+\s*/, "") || "Session";
  const folder = layout(module).sessions;
  let name = clean;
  for (let n = 2; await vault.exists(`${folder}/${name}.md`); n++) name = `${clean} (${n})`;
  return name;
}

/** Reads a session document and checks that it belongs to the module. */
export async function readSession(vault: Vault, module: Module, path: string): Promise<Document> {
  const doc = await readDocument(vault, path);
  if (doc.properties.type !== "session" || doc.properties.module !== module.id) {
    throw new Error(`${path} is not a session of the ${module.id} module.`);
  }
  return doc;
}
