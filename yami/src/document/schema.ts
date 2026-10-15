import type { Properties } from "./vault.js";

export type FieldType = "text" | "number" | "boolean" | "date" | "list" | "link" | "links";

export interface Field {
  type: FieldType;
  required?: boolean;
  default?: unknown;
  /** The allowed values of a text field. */
  values?: readonly string[];
}

export type Schema = Record<string, Field>;

export const DOCUMENT_TYPES = ["module", "session", "policy", "promise", "skill", "conversation"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const SESSION_STATES = ["open", "running", "done", "failed", "needs-attention"] as const;
export type SessionState = (typeof SESSION_STATES)[number];

const typed = (type: DocumentType): Field => ({ type: "text", values: [type], required: true });
const links: Field = { type: "links", default: [] };

export const MODULE: Schema = {
  type: typed("module"),
  module: { type: "text", required: true },
  name: { type: "text", required: true },
  description: { type: "text" },
  created: { type: "date" },
};

export const SESSION: Schema = {
  type: typed("session"),
  module: { type: "text", required: true },
  state: { type: "text", values: SESSION_STATES, default: "open" },
  created: { type: "date" },
  iteration: { type: "number", default: 0 },
  harness: { type: "text" },
  harness_session: { type: "text" },
  articles: links,
  policies: links,
  promises: links,
  skills: links,
  met: links,
  unmet: links,
};

export const CONVERSATION: Schema = {
  type: typed("conversation"),
  /** The name of the agent, as the host registered it. */
  agent: { type: "text", required: true },
  model: { type: "text" },
  effort: { type: "text" },
  approval: { type: "text", values: ["ask", "accept-edits", "plan", "auto", "sandbox"] },
  /** The harness session, for resuming. */
  session: { type: "text" },
  status: { type: "text", values: ["active", "ended"], default: "active" },
  created: { type: "date" },
  /** The module session document that this conversation runs. */
  module: { type: "link" },
};

export const POLICY: Schema = {
  type: typed("policy"),
  module: { type: "text" },
};

export const PROMISE: Schema = {
  type: typed("promise"),
  module: { type: "text" },
  /** The name of a check that Yami runs, for example `exists`. Without one, a person decides. */
  check: { type: "text" },
  /** The vault path of the deliverable. `{{session}}` is the session name. */
  path: { type: "text" },
};

/** Fills in the default of each field that is missing. */
export function withDefaults(properties: Properties, schema: Schema): Properties {
  const result = { ...properties };
  for (const [name, field] of Object.entries(schema)) {
    if (result[name] === undefined && field.default !== undefined) {
      result[name] = Array.isArray(field.default) ? [...field.default] : field.default;
    }
  }
  return result;
}

/** Returns one message for each field that does not match the schema. */
export function validate(properties: Properties, schema: Schema): string[] {
  const errors: string[] = [];
  for (const [name, field] of Object.entries(schema)) {
    const value = properties[name];
    if (value === undefined || value === null) {
      if (field.required) errors.push(`${name} is missing`);
      continue;
    }
    if (!matches(value, field.type)) errors.push(`${name} must be ${describe(field.type)}`);
    else if (field.values && !field.values.includes(value as string)) {
      errors.push(`${name} must be one of ${field.values.join(", ")}`);
    }
  }
  return errors;
}

function matches(value: unknown, type: FieldType): boolean {
  switch (type) {
    case "text":
    case "date":
    case "link":
      return typeof value === "string";
    case "number":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    case "list":
    case "links":
      return Array.isArray(value);
  }
}

function describe(type: FieldType): string {
  return type === "list" || type === "links" ? "a list" : type === "number" ? "a number" : type === "boolean" ? "true or false" : "text";
}

/** The current local time as `YYYY-MM-DDTHH:MM:SS`, the form that Obsidian shows as a date. */
export function timestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
