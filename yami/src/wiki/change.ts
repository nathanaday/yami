import { link, readDocument, serializeDocument, updateDocument, writeDocument, type Document } from "../document/document.js";
import { SOURCE, timestamp, TOPIC, validate, withDefaults } from "../document/schema.js";
import type { Properties, Vault } from "../document/vault.js";
import { CHANGES, inKnowledge, SOURCES, TOPICS } from "./folders.js";
import type { Wiki } from "./wiki.js";

/** One write of a change plan. */
export interface Write {
  op: "create" | "modify" | "remove";
  /** The note, under the knowledge folders. */
  path: string;
  /** create: every property. modify: merged over the note's properties; `null` removes one. */
  properties?: Properties;
  /** create: the body. modify: the new body; left out, the body stays. */
  body?: string;
  /** One line on why the change makes this write. */
  why?: string;
}

export interface ChangePlan {
  /** A short name: the file name of the change document. */
  title: string;
  /** What the change does and why, and what it skipped. */
  notes?: string;
  /** The session document that proposed it, as a path. The change links from it. */
  session?: string;
  writes: Write[];
}

export interface AppliedChange {
  /** The change document. */
  path: string;
  before: number;
  after: number;
  creates: number;
  modifies: number;
  removes: number;
  /** Links in the new content that resolve to no note. */
  warnings: string[];
}

export const MAX_WRITES = 100;

/** Validation that refuses the plan. Each message names the write and the rule. */
export class InvalidPlan extends Error {
  constructor(readonly problems: string[]) {
    super(`The change plan is not valid:\n${problems.map((p) => `- ${p}`).join("\n")}`);
    this.name = "InvalidPlan";
  }
}

const SCHEMA_OF = { topic: TOPIC, source: SOURCE } as const;

/** Checks the plan against the wiki as it is now. Returns the warnings, or throws `InvalidPlan`. */
export async function validatePlan(wiki: Wiki, plan: ChangePlan): Promise<string[]> {
  const problems: string[] = [];
  const warnings: string[] = [];
  if (!plan.title?.trim()) problems.push("the plan needs a title");
  if (!plan.writes?.length) problems.push("the plan has no writes");
  if (plan.writes?.length > MAX_WRITES) problems.push(`the plan has ${plan.writes.length} writes; at most ${MAX_WRITES}, so split it`);
  if (plan.session) {
    const session = await wiki.vault.exists(plan.session) ? await readDocument(wiki.vault, plan.session) : undefined;
    if (session?.properties.type !== "session") problems.push(`session ${plan.session} is not a session document`);
  }
  const seen = new Set<string>();
  const created = new Set<string>();
  for (const [i, write] of (plan.writes ?? []).entries()) {
    const label = `write ${i + 1} (${write.op} ${write.path})`;
    if (!["create", "modify", "remove"].includes(write.op)) problems.push(`${label}: op must be create, modify, or remove`);
    if (typeof write.path !== "string" || !inKnowledge(write.path) || write.path.includes("..")) {
      problems.push(`${label}: the path must be a note under ${TOPICS}/ or ${SOURCES}/`);
      continue;
    }
    if (seen.has(write.path)) problems.push(`${label}: the plan writes this note twice`);
    seen.add(write.path);
    const exists = wiki.note(write.path) !== undefined;
    if (write.op === "create") {
      if (exists) problems.push(`${label}: the note exists; use modify`);
      created.add(write.path);
      const type = write.path.startsWith(`${TOPICS}/`) ? "topic" : "source";
      const properties = withDefaults({ ...write.properties, type }, SCHEMA_OF[type]);
      if (write.properties?.type && write.properties.type !== type) problems.push(`${label}: a note in this folder has type ${type}`);
      for (const error of validate(properties, SCHEMA_OF[type])) problems.push(`${label}: ${error}`);
      if (!String(properties.description ?? "").trim()) problems.push(`${label}: description is empty`);
      if (typeof write.body !== "string") problems.push(`${label}: a create needs a body`);
    } else if (!exists) {
      problems.push(`${label}: no note at this path`);
    } else if (write.op === "modify") {
      const note = wiki.note(write.path)!;
      const type = note.type === "source" ? "source" : "topic";
      const merged = merge(note.properties, write.properties ?? {});
      for (const error of validate(merged, SCHEMA_OF[type])) problems.push(`${label}: ${error}`);
      if (!String(merged.description ?? "").trim()) problems.push(`${label}: description is empty`);
      if (write.properties === undefined && write.body === undefined) problems.push(`${label}: a modify changes properties or the body`);
    }
  }
  for (const write of plan.writes ?? []) {
    if (write.op === "remove" || typeof write.body !== "string") continue;
    for (const match of write.body.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) {
      const target = match[1]!.trim();
      if (/\.[a-z0-9]{1,5}$/i.test(target) && !target.endsWith(".md")) continue;
      if (wiki.locate(target) || created.has(`${target.replace(/\.md$/, "")}.md`) || [...created].some((p) => p.endsWith(`/${target}.md`))) continue;
      warnings.push(`${write.path} links [[${target}]], which is not a note`);
    }
  }
  if (problems.length) throw new InvalidPlan(problems);
  return [...new Set(warnings)];
}

/** Properties with a change merged over them; a `null` removes a property. */
function merge(base: Properties, changes: Properties): Properties {
  const out = { ...base };
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) delete out[key];
    else out[key] = value;
  }
  return out;
}

/** Writes the plan's notes into the vault. The caller has validated the plan and taken the snapshot before. */
export async function applyWrites(vault: Vault, plan: ChangePlan, now: string): Promise<void> {
  for (const write of plan.writes) {
    if (write.op === "remove") {
      await vault.remove(write.path);
    } else if (write.op === "create") {
      const type = write.path.startsWith(`${TOPICS}/`) ? "topic" : "source";
      const properties = withDefaults({ ...write.properties, type, created: now, updated: now }, SCHEMA_OF[type]);
      await writeDocument(vault, { path: write.path, properties, body: `${(write.body ?? "").replace(/\n*$/, "")}\n` });
    } else {
      await updateDocument(vault, write.path, (doc) => {
        doc.properties = { ...merge(doc.properties, write.properties ?? {}), updated: now };
        if (typeof write.body === "string") doc.body = `${write.body.replace(/\n*$/, "")}\n`;
      });
    }
  }
}

/** The vault path of a new change document: the time and the title. */
export async function changePath(vault: Vault, title: string, now: string): Promise<string> {
  const safe = title.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Change";
  const stamp = `${now.slice(0, 10)} ${now.slice(11, 16).replace(":", "")}`;
  let path = `${CHANGES}/${stamp} ${safe}.md`;
  for (let n = 2; await vault.exists(path); n++) path = `${CHANGES}/${stamp} ${safe} (${n}).md`;
  return path;
}

/** The change document, as a record a person reads: the summary, the notes, and every write in full. */
export function changeDocument(vault: Vault, path: string, plan: ChangePlan, properties: Properties, wiki: Wiki): Document {
  const name = (p: string) => p.slice(p.lastIndexOf("/") + 1, -3);
  const summary = plan.writes.map((write) => {
    const target = write.op === "remove" ? name(write.path) : link(write.path);
    return `- **${write.op}** ${target}${write.why ? ` · ${write.why.slice(0, 160)}` : ""}`;
  });
  const writes = plan.writes.flatMap((write) => {
    const head = `### ${write.op} · ${name(write.path)}`;
    if (write.op === "remove") return [head, "", `Removed ${write.path}.`, ""];
    const current = wiki.note(write.path);
    const properties = write.op === "create" ? { ...write.properties } : merge(current?.properties ?? {}, write.properties ?? {});
    const body = typeof write.body === "string" ? write.body : (current?.body ?? "");
    const text = serializeDocument(vault, { path: write.path, properties, body: `${body.replace(/\n*$/, "")}\n` });
    return [head, "", "`````markdown", text.replace(/\n*$/, ""), "`````", ""];
  });
  const body = [
    `# ${plan.title}`,
    "",
    "## Summary",
    "",
    ...summary,
    "",
    ...(plan.notes?.trim() ? ["## Notes", "", plan.notes.trim(), ""] : []),
    "## Writes",
    "",
    ...writes,
  ].join("\n");
  return { path, properties: { type: "change", module: "wiki", title: plan.title, ...properties, created: timestamp() }, body };
}
