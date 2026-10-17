import { basename, link, parseDocument, PropertiesError, type Document } from "../document/document.js";
import { MODULE, SESSION, TEMPLATE, validate, type FieldType, type Schema } from "../document/schema.js";
import type { Properties, Vault } from "../document/vault.js";
import { YAMI_ID } from "./base-skill.js";
import { hexColor } from "./colors.js";
import { linkedDocuments } from "./links.js";
import { ID, idFromName, INTERNAL, MODULE_ICON, moduleLayout, YamiModule, type DocumentKind, type DocumentRef, type LinkedKind, type TemplateOptions } from "./module.js";

/**
 * Something wrong with a vault module's documents, which keeps a module or a template out until a person
 * fixes it. Or, with the module `yami`, a base skill that holds a person's edits and not this version's text.
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
  /** The session fields of every template, by the type of their defaults. */
  schema: Schema;
  /** Whether `internal/<id>/skills/` holds a skill. */
  skills: boolean;
  templates: TemplateOptions[];
}

/**
 * A module defined in the vault with no code: the module document `internal/<id>/<id>.md` and a template
 * document for each kind of session in `internal/<id>/templates/`. It has no tools, checks, or actions of
 * its own: its sessions use the tools that Yami serves and the core checks, and the review judges the rest.
 * Yami makes one for each valid folder; `yami.discover()` reads them again.
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
    for (const template of definition.templates) this.template(template);
  }

  override get hasSkills(): boolean {
    return this.#skills;
  }
}

const KIND_OF: Record<LinkedKind, Exclude<DocumentKind, "agent">> = { articles: "article", policies: "policy", promises: "promise", skills: "skill" };

/**
 * Reads the vault modules: each folder `internal/<id>/` with a module document and at least one document
 * in `templates/`, whose id no module in `taken` has. A module or a template with a problem stays out, and
 * the problem says why; a bad color only falls back to the default.
 */
export async function readVaultModules(vault: Vault, taken: ReadonlySet<string>): Promise<{ definitions: VaultModuleDefinition[]; problems: ModuleProblem[] }> {
  const files = await vault.list(INTERNAL);
  const folders = new Map<string, { templates: string[]; skills: boolean }>();
  const folder = (id: string) => folders.get(id) ?? folders.set(id, { templates: [], skills: false }).get(id)!;
  for (const path of files) {
    const parts = path.split("/");
    if (definesModule(path) && parts[2] === "templates") folder(parts[1]!).templates.push(path);
    if (parts.length === 5 && parts[2] === "skills" && parts[4] === "SKILL.md") folder(parts[1]!).skills = true;
  }
  const definitions: VaultModuleDefinition[] = [];
  const problems: ModuleProblem[] = [];
  for (const [id, { templates, skills }] of [...folders].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (!templates.length) continue;
    const root = `${INTERNAL}/${id}`;
    const problem = (path: string, message: string) => problems.push({ module: id, path, ...(path !== root && { document: path }), message });
    if (taken.has(id)) {
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
    const layout = moduleLayout(id);
    const document = layout.moduleDoc;
    if (!files.includes(document)) {
      problem(root, `The folder has templates but no module document. Create ${document} with the property type: module.`);
      continue;
    }
    const doc = await read(vault, document, problem);
    if (!doc) continue;
    if (doc.properties.type !== "module") {
      problem(document, `Set the property type: module.`);
      continue;
    }
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

    const schema: Schema = {};
    const ids = new Map<string, string>();
    const options: TemplateOptions[] = [];
    for (const path of templates.sort()) {
      const before = problems.length;
      const template = await readTemplate(vault, path, layout, problem);
      if (!template) continue;
      const other = ids.get(template.id);
      if (other) problem(path, `The template id ${template.id} is the id of ${other} too, as both file names give it. Rename one of the files.`);
      for (const [name, value] of Object.entries(template.fields ?? {})) {
        const type = fieldType(value);
        if (schema[name] && schema[name]!.type !== type) problem(path, `The field ${name} is ${describe(type)} here and ${describe(schema[name]!.type)} in another template. Give it one type.`);
      }
      if (problems.length > before) continue;
      ids.set(template.id, path);
      for (const [name, value] of Object.entries(template.fields ?? {})) schema[name] ??= { type: fieldType(value), ...(value !== null && { default: value }) };
      options.push(template);
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
      skills,
      templates: options,
    });
  }
  return { definitions, problems };
}

/** Whether a path is a module document, `internal/<id>/<id>.md`, or a template document, `internal/<id>/templates/<name>.md`. */
export function definesModule(path: string): boolean {
  const parts = path.split("/");
  return parts[0] === INTERNAL && path.endsWith(".md") && ((parts.length === 3 && parts[2] === `${parts[1]}.md`) || (parts.length === 4 && parts[2] === "templates"));
}

/** Reads a document. Properties that do not parse are a problem, and give nothing. */
async function read(vault: Vault, path: string, problem: (path: string, message: string) => void): Promise<Document | undefined> {
  try {
    return parseDocument(vault, path, await vault.read(path));
  } catch (error) {
    if (!(error instanceof PropertiesError)) throw error;
    problem(path, `The properties do not parse: ${error.reason.replace(/[\s:.]+$/, "")}. Fix them in the document's source view.`);
    return undefined;
  }
}

/** Reads a template document into the options of a template. Each problem it finds is reported, and gives nothing. */
async function readTemplate(vault: Vault, path: string, layout: ReturnType<typeof moduleLayout>, problem: (path: string, message: string) => void): Promise<TemplateOptions | undefined> {
  const doc = await read(vault, path, problem);
  if (!doc) return undefined;
  const props = doc.properties;
  if (props.type !== "template") {
    problem(path, `Set the property type: template, or move the document out of templates/.`);
    return undefined;
  }
  let ok = true;
  const fail = (message: string) => {
    problem(path, message);
    ok = false;
  };
  for (const error of validate(props, TEMPLATE)) fail(`The property ${error}.`);
  const id = idFromName(basename(path));
  if (!id) fail(`The file name gives no template id. Name the file with letters or digits.`);
  const turns = props.maxIterations;
  if (typeof turns === "number" && (!Number.isInteger(turns) || turns < 1)) fail(`maxIterations must be a whole number of 1 or more, not ${turns}.`);
  const fields = (props.fields ?? {}) as Properties;
  const core = Object.keys(fields).filter((field) => field in SESSION);
  if (core.length) fail(core.length === 1 ? `The field ${core[0]} is a core session field, which Yami sets. Rename it.` : `The fields ${core.join(", ")} are core session fields, which Yami sets. Rename them.`);
  if (!ok) return undefined;

  const links: Record<LinkedKind, DocumentRef[]> = { articles: [], policies: [], promises: [], skills: [] };
  for (const found of await linkedDocuments(vault, layout, props)) {
    const kind = KIND_OF[found.kind];
    if (!found.path) fail(`The template links the ${kind} "${found.target}", which is not in the vault. Create it, or fix the link in ${found.kind}.`);
    else links[found.kind].push({ kind, name: found.name, path: found.path, link: link(found.path) });
  }
  if (!ok) return undefined;
  const optional = <T>(name: string) => (props[name] === undefined || props[name] === null ? undefined : (props[name] as T));
  return {
    id,
    name: optional<string>("name")?.trim() || basename(path),
    description: optional<string>("description"),
    skills: links.skills as DocumentRef<"skill">[],
    policies: links.policies as DocumentRef<"policy">[],
    promises: links.promises as DocumentRef<"promise">[],
    articles: links.articles as DocumentRef<"article">[],
    maxIterations: optional<number>("maxIterations"),
    access: optional<"edit" | "read-only">("access"),
    instructions: optional<string>("instructions"),
    fields,
    body: doc.body,
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

