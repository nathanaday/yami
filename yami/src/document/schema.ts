import type { Properties } from "./vault.js";

export type FieldType = "text" | "number" | "boolean" | "date" | "list" | "link" | "links" | "map";

export interface Field {
  type: FieldType;
  required?: boolean;
  default?: unknown;
  /** The allowed values of a text field. */
  values?: readonly string[];
}

export type Schema = Record<string, Field>;

export const DOCUMENT_TYPES = ["module", "session", "conversation", "topic", "source", "snapshot", "change"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const SESSION_STATES = ["open", "running", "done", "failed", "needs-attention", "stopped"] as const;
export type SessionState = (typeof SESSION_STATES)[number];

const typed = (type: DocumentType): Field => ({ type: "text", values: [type], required: true });
const links: Field = { type: "links", default: [] };
const ACCESS = ["edit", "read-only"] as const;

export const MODULE: Schema = {
  type: typed("module"),
  module: { type: "text", required: true },
  name: { type: "text", required: true },
  description: { type: "text" },
  created: { type: "date" },
  /** A vault module's icon, a name in the host's icon set. */
  icon: { type: "text" },
  /** A vault module's color, as a hex code such as `#3e63dd`. */
  color: { type: "text" },
  /** A vault module's instructions, added to the first prompt of each run. */
  instructions: { type: "text" },
};

/** The header of every form: `name`, the name of the document's folder, and `description`. */
const form = (more: Schema = {}): Schema => ({ name: { type: "text", required: true }, description: { type: "text", required: true }, ...more });

/** `POLICY.md`: rules that a session follows. The body is the rule text. */
export const POLICY: Schema = form();

/** `PROMISE.md`: a deliverable, and how Yami checks it. The check reads more properties of its own. */
export const PROMISE: Schema = form({
  /** The name of a check that Yami runs, for example `exists`. Without one, the review judges the promise. */
  check: { type: "text" },
  /** The vault path of the deliverable. `{{session}}` is the session name. */
  path: { type: "text" },
});

/** `AGENT.md`: the brief of a worker that runs in a fresh context. The body is the brief. */
export const AGENT: Schema = form({
  /** `read-only`: the agent changes no file, runs only commands that write nothing, and gets only the tools that change nothing. */
  access: { type: "text", values: ACCESS, default: "read-only" },
});

/** `SKILL.md`: a skill in the standard form. */
export const SKILL: Schema = form();

/** `FLOW.md`: one kind of session, as a signature. It has no body. */
export const FLOW: Schema = form({
  /** The names of the documents that a new session links. The first skill loads first. */
  skills: links,
  agents: links,
  policies: links,
  promises: links,
  /** `[[links]]` to notes whose content is context for the agent. */
  articles: links,
  /** The session fields of a new session, each with its default. */
  fields: { type: "map" },
  /** Agent turns in one run. Default 3. */
  maxIterations: { type: "number" },
  access: { type: "text", values: ACCESS },
  /** Text added to the first prompt of a run, after the module's instructions. */
  instructions: { type: "text" },
  /** Whether a host offers a command that creates a session. Default true. */
  command: { type: "boolean" },
});

/**
 * The forms of a module's documents. Each is a folder of `internal/<module>/<folder>/`, named by the
 * document's name, with the one file in it. The folder can hold other files, which the document names by path.
 */
export const FORMS = {
  agent: { folder: "agents", file: "AGENT.md", schema: AGENT },
  policy: { folder: "policies", file: "POLICY.md", schema: POLICY },
  promise: { folder: "promises", file: "PROMISE.md", schema: PROMISE },
  skill: { folder: "skills", file: "SKILL.md", schema: SKILL },
  flow: { folder: "flows", file: "FLOW.md", schema: FLOW },
} as const;
export type FormKind = keyof typeof FORMS;

export const SESSION: Schema = {
  type: typed("session"),
  module: { type: "text", required: true },
  /** The flow of the module that the session came from. */
  flow: { type: "text" },
  state: { type: "text", values: SESSION_STATES, default: "open" },
  created: { type: "date" },
  iteration: { type: "number", default: 0 },
  harness: { type: "text" },
  /** The conversation note that records the runs. */
  conversation: { type: "link" },
  agents: links,
  articles: links,
  policies: links,
  promises: links,
  skills: links,
  met: links,
  unmet: links,
  /** The conversation note of the last review. */
  review: { type: "link" },
  /** The policies that the last review found followed, and broken. */
  followed: links,
  broken: links,
};

export const CONVERSATION: Schema = {
  type: typed("conversation"),
  /** The name of the agent, as the host registered it. */
  agent: { type: "text", required: true },
  model: { type: "text" },
  effort: { type: "text" },
  approval: { type: "text", values: ["ask", "accept-edits", "plan", "auto", "sandbox"] },
  /** `read-only`: the agent changes nothing except through its tools. */
  access: { type: "text", values: ACCESS },
  /** The harness session, for resuming. */
  session: { type: "text" },
  status: { type: "text", values: ["active", "ended"], default: "active" },
  created: { type: "date" },
  /** The module session document that this conversation runs. */
  module: { type: "link" },
};

export const TOPIC_STATUSES = ["draft", "stable", "contested", "deprecated"] as const;
export const TOPIC_KINDS = ["concept", "entity", "overview"] as const;

/** A note the wiki maintains about one subject. */
export const TOPIC: Schema = {
  type: typed("topic"),
  description: { type: "text", required: true },
  tags: { type: "list", default: [] },
  aliases: { type: "list", default: [] },
  /** Every source the topic cites. */
  sources: links,
  status: { type: "text", values: TOPIC_STATUSES, default: "draft" },
  kind: { type: "text", values: TOPIC_KINDS },
  created: { type: "date" },
  updated: { type: "date" },
};

export const SOURCE_STATUSES = ["pending", "absorbed"] as const;
export const AUTHORITIES = ["official", "primary", "secondary", "community", "synthetic", "unknown"] as const;

/** A note that stands for one original the wiki learned from. */
export const SOURCE: Schema = {
  type: typed("source"),
  description: { type: "text", required: true },
  tags: { type: "list", default: [] },
  aliases: { type: "list", default: [] },
  /** The frozen copy that the source stands for, in `internal/wiki/originals/`. */
  file: { type: "link", required: true },
  /** Where the copy was captured from. That file can change later; the copy does not. */
  from: { type: "link" },
  /** The SHA-256 of the captured content. */
  sha256: { type: "text" },
  status: { type: "text", values: SOURCE_STATUSES, default: "pending" },
  authority: { type: "text", values: AUTHORITIES },
  created: { type: "date" },
};

/** One version of the wiki: the state of the knowledge base at one time, kept as an archive beside the document. */
export const SNAPSHOT: Schema = {
  type: typed("snapshot"),
  module: { type: "text", required: true },
  version: { type: "number", required: true },
  created: { type: "date" },
  /** The hash of every note's path and text. The wiki is captured when its hash equals the latest snapshot's. */
  hash: { type: "text", required: true },
  /** How many notes the archive holds. */
  notes: { type: "number" },
  /** The archive's vault path. */
  archive: { type: "text", required: true },
  /** The change that led to this version, when one did. */
  change: { type: "link" },
  /** The version this one restored, when it did. */
  restored: { type: "number" },
};

export const CHANGE_STATUSES = ["applying", "applied", "failed"] as const;

/** One change to the wiki: the plan an agent built, and what happened to it. */
export const CHANGE: Schema = {
  type: typed("change"),
  module: { type: "text", required: true },
  title: { type: "text", required: true },
  status: { type: "text", values: CHANGE_STATUSES, required: true },
  created: { type: "date" },
  applied: { type: "date" },
  /** The session that proposed it. */
  session: { type: "link" },
  /** The versions before and after the change. */
  before: { type: "number" },
  after: { type: "number" },
  creates: { type: "number" },
  modifies: { type: "number" },
  removes: { type: "number" },
  /** Why the change failed. */
  error: { type: "text" },
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
    case "map":
      return typeof value === "object" && !Array.isArray(value);
  }
}

function describe(type: FieldType): string {
  return type === "list" || type === "links" ? "a list" : type === "map" ? "names with values" : type === "number" ? "a number" : type === "boolean" ? "true or false" : "text";
}

/** The current local time as `YYYY-MM-DDTHH:MM:SS`, the form that Obsidian shows as a date. */
export function timestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
