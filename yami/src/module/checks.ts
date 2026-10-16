import { basename, linksOf, readDocument, type Document } from "../document/document.js";
import type { Properties, Vault } from "../document/vault.js";
import type { Wiki } from "../wiki/wiki.js";

export interface CheckContext {
  vault: Vault;
  /** The vault's wiki, refreshed after the agent's turn. */
  wiki: Wiki;
  /** The session document, as a vault path. Its name fills `{{session}}` in promise values. */
  path: string;
  /** The session properties, for `{{name}}` in promise paths. */
  properties: Properties;
}

export interface CheckResult {
  /** `review` means that Yami cannot check the promise, so a person decides. */
  status: "met" | "unmet" | "review";
  detail: string;
}

export type Check = (promise: Document, context: CheckContext) => Promise<CheckResult>;

/** Fills `{{session}}` and `{{property}}` in a promise value. */
export function expand(template: string, context: CheckContext): string {
  return template.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_match, name: string) =>
    name === "session" ? basename(context.path) : String(context.properties[name] ?? ""),
  );
}

const exists: Check = async (promise, context) => {
  const path = expand(String(promise.properties.path ?? ""), context);
  if (!path) return { status: "review", detail: "the promise has no path" };
  return (await context.vault.exists(path))
    ? { status: "met", detail: `found ${path}` }
    : { status: "unmet", detail: `no file at ${path}` };
};

const contains: Check = async (promise, context) => {
  const result = await exists(promise, context);
  if (result.status !== "met") return result;
  const path = expand(String(promise.properties.path), context);
  const text = expand(String(promise.properties.text ?? ""), context);
  return (await context.vault.read(path)).includes(text)
    ? { status: "met", detail: `${path} contains "${text}"` }
    : { status: "unmet", detail: `${path} does not contain "${text}"` };
};

/** The notes that a session field links, as paths, indexed or not. A target that is no note is reported by name. */
async function linked(field: string, context: CheckContext): Promise<{ paths: string[]; missing: string[] }> {
  const paths: string[] = [];
  const missing: string[] = [];
  for (const target of linksOf(context.properties[field])) {
    const path = context.wiki.locate(target);
    if (path) paths.push(path);
    else missing.push(target);
  }
  return { paths, missing };
}

/**
 * Met when every note linked in the session's `field` has the property `name` equal to `value`,
 * and the field links at least `atLeast` notes (default 0).
 */
const property: Check = async (promise, context) => {
  const field = String(promise.properties.field ?? "");
  const name = String(promise.properties.name ?? "");
  if (!field || !name) return { status: "review", detail: "the promise needs field and name" };
  const value = promise.properties.value;
  const atLeast = Number(promise.properties.atLeast ?? 0);
  const { paths, missing } = await linked(field, context);
  if (missing.length) return { status: "unmet", detail: `${field} links ${missing.join(", ")}, which are not notes` };
  if (paths.length < atLeast) return { status: "unmet", detail: `${field} links ${paths.length} note(s); at least ${atLeast} needed` };
  const wrong: string[] = [];
  for (const path of paths) if ((await readDocument(context.vault, path)).properties[name] !== value) wrong.push(path);
  return wrong.length
    ? { status: "unmet", detail: `${name} is not ${String(value)} in ${wrong.join(", ")}` }
    : { status: "met", detail: paths.length ? `${name} is ${String(value)} in ${paths.length} note(s)` : `${field} links nothing` };
};

/**
 * Met when the wiki's lint has no error in the notes the promise names: `path`, a `folder`,
 * or the notes linked in the session's `field` and every note that links them.
 */
const lint: Check = async (promise, context) => {
  const path = expand(String(promise.properties.path ?? ""), context);
  const folder = String(promise.properties.folder ?? "");
  const field = String(promise.properties.field ?? "");
  let paths: string[] | undefined;
  if (path) paths = [path];
  else if (field) {
    const { paths: linkedPaths, missing } = await linked(field, context);
    if (missing.length) return { status: "unmet", detail: `${field} links ${missing.join(", ")}, which are not notes` };
    paths = [...new Set(linkedPaths.flatMap((p) => [p, ...(context.wiki.note(p)?.backlinks ?? [])]))];
    if (!paths.length) return { status: "met", detail: `${field} links nothing` };
  } else if (!folder) return { status: "review", detail: "the promise needs path, folder, or field" };
  const findings = (await context.wiki.lint({ paths, folder: folder || undefined })).filter((f) => f.severity === "error");
  if (!findings.length) return { status: "met", detail: `lint found no error in ${paths ? `${paths.length} note(s)` : folder}` };
  const shown = findings.slice(0, 5).map((f) => `${f.path} ${f.message}`);
  return { status: "unmet", detail: `${findings.length} lint error(s): ${shown.join("; ")}${findings.length > 5 ? "; …" : ""}` };
};

/** The checks that a promise can name in its `check` property. */
export const checks: Record<string, Check> = { exists, contains, property, lint };

/** Runs the check a promise names: one of `own`, the module's checks, or else a core check. */
export async function runCheck(promise: Document, context: CheckContext, own: Record<string, Check> = {}): Promise<CheckResult> {
  const name = promise.properties.check;
  if (typeof name !== "string" || name === "") return { status: "review", detail: "no automatic check" };
  const check = own[name] ?? checks[name];
  if (!check) return { status: "review", detail: `unknown check "${name}"` };
  return check(promise, context);
}
