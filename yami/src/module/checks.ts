import type { Document } from "../document/document.js";
import type { Properties, Vault } from "../document/vault.js";

export interface CheckContext {
  vault: Vault;
  /** The session name, for `{{session}}` in promise paths. */
  session: string;
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
    name === "session" ? context.session : String(context.properties[name] ?? ""),
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

/** The checks that a promise can name in its `check` property. */
export const checks: Record<string, Check> = { exists, contains };

export async function runCheck(promise: Document, context: CheckContext): Promise<CheckResult> {
  const name = promise.properties.check;
  if (typeof name !== "string" || name === "") return { status: "review", detail: "no automatic check" };
  const check = checks[name];
  if (!check) return { status: "review", detail: `unknown check "${name}"` };
  return check(promise, context);
}
