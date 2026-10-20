import { basename, link, LINK, linkTarget, parseDocument, PropertiesError, readDocument, sectionText, serializeDocument, updateDocument, writeDocument, type Document } from "../document/document.js";
import { SOURCE, timestamp, TOPIC, validate, withDefaults, type ChangeStatus } from "../document/schema.js";
import type { Properties, Vault } from "../document/vault.js";
import { CHANGES, inKnowledge, SOURCES, TOPICS } from "./folders.js";
import { hashBytes } from "./source.js";
import { readArchive, versions } from "./versions.js";
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
  /**
   * modify, remove: the `bodyHash` of the note as the writer read it. The proposal refuses the write when
   * the note changed since, so it never overwrites work it did not see.
   */
  base?: string;
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

/** The counts of a plan's writes. */
export interface WriteCounts {
  creates: number;
  modifies: number;
  removes: number;
}

interface ChangeResult extends WriteCounts {
  /** The change document. */
  path: string;
  title: string;
  /** Links in the new content that resolve to no note. */
  warnings: string[];
}

/** What `wiki.change(plan)` returns: the proposal, written and waiting for a person. */
export interface ProposedChange extends ChangeResult {
  status: "proposed";
}

/** What `wiki.approve(path)` returns: the change, applied, with its versions before and after. */
export interface AppliedChange extends ChangeResult {
  status: "applied";
  before: number;
  after: number;
}

/**
 * A write as the change document records it: the whole note after the write, so the document shows exactly
 * what an approval writes, and the hash of the note's text as the proposal read it.
 */
export interface ProposedWrite {
  op: Write["op"];
  path: string;
  why?: string;
  /** create, modify: every property of the note after the write. */
  properties?: Properties;
  /** create, modify: the whole body after the write. */
  body?: string;
  /** modify, remove: the SHA-256 of the note's text as the proposal read it. */
  hash?: string;
}

/** A change document, read back: the one record of the plan. */
export interface Proposal {
  path: string;
  title: string;
  notes?: string;
  /** The session that proposed it, as a path. */
  session?: string;
  /** The change document's properties. */
  properties: Properties;
  writes: ProposedWrite[];
}

/** One change at a glance, for a list. */
export interface ChangeSummary extends WriteCounts {
  path: string;
  title: string;
  status: ChangeStatus;
  created: string;
  applied?: string;
  rejected?: string;
  /** The session that proposed it, as a path, and that session's module. */
  session?: string;
  module?: string;
  before?: number;
  after?: number;
  notes?: string;
  /** The person's reason for a rejection. */
  reason?: string;
  /** Why the change failed. */
  error?: string;
}

/** One write of a change, with the texts a view shows as a diff. */
export interface ChangeWrite {
  op: Write["op"];
  path: string;
  why?: string;
  /** modify, remove: the note's text before the write: from the version before for an applied change, else the vault now. */
  before?: string;
  /** create, modify: the note's text after the write, as the change document records it. */
  after?: string;
  /** modify, remove: the note's text now is not the text the proposal read, so an approval overwrites a later edit. */
  changed?: boolean;
}

export interface ChangeDetails extends ChangeSummary {
  writes: ChangeWrite[];
}

/** What a person can do with a change now. Both are present only while the change is proposed. */
export type ChangeAct =
  | { kind: "approve"; label: "Approve"; run(): Promise<string> }
  | { kind: "reject"; label: "Reject"; run(reason?: string): Promise<string> };

export const MAX_WRITES = 100;

/** Validation that refuses the plan. Each message names the write and the rule. */
export class InvalidPlan extends Error {
  constructor(readonly problems: string[]) {
    super(`The change plan is not valid:\n${problems.map((p) => `- ${p}`).join("\n")}`);
    this.name = "InvalidPlan";
  }
}

const SCHEMA_OF = { topic: TOPIC, source: SOURCE } as const;
const typeOf = (path: string) => (path.startsWith(`${TOPICS}/`) ? "topic" : "source");

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
      const type = typeOf(write.path);
      const properties = withDefaults({ ...write.properties, type }, SCHEMA_OF[type]);
      if (write.properties?.type && write.properties.type !== type) problems.push(`${label}: a note in this folder has type ${type}`);
      for (const error of validate(properties, SCHEMA_OF[type])) problems.push(`${label}: ${error}`);
      if (!String(properties.description ?? "").trim()) problems.push(`${label}: description is empty`);
      if (typeof write.body !== "string") problems.push(`${label}: a create needs a body`);
    } else if (!exists) {
      problems.push(`${label}: no note at this path`);
    } else if (write.base !== undefined && (await bodyHash(wiki.note(write.path)!.body)) !== write.base) {
      problems.push(`${label}: the note changed since its base was read; read it again`);
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
    for (const match of write.body.matchAll(LINK)) {
      const target = match[1]!.trim();
      if (/\.[a-z0-9]{1,5}$/i.test(target) && !target.endsWith(".md")) continue;
      if (wiki.locate(target) || created.has(`${target.replace(/\.md$/, "")}.md`) || [...created].some((p) => p.endsWith(`/${target}.md`))) continue;
      warnings.push(`${write.path} links [[${target}]], which is not a note`);
    }
  }
  if (problems.length) throw new InvalidPlan(problems);
  return [...new Set(warnings)];
}

/** The hash of a note's body as a change compares it: the SHA-256 of the body without trailing space. */
export async function bodyHash(body: string): Promise<string> {
  return hashBytes(new TextEncoder().encode(body.trimEnd()));
}

/** The hash of a note's whole text, as a proposal records the note it read. */
async function textHash(text: string): Promise<string> {
  return hashBytes(new TextEncoder().encode(text));
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

const cleanBody = (body: string | undefined) => `${(body ?? "").replace(/\n*$/, "")}\n`;

/** The writes of a valid plan as the change document records them: each note whole, after the write. */
export async function resolveWrites(wiki: Wiki, plan: ChangePlan): Promise<ProposedWrite[]> {
  const out: ProposedWrite[] = [];
  for (const { op, path, why, properties, body } of plan.writes) {
    const resolved: ProposedWrite = { op, path, ...(why?.trim() && { why: why.trim() }) };
    if (op === "create") {
      const type = typeOf(path);
      // The type first, so the note reads as the page forms show it.
      const { type: _given, ...rest } = properties ?? {};
      resolved.properties = withDefaults({ type, ...rest }, SCHEMA_OF[type]);
      resolved.body = cleanBody(body);
    } else {
      resolved.hash = await textHash(await wiki.vault.read(path));
      if (op === "modify") {
        const note = wiki.note(path)!;
        resolved.properties = merge(note.properties, properties ?? {});
        resolved.body = cleanBody(body ?? note.body);
      }
    }
    out.push(resolved);
  }
  return out;
}

export function countWrites(writes: { op: Write["op"] }[]): WriteCounts {
  return {
    creates: writes.filter((w) => w.op === "create").length,
    modifies: writes.filter((w) => w.op === "modify").length,
    removes: writes.filter((w) => w.op === "remove").length,
  };
}

/** The counts as a person reads them: `2 created, 1 modified`. */
export function describeCounts(counts: WriteCounts): string {
  return [
    [counts.creates, "created"],
    [counts.modifies, "modified"],
    [counts.removes, "removed"],
  ]
    .filter(([n]) => n)
    .map(([n, word]) => `${n} ${word}`)
    .join(", ");
}

/** Writes the notes of a change into the vault, each whole. The caller has validated the writes and taken the snapshot before. */
export async function applyWrites(vault: Vault, writes: ProposedWrite[], now: string): Promise<void> {
  for (const write of writes) {
    if (write.op === "remove") await vault.remove(write.path);
    else {
      const stamps = write.op === "create" ? { created: now, updated: now } : { updated: now };
      await writeDocument(vault, { path: write.path, properties: { ...write.properties, ...stamps }, body: cleanBody(write.body) });
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

/** The line under the title that says where the change stands, from its properties. */
export function statusText(properties: Properties): string {
  const { status, before, after, error, reason } = properties;
  switch (status) {
    case "applying":
      return "Being applied.";
    case "applied":
      return `Applied: version ${before} → ${after}.`;
    case "failed":
      return `Failed, and the wiki is back at version ${before}: ${error}`;
    case "rejected":
      return typeof reason === "string" && reason ? `Rejected: ${reason}` : "Rejected, with no reason given.";
    default:
      return "Waits for approval. A person applies it with Wiki: approve this change, or refuses it with Wiki: reject this change.";
  }
}

const HEADING = /^ {0,3}##(?:[ \t].*)?$/;
const WRITE_HEADING = /^### (create|modify|remove) · (.+)$/;
const HASH_LINE = /^<!-- hash: ([0-9a-f]{64}) -->$/;
const FENCE = /^(`{3,})markdown$/;

/** The body with its status line, the first paragraph after the title, replaced. */
export function withStatus(body: string, text: string): string {
  const lines = body.split("\n");
  const title = lines.findIndex((line) => line.startsWith("# "));
  const next = lines.findIndex((line, i) => i > title && HEADING.test(line));
  const end = next === -1 ? lines.length : next;
  return [...lines.slice(0, title + 1), "", text, "", ...lines.slice(end)].join("\n");
}

/** The change document, as a record a person reads: the status, the summary, the notes, and every write in full. */
export function changeDocument(vault: Vault, path: string, plan: ChangePlan, writes: ProposedWrite[], properties: Properties): Document {
  const name = (p: string) => p.slice(p.lastIndexOf("/") + 1, -3);
  const summary = writes.map((write) => {
    const target = write.op === "remove" ? name(write.path) : link(write.path);
    return `- **${write.op}** ${target}${write.why ? ` · ${write.why.slice(0, 160)}` : ""}`;
  });
  const sections = writes.flatMap((write) => {
    const head = [`### ${write.op} · ${write.path}`, "", ...(write.why ? [write.why, ""] : []), ...(write.hash ? [`<!-- hash: ${write.hash} -->`, ""] : [])];
    if (write.op === "remove") return head;
    const text = serializeDocument(vault, { path: write.path, properties: write.properties ?? {}, body: cleanBody(write.body) }).replace(/\n*$/, "");
    // A fence longer than any run of backticks in the note, so the note's own code blocks stay inside it.
    const fence = "`".repeat(Math.max(5, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)));
    return [...head, `${fence}markdown`, text, fence, ""];
  });
  const all = { type: "change", module: "wiki", title: plan.title, ...properties, created: timestamp() };
  const body = [
    `# ${plan.title}`,
    "",
    statusText(all),
    "",
    "## Summary",
    "",
    ...summary,
    "",
    ...(plan.notes?.trim() ? ["## Notes", "", plan.notes.trim(), ""] : []),
    "## Writes",
    "",
    ...sections,
  ].join("\n");
  return { path, properties: all, body };
}

/** Why a change document cannot be read back. */
function unreadable(path: string, reason: string): Error {
  return new Error(`The change document ${basename(path)} does not parse: ${reason}. Its Writes section is what an approval applies, so a hand edit must keep its form; restore it, or reject the change.`);
}

/** The writes of a change document's Writes section, as `changeDocument` wrote them. */
function parseWrites(vault: Vault, path: string, body: string): ProposedWrite[] {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => line.trimEnd() === "## Writes");
  if (start === -1) throw unreadable(path, "it has no Writes section");
  /** One write as its lines come: the prose lines, the hash, and the note's text once its block closes. */
  interface Part {
    op: Write["op"];
    path: string;
    prose: string[];
    hash?: string;
    text?: string;
  }
  const parts: Part[] = [];
  let part: Part | undefined;
  let fence: string | undefined;
  let fenced: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (fence) {
      if (line === fence) {
        part!.text = fenced.join("\n");
        fence = undefined;
      } else fenced.push(line);
      continue;
    }
    if (HEADING.test(line)) break;
    const heading = WRITE_HEADING.exec(line);
    if (heading) {
      const target = heading[2]!.trim();
      if (!inKnowledge(target)) throw unreadable(path, `${heading[1]} ${target} is not a note under ${TOPICS}/ or ${SOURCES}/`);
      part = { op: heading[1] as Write["op"], path: target, prose: [] };
      parts.push(part);
      continue;
    }
    if (!part) {
      if (line.trim()) throw unreadable(path, `"${line.trim().slice(0, 40)}" stands before the first write`);
      continue;
    }
    const opened = FENCE.exec(line);
    if (opened) {
      if (part.text !== undefined) throw unreadable(path, `${part.op} ${part.path} has two markdown blocks`);
      fence = opened[1]!;
      fenced = [];
      continue;
    }
    const hash = HASH_LINE.exec(line);
    if (hash) part.hash = hash[1]!;
    else part.prose.push(line);
  }
  if (fence) throw unreadable(path, `${part!.op} ${part!.path} has a markdown block with no end`);
  if (!parts.length) throw unreadable(path, "its Writes section holds no write");
  return parts.map(({ op, path: target, prose, hash, text }) => {
    const why = prose.join("\n").trim();
    const write: ProposedWrite = { op, path: target, ...(why && { why }), ...(hash && { hash }) };
    if (op !== "create" && !hash) throw unreadable(path, `${op} ${target} has no hash line`);
    if (op !== "remove") {
      if (text === undefined) throw unreadable(path, `${op} ${target} has no markdown block`);
      let doc: Document;
      try {
        doc = parseDocument(vault, target, `${text}\n`);
      } catch (error) {
        throw unreadable(path, `the note of ${op} ${target}: ${error instanceof PropertiesError ? error.reason : String(error)}`);
      }
      write.properties = doc.properties;
      write.body = doc.body;
    }
    return write;
  });
}

/** Reads a change document back as the plan it records. It throws for a document that is no change, or whose writes do not parse. */
export async function readProposal(vault: Vault, path: string): Promise<Proposal> {
  if (!(await vault.exists(path))) throw new Error(`There is no change document at ${path}.`);
  let doc: Document;
  try {
    doc = await readDocument(vault, path);
  } catch (error) {
    throw unreadable(path, error instanceof Error ? error.message : String(error));
  }
  if (doc.properties.type !== "change") throw new Error(`${path} is not a change document.`);
  const session = typeof doc.properties.session === "string" ? `${linkTarget(doc.properties.session)}.md` : undefined;
  const notes = sectionText(doc.body, "Notes");
  return {
    path,
    title: String(doc.properties.title ?? basename(path)),
    ...(notes && { notes }),
    ...(session && { session }),
    properties: doc.properties,
    writes: parseWrites(vault, path, doc.body),
  };
}

/** Records a change in the session document that proposed it. */
export async function linkChange(vault: Vault, session: string, path: string): Promise<void> {
  await updateDocument(vault, session, (doc) => {
    const list = Array.isArray(doc.properties.changes) ? (doc.properties.changes as unknown[]) : [];
    doc.properties.changes = [...list, link(path)];
  });
}

/** Sets the properties of a change document and its status line in one write. */
export async function setStatus(vault: Vault, path: string, properties: Properties): Promise<void> {
  await updateDocument(vault, path, (doc) => {
    Object.assign(doc.properties, properties);
    doc.body = withStatus(doc.body, statusText(doc.properties));
  });
}

const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);
const number = (value: unknown) => (typeof value === "number" ? value : undefined);

/** A change document at a glance. The session's module comes from the session document, when it exists. */
async function summarize(vault: Vault, doc: Document): Promise<ChangeSummary> {
  const { properties } = doc;
  const session = text(properties.session) && `${linkTarget(properties.session as string)}.md`;
  let module: string | undefined;
  if (session && (await vault.exists(session))) {
    try {
      module = text((await readDocument(vault, session)).properties.module);
    } catch {
      module = undefined;
    }
  }
  const notes = sectionText(doc.body, "Notes");
  return {
    path: doc.path,
    title: String(properties.title ?? basename(doc.path)),
    status: (text(properties.status) ?? "proposed") as ChangeStatus,
    created: text(properties.created) ?? "",
    ...(text(properties.applied) && { applied: text(properties.applied) }),
    ...(text(properties.rejected) && { rejected: text(properties.rejected) }),
    ...(session && { session }),
    ...(module && { module }),
    ...(number(properties.before) !== undefined && { before: number(properties.before) }),
    ...(number(properties.after) !== undefined && { after: number(properties.after) }),
    creates: number(properties.creates) ?? 0,
    modifies: number(properties.modifies) ?? 0,
    removes: number(properties.removes) ?? 0,
    ...(notes && { notes }),
    ...(text(properties.reason) && { reason: text(properties.reason) }),
    ...(text(properties.error) && { error: text(properties.error) }),
  };
}

/** The changes with a status, newest first. A change document whose properties do not parse is left out until they do. */
export async function listChanges(vault: Vault, status: ChangeStatus | "all"): Promise<ChangeSummary[]> {
  const out: ChangeSummary[] = [];
  for (const path of await vault.list(CHANGES)) {
    if (!path.endsWith(".md")) continue;
    let doc: Document;
    try {
      doc = await readDocument(vault, path);
    } catch {
      continue;
    }
    if (doc.properties.type !== "change") continue;
    const summary = await summarize(vault, doc);
    if (status === "all" || summary.status === status) out.push(summary);
  }
  return out.sort((a, b) => (a.created > b.created ? -1 : a.created < b.created ? 1 : a.path < b.path ? 1 : -1));
}

/** One change with its writes and the texts of a diff. It throws as `readProposal` does. */
export async function changeDetails(vault: Vault, path: string): Promise<ChangeDetails> {
  const proposal = await readProposal(vault, path);
  const summary = await summarize(vault, { path, properties: proposal.properties, body: await vault.read(path) });
  // An applied change compares with the version before it; any other with the vault now.
  let archive: Record<string, string> | undefined;
  if (summary.status === "applied" && summary.before !== undefined) {
    const version = (await versions(vault)).find((v) => v.version === summary.before);
    if (version) archive = (await readArchive(vault, version)).notes;
  }
  const writes: ChangeWrite[] = [];
  for (const write of proposal.writes) {
    const out: ChangeWrite = { op: write.op, path: write.path, ...(write.why && { why: write.why }) };
    if (write.op !== "remove") out.after = serializeDocument(vault, { path: write.path, properties: write.properties ?? {}, body: cleanBody(write.body) });
    if (write.op !== "create") {
      const before = archive ? archive[write.path] : (await vault.exists(write.path)) ? await vault.read(write.path) : undefined;
      if (before !== undefined) out.before = before;
      out.changed = before === undefined || (await textHash(before)) !== write.hash;
    }
    writes.push(out);
  }
  return { ...summary, writes };
}
