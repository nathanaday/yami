import type { Properties, Vault } from "./vault.js";

export interface Document {
  path: string;
  properties: Properties;
  body: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseDocument(vault: Vault, path: string, text: string): Document {
  const match = text.match(FRONTMATTER);
  if (!match) return { path, properties: {}, body: text };
  return { path, properties: vault.parseProperties(match[1]) ?? {}, body: text.slice(match[0].length) };
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

/** Reads a document, applies `change` to it, and writes it back. */
export async function updateDocument(vault: Vault, path: string, change: (doc: Document) => void): Promise<Document> {
  const doc = await readDocument(vault, path);
  change(doc);
  await writeDocument(vault, doc);
  return doc;
}

/** The file name without its folder and `.md`. */
export function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
}

/** The display name of a document: the file name, or the folder name of a `SKILL.md`. */
export function documentName(path: string): string {
  const name = basename(path);
  return name === "SKILL" ? basename(path.slice(0, path.lastIndexOf("/"))) : name;
}

/**
 * A link to a document by its full path, with the document name as the alias.
 * Obsidian resolves it whatever other documents are named.
 */
export function link(path: string): string {
  return `[[${path.replace(/\.md$/, "")}|${documentName(path)}]]`;
}

/** The target name of a link: `[[Name|alias]]` gives `Name`. A plain name passes through. */
export function linkTarget(value: string): string {
  return value.replace(/^\[\[|\]\]$/g, "").split(/[|#]/)[0].trim();
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

/** A wiki link, `[[target#heading|alias]]`, or an embed with `!`. Group 1 is the target; group 2 the heading and the alias. */
export const LINK = /!?\[\[([^\]|#]+)((?:#[^\]|]*)?(?:\|[^\]]*)?)\]\]/g;

/** The lines of a `## heading` section: its heading's line, and the line after its end. A heading starts at column 0. */
function sectionLines(lines: string[], heading: string): [number, number] | undefined {
  const start = lines.findIndex((line) => line.trimEnd() === `## ${heading}`);
  if (start === -1) return undefined;
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  return [start, end === -1 ? lines.length : end];
}

/** The content of a `## heading` section, trimmed, without the heading. Empty when the body has none. */
export function sectionText(body: string, heading: string): string {
  const lines = body.split("\n");
  const span = sectionLines(lines, heading);
  return span ? lines.slice(span[0] + 1, span[1]).join("\n").trim() : "";
}

/** Replaces the `## heading` section of a body, or appends it. The content has no heading. */
export function replaceSection(body: string, heading: string, content: string): string {
  const section = `## ${heading}\n${content.replace(/\n+$/, "")}\n`;
  const lines = body.split("\n");
  const span = sectionLines(lines, heading);
  if (!span) return `${body.replace(/\n+$/, "")}\n\n${section}`;
  const [start, end] = span;
  const before = lines.slice(0, start).join("\n");
  const after = lines.slice(end).join("\n");
  return `${before}${before ? "\n" : ""}${section}${after ? `\n${after}` : ""}`;
}
