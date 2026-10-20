import { basename, documentName, link, linksOf, parseDocument, PropertiesError, resolveLink, type Document } from "../document/document.js";
import { FORMS, MODULE, SESSION, validate, type FieldType, type FormKind, type Schema } from "../document/schema.js";
import type { Properties, Vault } from "../document/vault.js";
import { YAMI_ID } from "./base-skill.js";
import { hexColor } from "./colors.js";
import { parseName, resolveForm } from "./links.js";
import { formPath, ID, idFromName, INTERNAL, isVaultFlow, KIND_OF, MODULE_ICON, moduleLayout, YamiModule, type DocumentRef, type FlowOptions, type Layout, type LinkedKind } from "./module.js";

/**
 * Something wrong with a vault module's documents, which keeps a module or a flow out until a person fixes
 * it. Or, with the module `yami`, a base skill that holds a person's edits and not this version's text.
 */
export interface ModuleProblem {
  /** The module's id: the name of its folder under `internal/`. `yami` for the base skill. */
  module: string;
  /** The vault path of the document with the problem, or of the module's folder. */
  path: string;
  /** The vault path of the document with the problem, which a view can open. None when no document holds the problem: the folder's name, a missing module document, or a ledger that Yami could not write. */
  document?: string;
  /** What is wrong, and how to fix it. */
  message: string;
}

/** What the vault says of one vault module. It is plain data, so two reads compare as text. */
export interface VaultModuleDefinition {
  id: string;
  /** The module document's vault path. */
  document: string;
  name: string;
  description?: string;
  icon: string;
  color?: string;
  instructions?: string;
  /** The session fields of every flow, by the type of their defaults. */
  schema: Schema;
  /** Whether `internal/<id>/skills/` holds a skill. */
  skills: boolean;
  flows: FlowOptions[];
}

/** What the vault adds to a code module that takes `vaultFlows`. It is plain data, so two reads compare as text. */
export interface VaultFlows {
  id: string;
  /** The valid flows of `internal/<id>/flows/`, by name. */
  flows: FlowOptions[];
  /** Whether `internal/<id>/skills/` holds a skill. */
  skills: boolean;
}

/**
 * A module defined in the vault with no code: the module document `internal/<id>/<id>.md` and a
 * `flows/<name>/FLOW.md` for each kind of session, with its forms in the folders a code module installs.
 * It has no tools, checks, or actions of its own: its sessions use the tools that Yami serves and the core
 * checks, and the review judges the rest. Yami makes one for each valid folder; `yami.discover()` reads them again.
 */
export class VaultModule extends YamiModule {
  readonly id: string;
  readonly name: string;
  readonly description: string | undefined;
  readonly instructions: string | undefined;
  readonly color: string | undefined;
  declare readonly icon: string;
  readonly schema: Schema;
  /** The module document, as a vault path. */
  readonly document: string;
  readonly #skills: boolean;

  constructor(definition: VaultModuleDefinition) {
    super();
    this.id = definition.id;
    this.name = definition.name;
    this.description = definition.description;
    this.instructions = definition.instructions;
    this.color = definition.color;
    this.icon = definition.icon;
    this.schema = definition.schema;
    this.document = definition.document;
    this.#skills = definition.skills;
    for (const flow of definition.flows) this.flow(flow);
  }

  override get hasSkills(): boolean {
    return this.#skills;
  }
}

/** The kind of form that each folder of a module holds. */
const FORM_OF = new Map<string, FormKind>(Object.entries(FORMS).map(([kind, form]) => [form.folder, kind as FormKind]));

type Problem = (path: string, message: string) => void;

interface Folder {
  /** The form files, `<folder>/<name>/<FILE>.md`. */
  forms: { kind: FormKind; path: string }[];
  /** Markdown files directly in a form's folder, where a folder belongs. */
  flat: { kind: FormKind; path: string }[];
}

/**
 * Reads the vault modules: each folder `internal/<id>/` with a module document and at least one flow, whose
 * id no module of `code` has. For a code module that takes `vaultFlows`, it reads the flows and forms of its
 * folder instead. A module, a flow, or a form with a problem stays out, and the problem says why and how to
 * fix it; a bad color only falls back to the default.
 */
export async function readVaultModules(
  vault: Vault,
  code: readonly YamiModule[],
): Promise<{ definitions: VaultModuleDefinition[]; extended: VaultFlows[]; problems: ModuleProblem[] }> {
  const files = await vault.list(INTERNAL);
  const folders = new Map<string, Folder>();
  for (const path of [...files].sort()) {
    const parts = path.split("/");
    const kind = FORM_OF.get(parts[2] ?? "");
    if (!kind) continue;
    const folder = folders.get(parts[1]!) ?? folders.set(parts[1]!, { forms: [], flat: [] }).get(parts[1]!)!;
    if (parts.length === 5 && parts[4] === FORMS[kind].file) folder.forms.push({ kind, path });
    else if (parts.length === 4 && path.endsWith(".md")) folder.flat.push({ kind, path });
  }
  const problems: ModuleProblem[] = [];
  const modules: { id: string; folder: Folder; doc: Document; problem: Problem }[] = [];
  const open: { module: YamiModule; folder: Folder; problem: Problem }[] = [];
  for (const [id, folder] of [...folders].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const root = `${INTERNAL}/${id}`;
    const problem: Problem = (path, message) => problems.push({ module: id, path, ...(path !== root && { document: path }), message });
    const owner = code.find((module) => module.id === id);
    if (owner?.vaultFlows) {
      open.push({ module: owner, folder, problem });
      continue;
    }
    if (![...folder.forms, ...folder.flat].some((form) => form.kind === "flow")) continue;
    if (owner) {
      problem(root, `The plugin's code has a module with the id ${id}, and it wins. Rename the folder ${root}/ to give the vault module an id of its own.`);
      continue;
    }
    if (id === YAMI_ID) {
      problem(root, `The id ${YAMI_ID} is Yami's own. Rename the folder ${root}/.`);
      continue;
    }
    if (!ID.test(id)) {
      const better = idFromName(id);
      problem(root, `"${id}" cannot be a module id. Rename the folder${better ? ` to ${better}` : ""}: lower-case letters, digits, and dashes.`);
      continue;
    }
    const document = moduleLayout(id).moduleDoc;
    if (!files.includes(document)) {
      problem(root, `The folder has flows but no module document. Create ${document} with the property type: module.`);
      continue;
    }
    const doc = await read(vault, document, problem);
    if (!doc) continue;
    if (doc.properties.type !== "module") {
      problem(document, `Set the property type: module.`);
      continue;
    }
    modules.push({ id, folder, doc, problem });
  }

  // Every form of every vault module first, so that a flow of one module can name a form of another.
  const broken = new Set<string>();
  const docs = new Map<string, Document>();
  for (const { folder, problem } of [...modules, ...open]) {
    for (const { kind, path } of folder.flat) {
      const name = idFromName(basename(path)) || "name";
      problem(path, `A ${kind} is a folder with a ${FORMS[kind].file} in it. Move this file to ${path.slice(0, path.lastIndexOf("/"))}/${name}/${FORMS[kind].file}, and set name: ${name}.`);
    }
    for (const { kind, path } of folder.forms) {
      const doc = await checkForm(vault, kind, path, problem);
      if (doc) docs.set(path, doc);
      else broken.add(path);
    }
  }

  const definitions: VaultModuleDefinition[] = [];
  for (const { id, folder, doc, problem } of modules) {
    const document = doc.path;
    const props = doc.properties;
    const text = (name: string): string | undefined => {
      // The module document of a vault module needs no property but its type.
      const [error] = validate({ [name]: props[name] }, { [name]: { ...MODULE[name]!, required: false } });
      if (error) problem(document, `The property ${error}. Yami leaves it out until you fix it.`);
      const value = props[name];
      return !error && typeof value === "string" && value.trim() ? value : undefined;
    };
    const name = text("name");
    const description = text("description");
    const icon = text("icon");
    let color = text("color");
    if (color && !hexColor(color)) {
      problem(document, `The color "${color}" is not a hex code such as #3e63dd. The module takes a basic color until you fix it.`);
      color = undefined;
    }
    const instructions = text("instructions");

    const layout = moduleLayout(id);
    const schema: Schema = {};
    const flows: FlowOptions[] = [];
    for (const { kind, path } of folder.forms) {
      const flowDoc = docs.get(path);
      if (kind !== "flow" || !flowDoc) continue;
      const before = problems.length;
      const flow = await readFlow(vault, flowDoc, id, layout, broken, problem);
      if (!flow) continue;
      for (const [field, value] of Object.entries(flow.fields ?? {})) {
        const type = fieldType(value);
        if (schema[field] && schema[field]!.type !== type) problem(path, `The field ${field} is ${describe(type)} here and ${describe(schema[field]!.type)} in another flow. Give it one type.`);
      }
      if (problems.length > before) continue;
      for (const [field, value] of Object.entries(flow.fields ?? {})) schema[field] ??= { type: fieldType(value), ...(value !== null && { default: value }) };
      flows.push(flow);
    }
    definitions.push({
      id,
      document,
      name: name ?? id,
      description,
      icon: icon ?? MODULE_ICON,
      color,
      instructions,
      schema,
      skills: folder.forms.some((form) => form.kind === "skill"),
      flows,
    });
  }
  const extended: VaultFlows[] = [];
  for (const { module, folder, problem } of open) {
    const layout = moduleLayout(module.id);
    const own = module.flows.filter((flow) => !isVaultFlow(flow)).map((flow) => flow.name);
    const flows: FlowOptions[] = [];
    for (const { kind, path } of folder.forms) {
      const flowDoc = docs.get(path);
      if (kind !== "flow" || !flowDoc) continue;
      const name = flowDoc.properties.name as string;
      if (own.includes(name)) {
        problem(path, `The ${module.name} module's code has a flow named ${name}, and it wins. Rename this flow's folder and its name.`);
        continue;
      }
      const before = problems.length;
      const flow = await readFlow(vault, flowDoc, module.id, layout, broken, problem);
      if (!flow) continue;
      for (const [field, value] of Object.entries(flow.fields ?? {})) {
        const declared = module.schema?.[field];
        const [error] = declared ? validate({ [field]: value }, { [field]: { ...declared, required: false } }) : [];
        if (error) problem(path, `The field ${error}, as the ${module.name} module's schema declares it. Give it such a default, or rename the field.`);
      }
      if (problems.length === before) flows.push(flow);
    }
    extended.push({ id: module.id, flows, skills: folder.forms.some((form) => form.kind === "skill") });
  }
  // By module and by document, so a person reads the problems of one document together.
  const order = (a: ModuleProblem, b: ModuleProblem) => (a.module === b.module ? (a.path === b.path ? 0 : a.path < b.path ? -1 : 1) : a.module < b.module ? -1 : 1);
  return { definitions, extended, problems: problems.sort(order) };
}

/**
 * Whether a change at a path can change what the vault modules are: a module document,
 * `internal/<id>/<id>.md`, or a file in the folder of a form, such as `internal/<id>/policies/<name>/POLICY.md`
 * or a flat `internal/<id>/policies/<name>.md`.
 */
export function definesModule(path: string): boolean {
  const parts = path.split("/");
  return parts[0] === INTERNAL && path.endsWith(".md") && ((parts.length === 3 && parts[2] === `${parts[1]}.md`) || (parts.length >= 4 && FORM_OF.has(parts[2]!)));
}

/** Reads a document. Properties that do not parse are a problem, and give nothing. */
async function read(vault: Vault, path: string, problem: Problem): Promise<Document | undefined> {
  try {
    return parseDocument(vault, path, await vault.read(path));
  } catch (error) {
    if (!(error instanceof PropertiesError)) throw error;
    problem(path, `The properties do not parse: ${error.reason.replace(/[\s:.]+$/, "")}. Fix them in the document's source view.`);
    return undefined;
  }
}

/** Reads a form and checks its header: its properties, and a `name` that is its folder's name. A flow also has no body. Each problem is reported, and gives nothing. */
async function checkForm(vault: Vault, kind: FormKind, path: string, problem: Problem): Promise<Document | undefined> {
  const doc = await read(vault, path, problem);
  if (!doc) return undefined;
  const folder = basename(path.slice(0, path.lastIndexOf("/")));
  let ok = true;
  const fail = (message: string) => {
    problem(path, message);
    ok = false;
  };
  if (!ID.test(folder)) {
    const better = idFromName(folder);
    fail(`"${folder}" cannot name a ${kind}. Rename the folder${better ? ` to ${better}` : ""}, and set the same name: lower-case letters, digits, and dashes.`);
  }
  for (const error of validate(doc.properties, FORMS[kind].schema)) fail(`The property ${error}.${error === "name is missing" ? ` Set name: ${folder}.` : ""}`);
  const name = doc.properties.name;
  if (typeof name === "string" && name !== folder) fail(`The name is "${name}", and the folder is ${folder}. A name is its folder's name: set name: ${folder}, or rename the folder.`);
  if (kind === "flow" && doc.body.trim()) fail(`A flow has no body. Move the text into the property instructions, and leave the body empty.`);
  return ok ? doc : undefined;
}

/** Reads a valid `FLOW.md` into the options of a flow. Each problem it finds is reported, and gives nothing. */
async function readFlow(vault: Vault, doc: Document, module: string, layout: Layout, broken: ReadonlySet<string>, problem: Problem): Promise<FlowOptions | undefined> {
  const props = doc.properties;
  let ok = true;
  const fail = (message: string) => {
    problem(doc.path, message);
    ok = false;
  };
  const turns = props.maxIterations;
  if (typeof turns === "number" && (!Number.isInteger(turns) || turns < 1)) fail(`maxIterations must be a whole number of 1 or more, not ${turns}.`);
  const fields = (props.fields ?? {}) as Properties;
  const core = Object.keys(fields).filter((field) => field in SESSION);
  if (core.length) fail(core.length === 1 ? `The field ${core[0]} is a core session field, which Yami sets. Rename it.` : `The fields ${core.join(", ")} are core session fields, which Yami sets. Rename them.`);

  const links: Record<LinkedKind, DocumentRef[]> = { agents: [], articles: [], policies: [], promises: [], skills: [] };
  for (const field of ["skills", "agents", "policies", "promises", "articles"] as const) {
    const kind = KIND_OF[field];
    for (const value of linksOf(props[field])) {
      if (kind === "article") {
        const path = await resolveLink(vault, value, [layout.folders.articles, layout.internal]);
        if (path) links.articles.push({ kind, name: documentName(path), path, link: link(path) });
        else fail(`The flow links the article "${value}", which is not in the vault. Create it, or fix the link in articles.`);
        continue;
      }
      const path = await resolveForm(vault, kind, value, module);
      const named = parseName(value, module);
      if (!path) {
        fail(
          named
            ? `The flow names the ${kind} "${value}", which is not in the vault. Create ${formPath(moduleLayout(named.module), kind, named.name)}, or fix the name in ${field}.`
            : `The flow names the ${kind} "${value}", which is no name. Name a ${kind} by its folder's name, or as <module>:<name>, in ${field}.`,
        );
      } else if (broken.has(path)) fail(`The flow names the ${kind} "${value}", whose document has a problem. Fix ${path} first.`);
      else links[field].push({ kind, name: documentName(path), path, link: link(path) });
    }
  }
  if (!ok) return undefined;
  const optional = <T>(name: string) => (props[name] === undefined || props[name] === null ? undefined : (props[name] as T));
  return {
    name: props.name as string,
    description: props.description as string,
    skills: links.skills as DocumentRef<"skill">[],
    agents: links.agents as DocumentRef<"agent">[],
    policies: links.policies as DocumentRef<"policy">[],
    promises: links.promises as DocumentRef<"promise">[],
    articles: links.articles as DocumentRef<"article">[],
    fields,
    maxIterations: optional<number>("maxIterations"),
    access: optional<"edit" | "read-only">("access"),
    instructions: optional<string>("instructions"),
    command: optional<boolean>("command"),
  };
}

/** The field type of a default value. */
function fieldType(value: unknown): FieldType {
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (Array.isArray(value)) return "list";
  if (value !== null && typeof value === "object") return "map";
  return "text";
}

function describe(type: FieldType): string {
  return type === "list" ? "a list" : type === "map" ? "names with values" : type === "number" ? "a number" : type === "boolean" ? "true or false" : "text";
}
