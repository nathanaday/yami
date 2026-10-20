import { FORMS } from "./schema.js";
import type { Properties, Vault } from "./vault.js";

export interface Document {
  path: string;
  properties: Properties;
  body: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** A document whose properties do not parse, for example a value with `: ` in it and no quotes. */
export class PropertiesError extends Error {
  constructor(
    readonly path: string,
    /** The parser's first line: what is wrong, and where. */
    readonly reason: string,
    /** The text after the properties. */
    readonly body: string,
  ) {
    super(`The properties of ${path} do not parse: ${reason}`);
    this.name = "PropertiesError";
  }
}

/** Splits a document into its properties and its body. Properties that do not parse throw a `PropertiesError` that names the document. */
export function parseDocument(vault: Vault, path: string, text: string): Document {
  const match = text.match(FRONTMATTER);
  if (!match) return { path, properties: {}, body: text };
  const body = text.slice(match[0].length);
  let properties: unknown;
  try {
    properties = vault.parseProperties(match[1]!);
  } catch (error) {
    throw new PropertiesError(path, (error instanceof Error ? error.message : String(error)).split("\n")[0]!.trim(), body);
  }
  if (properties !== null && properties !== undefined && (typeof properties !== "object" || Array.isArray(properties))) {
    throw new PropertiesError(path, "the properties are not names with values", body);
  }
  return { path, properties: (properties as Properties | null) ?? {}, body };
}

export function serializeDocument(vault: Vault, doc: Document): string {
  const yaml = vault.stringifyProperties(doc.properties).replace(/\n+$/, "");
  return `---\n${yaml}\n---\n${doc.body}`;
}

export async function readDocument(vault: Vault, path: string): Promise<Document> {
  return parseDocument(vault, path, await vault.read(path));
}

export function writeDocument(vault: Vault, doc: Document): Promise<void> {
  return vault.write(doc.path, serializeDocument(vault, doc));
}

/** The last update of each document of a vault, which the next one waits for. */
const updates = new WeakMap<Vault, Map<string, Promise<unknown>>>();

/**
 * Reads a document, applies `change` to it, and writes it back. The updates of one document run one after
 * another, so two that run at the same time, such as the progress of two agents, do not lose one.
 */
export function updateDocument(vault: Vault, path: string, change: (doc: Document) => void): Promise<Document> {
  let queue = updates.get(vault);
  if (!queue) updates.set(vault, (queue = new Map()));
  const update = (queue.get(path) ?? Promise.resolve()).then(async () => {
    const doc = await readDocument(vault, path);
    change(doc);
    await writeDocument(vault, doc);
    return doc;
  });
  const settled = update.catch(() => undefined);
  queue.set(path, settled);
  void settled.then(() => queue.get(path) === settled && queue.delete(path));
  return update;
}

/** The file name without its folder and `.md`. */
export function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
}

const FORM_FILES: ReadonlySet<string> = new Set(Object.values(FORMS).map((form) => form.file));

/** The display name of a document: the file name, or the folder name of a form, such as a `SKILL.md` or a `POLICY.md`. */
export function documentName(path: string): string {
  const file = path.slice(path.lastIndexOf("/") + 1);
  return FORM_FILES.has(file) ? basename(path.slice(0, path.lastIndexOf("/"))) : basename(path);
}

/**
 * A link to a document by its full path, with the document name as the alias.
 * Obsidian resolves it whatever other documents are named.
 */
export function link(path: string): string {
  return `[[${path.replace(/\.md$/, "")}|${documentName(path)}]]`;
}

/** The target name of a link: `[[Name|alias]]` and the table form `[[Name\|alias]]` give `Name`. A plain name passes through. */
export function linkTarget(value: string): string {
  return value.replace(/^\[\[|\]\]$/g, "").split(/\\?\||#/)[0].trim();
}

/** The link targets in a property that holds one link or a list of links. */
export function linksOf(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return values.filter((item): item is string => typeof item === "string" && item !== "").map(linkTarget);
}

/** Finds a link target: a path, or a file name searched in `folders` in order and then the whole vault. */
export async function resolveLink(vault: Vault, name: string, folders: string[]): Promise<string | undefined> {
  const file = name.endsWith(".md") ? name : `${name}.md`;
  if (file.includes("/") && (await vault.exists(file))) return file;
  for (const folder of [...folders, ""]) {
    const found = (await vault.list(folder)).find((path) => path === file || path.endsWith(`/${file}`));
    if (found) return found;
  }
  return undefined;
}

/**
 * A wiki link, `[[target#heading|alias]]`, or an embed with `!`. Group 1 is the target; group 2 the heading and the alias.
 * In a table the alias pipe is escaped, `[[target\|alias]]`: the escape stays in group 2, so a rewritten link stays valid.
 */
export const LINK = /!?\[\[((?:[^\]|#\\]|\\(?!\|))+)((?:#(?:[^\]|\\]|\\(?!\|))*)?(?:\\?\|[^\]]*)?)\]\]/g;

/** A level-2 heading line, as Markdown reads it: up to three spaces, `##`, and a space, a tab, or the end of the line. */
const LEVEL_2 = /^ {0,3}##(?:[ \t].*)?$/m;

/** The lines of a `## heading` section: its heading's line, and the line after its end. Yami writes its headings at column 0. */
function sectionLines(lines: string[], heading: string): [number, number] | undefined {
  const start = lines.findIndex((line) => line.trimEnd() === `## ${heading}`);
  if (start === -1) return undefined;
  const end = lines.findIndex((line, index) => index > start && LEVEL_2.test(line));
  return [start, end === -1 ? lines.length : end];
}

/** Throws when the content for a `## heading` section holds a level-2 heading line, which would start a section of its own. */
export function checkSection(heading: string, content: string): void {
  const line = LEVEL_2.exec(content)?.[0];
  if (line) throw new Error(`The text for the ${heading} section holds the heading line "${line.trim()}", which would start a section of its own. Write it as plain text, or as a ### heading.`);
}

/** The content of a `## heading` section, trimmed, without the heading. Empty when the body has none. */
export function sectionText(body: string, heading: string): string {
  const lines = body.split("\n");
  const span = sectionLines(lines, heading);
  return span ? lines.slice(span[0] + 1, span[1]).join("\n").trim() : "";
}

/**
 * Replaces the `## heading` section of a body, or appends it. The content has no heading. It throws on content
 * with a level-2 heading line, which would start a section of its own: see `checkSection`.
 */
export function replaceSection(body: string, heading: string, content: string): string {
  checkSection(heading, content);
  const section = `## ${heading}\n${content.replace(/\n+$/, "")}\n`;
  const lines = body.split("\n");
  const span = sectionLines(lines, heading);
  if (!span) return `${body.replace(/\n+$/, "")}\n\n${section}`;
  const [start, end] = span;
  const before = lines.slice(0, start).join("\n");
  const after = lines.slice(end).join("\n");
  return `${before}${before ? "\n" : ""}${section}${after ? `\n${after}` : ""}`;
}
