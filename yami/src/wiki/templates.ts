import { parseDocument, PropertiesError } from "../document/document.js";
import type { Folders } from "../document/folders.js";
import { DOCUMENT_TYPES, PAGE, parseSchema, SOURCE, TEMPLATE, TEMPLATE_FORM, validate, withDefaults, type Schema } from "../document/schema.js";
import type { Vault } from "../document/vault.js";
import { BUILT_IN_TEMPLATES } from "./template-texts.js";
import type { Note, Wiki } from "./wiki.js";
import { normalizeTag } from "./wiki.js";

/** A kind of page of the wiki: its own properties, the sections its pages hold, and how to write them. */
export interface Template {
  /** The `type` of its pages. */
  name: string;
  description: string;
  /** The vault path of its `TEMPLATE.md`, where the vault has one. */
  path: string;
  /** Its own properties, beside the properties of every page (`PAGE`), or of every source (`SOURCE`). */
  properties: Schema;
  /** The sections a page of it holds, in this order. */
  sections: string[];
  /** Whether a page of it cites sources for its claims. */
  cites: boolean;
  /** The names of the template checks that lint runs on its pages. */
  checks: string[];
  /** What the template says: when to use it, and how to write each section. */
  body: string;
  /** Whether the template is one of the library's: `BUILT_IN_TEMPLATES`. */
  builtIn: boolean;
}

export interface TemplateProblem {
  path: string;
  message: string;
}

/** The template of a page with no type. */
export const DEFAULT_TEMPLATE = "topic";

/** The names that no template can take: the types of Yami's own documents, but the source. */
export const RESERVED_TEMPLATE_NAMES: readonly string[] = DOCUMENT_TYPES.filter((type) => type !== "source");

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The vault path of a template: `<internal>/wiki/templates/<name>/TEMPLATE.md`. */
export function templatePath(folders: Folders, name: string): string {
  return `${folders.templates}/${name}/${TEMPLATE_FORM.file}`;
}

/** The schema of a page of a template: the properties of every page, or of a source, and the template's own. */
export function templateSchema(template: Pick<Template, "name" | "properties">): Schema {
  return { ...(template.name === "source" ? SOURCE : PAGE), ...template.properties };
}

/**
 * Reads a template from its text. The problems say what is wrong and how to fix it; a template with a problem
 * is undefined.
 */
export function parseTemplate(vault: Vault, path: string, text: string, name: string): { template?: Template; problems: string[] } {
  let doc;
  try {
    doc = parseDocument(vault, path, text);
  } catch (error) {
    if (!(error instanceof PropertiesError)) throw error;
    return { problems: [`The properties do not parse: ${error.reason.replace(/[\s:.]+$/, "")}. Fix them in the document's source view.`] };
  }
  const problems: string[] = [];
  if (!NAME.test(name)) problems.push(`"${name}" cannot name a template. Rename the folder: lower-case letters, digits, and dashes.`);
  if (RESERVED_TEMPLATE_NAMES.includes(name)) problems.push(`"${name}" is the type of Yami's own documents, so no template can take it. Rename the folder.`);
  for (const error of validate(doc.properties, TEMPLATE)) problems.push(`The property ${error}.${error === "name is missing" ? ` Set name: ${name}.` : ""}`);
  const props = withDefaults(doc.properties, TEMPLATE);
  if (typeof props.name === "string" && props.name !== name) problems.push(`The name is "${props.name}", and the folder is ${name}. A template's name is its folder's name: set name: ${name}, or rename the folder.`);
  const { schema, problems: fields } = parseSchema(props.properties);
  problems.push(...fields.map((p) => `${p[0]!.toUpperCase()}${p.slice(1)}.`));
  const shared = Object.keys(name === "source" ? SOURCE : PAGE).filter((key) => key in schema);
  if (shared.length) problems.push(`${shared.join(", ")} ${shared.length === 1 ? "is a property" : "are properties"} of every ${name === "source" ? "source" : "page"}, so the template cannot declare ${shared.length === 1 ? "it" : "them"}. Remove ${shared.length === 1 ? "it" : "them"} from properties.`);
  const sections = Array.isArray(props.sections) ? props.sections : [];
  if (sections.some((s) => typeof s !== "string" || !s.trim())) problems.push("Each section is a heading's text, such as Summary.");
  const checks = Array.isArray(props.checks) ? props.checks : [];
  for (const check of checks) if (typeof check !== "string" || !(check in templateChecks)) problems.push(`The check ${String(check)} is not a template check. The checks are ${Object.keys(templateChecks).join(", ")}.`);
  if (problems.length) return { problems };
  return {
    problems,
    template: {
      name,
      description: props.description as string,
      path,
      properties: schema,
      sections: (sections as string[]).map((s) => s.trim()),
      cites: props.cites as boolean,
      checks: checks as string[],
      body: doc.body,
      builtIn: name in BUILT_IN_TEMPLATES,
    },
  };
}

/**
 * The templates of the vault, by name: each `<templates>/<name>/TEMPLATE.md`, and the library's text of each
 * built-in template that the vault has no valid copy of. A template with a problem stays out, and the problem
 * says why; a built-in one falls back to the library's text. `listed` is a listing of the vault that a caller
 * has already, so the vault is not listed twice.
 */
export async function readTemplates(vault: Vault, listed?: readonly string[]): Promise<{ templates: Map<string, Template>; problems: TemplateProblem[] }> {
  const { folders } = vault;
  const templates = new Map<string, Template>();
  const problems: TemplateProblem[] = [];
  const paths = listed ? listed.filter((path) => path.startsWith(`${folders.templates}/`)) : await vault.list(folders.templates);
  for (const path of [...paths].sort()) {
    const parts = path.slice(folders.templates.length + 1).split("/");
    if (parts.length === 2 && parts[1] === TEMPLATE_FORM.file) {
      const read = parseTemplate(vault, path, await vault.read(path), parts[0]!);
      if (read.template) templates.set(read.template.name, read.template);
      for (const message of read.problems) problems.push({ path, message });
    } else if (parts.length === 1 && path.endsWith(".md")) {
      const name = parts[0]!.slice(0, -3);
      problems.push({ path, message: `A template is a folder with a ${TEMPLATE_FORM.file} in it. Move this file to ${templatePath(folders, name.toLowerCase().replace(/[^a-z0-9]+/g, "-"))}.` });
    }
  }
  for (const [name, text] of Object.entries(BUILT_IN_TEMPLATES)) {
    if (templates.has(name)) continue;
    const path = templatePath(folders, name);
    templates.set(name, { ...parseTemplate(vault, path, text(folders), name).template!, path });
  }
  return { templates, problems };
}

/** The level-2 headings of a body, outside its code blocks, as their text. */
export function sectionHeadings(body: string): string[] {
  const out: string[] = [];
  let fence: string | undefined;
  for (const line of body.split("\n")) {
    const opened = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (opened && opened[0] === fence[0] && opened.length >= fence.length) fence = undefined;
      continue;
    }
    if (opened) {
      fence = opened;
      continue;
    }
    const heading = /^ {0,3}##[ \t]+(.+?)[ \t#]*$/.exec(line)?.[1];
    if (heading) out.push(heading.trim());
  }
  return out;
}

/** What a body lacks of its template's sections: each section it does not hold, and each pair it holds out of order. */
export function sectionProblems(body: string, template: Pick<Template, "name" | "sections">): string[] {
  const headings = sectionHeadings(body).map((h) => h.toLowerCase());
  const problems: string[] = [];
  const missing = template.sections.filter((s) => !headings.includes(s.toLowerCase()));
  if (missing.length) problems.push(`has no ${missing.map((s) => `## ${s}`).join(", ")} section${missing.length === 1 ? "" : "s"}, which the ${template.name} template asks for`);
  const held = template.sections.filter((s) => headings.includes(s.toLowerCase()));
  for (let i = 1; i < held.length; i++) {
    if (headings.indexOf(held[i]!.toLowerCase()) < headings.indexOf(held[i - 1]!.toLowerCase())) {
      problems.push(`has ## ${held[i]} before ## ${held[i - 1]}; the ${template.name} template puts ${held[i - 1]} first`);
      break;
    }
  }
  return problems;
}

/** A check that lint runs on the pages of each template that names it. Each message is one warning. */
export interface TemplateCheck {
  description: string;
  fix: string;
  run(wiki: Wiki, note: Note): string[];
}

/** An entry line of a timeline: `- **2024-03-14**: …`. */
const ENTRY = /^\s*[-*+]\s+\*\*([^*]+)\*\*/;
const DATE = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/;

/** The date of an entry, as a number that orders the entries: a year alone comes before its months. */
function entryDate(text: string): number | undefined {
  const match = DATE.exec(text.trim());
  return match ? Number(match[1]) * 10000 + Number(match[2] ?? 0) * 100 + Number(match[3] ?? 0) : undefined;
}

/** The template checks, by name. A template names the ones that apply to its pages in `checks`. */
export const templateChecks: Readonly<Record<string, TemplateCheck>> = {
  chronological: {
    description: "The entry lines, `- **<date>**: …`, are in date order, oldest first, and each date is a year, a month, or a day.",
    fix: "put the entries in date order, oldest first, with each date as YYYY, YYYY-MM, or YYYY-MM-DD",
    run(_wiki, note) {
      const messages: string[] = [];
      let last: { text: string; date: number } | undefined;
      for (const line of note.body.split("\n")) {
        const text = ENTRY.exec(line)?.[1];
        if (text === undefined) continue;
        const date = entryDate(text);
        if (date === undefined) {
          messages.push(`has the entry "${text.trim()}", whose date is not YYYY, YYYY-MM, or YYYY-MM-DD`);
          continue;
        }
        if (last && date < last.date) messages.push(`has the entry ${text.trim()} after ${last.text}; the entries go oldest first`);
        last = { text: text.trim(), date };
      }
      return messages;
    },
  },
  coverage: {
    description: "The page links every page that holds its `tag`, or a tag below it.",
    fix: "link each page, under the group it belongs to, or move the page to another tag",
    run(wiki, note) {
      const tag = typeof note.properties.tag === "string" ? normalizeTag(note.properties.tag) : "";
      if (!tag) return [];
      const linked = new Set(note.links);
      const missing = wiki.notes.filter((other) => other !== note && wiki.isPage(other) && other.tags.includes(tag) && !linked.has(other.path));
      if (!missing.length) return [];
      const shown = missing.slice(0, 10).map((other) => `[[${other.name}]]`);
      return [`does not link ${missing.length} page${missing.length === 1 ? "" : "s"} under #${tag}: ${shown.join(", ")}${missing.length > shown.length ? ", …" : ""}`];
    },
  },
};

/** An empty value of each field type, for a required property that a new page leaves for the person to fill. */
const EMPTY: Record<string, unknown> = { text: "", date: "", link: "", number: 0, boolean: false, list: [], links: [], map: {} };

/**
 * The properties and the body of a new page of a template: the type, the description, each required property
 * of the template with its default or an empty value, and a heading for each of its sections.
 */
export function pageSkeleton(template: Pick<Template, "name" | "properties" | "sections">, description: string): { properties: Record<string, unknown>; body: string } {
  const properties: Record<string, unknown> = { type: template.name, description };
  for (const [name, field] of Object.entries(template.properties)) {
    if (field.required) properties[name] = field.default ?? EMPTY[field.type];
  }
  const body = template.sections.map((section) => `## ${section}\n`).join("\n");
  return { properties, body };
}

/** The text of a new template of the person's own, valid as written: a name, a description, and the sections of a topic. */
export function starterTemplate(name: string): string {
  return `---
name: ${name}
description: What a page of this template is about, in one sentence.
properties: {}
sections: [Summary, Related, Sources, Notes]
cites: true
checks: []
---
# ${name[0]!.toUpperCase()}${name.slice(1).replace(/-/g, " ")}

Say here what a page of this template is, and how to write it. The agents read this text before they write a page of it.

## When to use

## When not to use

## Properties

Add the template's own properties under \`properties\` above, each as its type (\`location: text\`) or as a map (\`date: {type: date, required: true}\`). The types are text, number, boolean, date, list, link, links, and map.

## Sections

- **Summary**: …
- **Related**: links to related pages, each with a few words on how it relates.
- **Sources**: each cited source, with one line on what it gives.
- **Notes**: the person's own. An agent never changes it.
`;
}
