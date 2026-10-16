import type { Vault } from "yami";
import { basename, linkTarget, linksOf, readDocument, sectionText, timestamp, writeDocument, type Document } from "yami/document";
import { hash, tokens } from "yami/wiki";

export const THREADS = "threads";
export const DEFAULT_BUDGET = 3;
export const OUTCOMES = ["fixed", "spec", "stub", "declined", "knowledge"] as const;
/** The outcomes that need no more work in this thread: the ones a passing round's findings and older problems take. */
export const ELSEWHERE = ["stub", "declined", "knowledge"];
const PRIORITIES = ["high", "normal", "low"];

export type Phase = "stub" | "specified" | "planned" | "in progress" | "unvalidated" | "failed" | "validated" | "closed" | "dropped";

/** The sections of a thread, in the order the document holds them. Other sections keep their place after these. */
const ORDER = ["Deliverables", "Progress", "Idea", "Context", "Goal", "Requirements", "Rules", "Decisions", "Out of scope", "Knowledge", "Open questions", "Plan", "Validation", "Outcome"];

export interface Requirement {
  id: string;
  text: string;
}

export interface Task {
  id: string;
  text: string;
  serves: string[];
  state: "open" | "done" | "dropped";
  /** `repository@commit` or a note when done; the reason when dropped. */
  trail: string;
  details: string;
}

export interface Finding {
  id: string;
  text: string;
  blocking: boolean;
  /** `repository@commit` where the problem shows before the thread's work. */
  predates?: string;
}

export interface Outcome {
  outcome: (typeof OUTCOMES)[number];
  note: string;
}

/**
 * What code keeps of a round, in the round's hidden comment. Rounds are append-only: the outcomes of a
 * round's findings go into the next round, or into the outcome at the close, never back into the round.
 */
export interface Round {
  n: number;
  verdict: "pass" | "fail";
  /** The fingerprints of the spec and the plan that the round checked. */
  spec: string;
  plan: string;
  /** The hash of each requirement's text when the round checked it. */
  checked: Record<string, string>;
  results: Record<string, "pass" | "fail">;
  findings: Finding[];
  /** The outcome of each finding of the round before. */
  resolved?: Record<string, Outcome>;
}

export interface Thread {
  path: string;
  title: string;
  doc: Document;
  requirements: Requirement[];
  plan: Task[];
  rounds: Round[];
  outcome?: "closed" | "dropped";
  /** What is wrong with the document, each with its fix. */
  problems: string[];
}

export interface Next {
  step: "spec" | "plan" | "wait" | "execute" | "validate" | "resolve" | "ask" | "close" | "none";
  text: string;
}

const REQUIREMENT = /^- \*\*(R\d+)\*\* (.+)$/;
const TASK = /^- \[([ x-])\] \*\*(T\d+)\*\* (.+)$/;
/** A detail line of a task: indented by two spaces or more, or a tab, as Obsidian indents a list. */
const DETAIL = /^(?: {2}|\t)(.*)$/;
/** A round's data: one whole line, so a quote of it in a finding or the evidence never reads as a round. */
const ROUND = /^<!-- threads-round (\{.*\}) -->$/gm;
const SEP = " · ";

// Reading

export function parse(doc: Document): Thread {
  const t: Thread = { path: doc.path, title: basename(doc.path), doc, requirements: [], plan: [], rounds: [], problems: [] };
  const unread = (heading: string, line: string) => t.problems.push(`## ${heading} holds a line the tools cannot read: "${line.trim().slice(0, 80)}". Fix it in Obsidian, or ask the user.`);
  for (const line of sectionText(doc.body, "Requirements").split("\n")) {
    if (!line.trim()) continue;
    const m = line.match(REQUIREMENT);
    if (m) t.requirements.push({ id: m[1]!, text: m[2]! });
    else unread("Requirements", line);
  }
  const lines = sectionText(doc.body, "Plan").split("\n");
  lines.forEach((line, i) => {
    const m = line.match(TASK);
    const task = t.plan.at(-1);
    if (m) {
      const [text, serves, ...rest] = m[3]!.split(SEP);
      const trail = rest.join(SEP);
      const state = trail.startsWith("done: ") ? "done" : trail.startsWith("dropped: ") ? "dropped" : "open";
      const added: Task = { id: m[2]!, text: text!, serves: (serves ?? "").replace(/^serves /, "").split(/,\s*/).filter(Boolean), state, trail: trail.replace(/^(done|dropped): /, ""), details: "" };
      // The trail decides the state; a box clicked in Obsidian does not.
      if ({ open: " ", done: "x", dropped: "-" }[state] !== m[1]) t.problems.push(`${added.id}'s box says "${m[1]}", and its trail says ${state}; the trail counts. Use threads_plan to change a task.`);
      t.plan.push(added);
    } else if (task && DETAIL.test(line)) {
      const detail = line.match(DETAIL)![1]!;
      task.details = task.details ? `${task.details}\n${detail}` : detail;
    } else if (!line.trim()) {
      // A blank line between two detail lines of one task belongs to the details.
      if (task?.details && DETAIL.test(lines.slice(i + 1).find((l) => l.trim()) ?? "")) task.details += "\n";
    } else {
      unread("Plan", line);
    }
  });
  for (const m of sectionText(doc.body, "Validation").matchAll(ROUND)) {
    try {
      t.rounds.push(JSON.parse(m[1]!) as Round);
    } catch {
      t.problems.push("The data of a round in ## Validation is not valid; restore it from the vault's history.");
    }
  }
  const outcome = sectionText(doc.body, "Outcome");
  t.outcome = outcome.startsWith("Closed") ? "closed" : outcome.startsWith("Dropped") ? "dropped" : undefined;
  return t;
}

export function budget(t: Thread): number {
  const n = Number(t.doc.properties.budget);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_BUDGET;
}

/** The fingerprint of a spec: its requirements and its rules. */
export function specHash(t: Thread, requirements = t.requirements, rules = sectionText(t.doc.body, "Rules")): string {
  return hash(`${requirements.map((r) => `${r.id} ${r.text}`).join("\n")}\n${rules}`);
}

/** The fingerprint of a plan: its tasks that are not dropped. */
export function planHash(plan: Task[]): string {
  return hash(plan.filter((task) => task.state !== "dropped").map((task) => `${task.id} ${task.text} ${task.serves.join(",")}`).join("\n"));
}

export const lastRound = (t: Thread) => t.rounds.at(-1);
const current = (t: Thread, r = lastRound(t)) => r !== undefined && r.spec === specHash(t) && r.plan === planHash(t.plan);
/** The findings that wait for an outcome: those of the last round, until the next round or the close gives them one. */
export const openFindings = (t: Thread) => (t.outcome ? [] : (lastRound(t)?.findings ?? []));

export function phase(t: Thread): Phase {
  if (t.outcome) return t.outcome;
  if (!t.requirements.length) return "stub";
  if (!t.plan.length) return "specified";
  if (t.plan.some((task) => task.state === "open")) return t.plan.some((task) => task.state === "done") ? "in progress" : "planned";
  const r = lastRound(t);
  if (r && current(t, r)) return r.verdict === "pass" ? "validated" : "failed";
  return "unvalidated";
}

export function next(t: Thread): Next {
  const p = phase(t);
  const r = lastRound(t);
  if ((p === "unvalidated" || p === "failed") && t.rounds.length >= budget(t)) {
    return { step: "ask", text: `ask the user: the thread used its ${budget(t)} rounds, and round ${r!.n} ${r!.verdict === "pass" ? "passed before the spec or the plan changed" : "failed"}` };
  }
  switch (p) {
    case "stub":
      return { step: "spec", text: "write the spec" };
    case "specified":
      return { step: "plan", text: "review the spec, then write the plan" };
    case "planned":
    case "in progress":
      return { step: "execute", text: `do ${t.plan.filter((task) => task.state === "open").map((task) => task.id).join(", ")}` };
    case "unvalidated":
      return { step: "validate", text: openFindings(t).length ? `validate again, with the outcomes of the findings of round ${r!.n}` : "validate the work against the spec" };
    case "failed":
      return { step: "resolve", text: `resolve the findings of round ${r!.n}, then validate again` };
    case "validated":
      return { step: "close", text: "close the thread" };
    default:
      return { step: "none", text: `nothing: the thread is ${p}` };
  }
}

/** The threads in `after` that are not validated, closed, or dropped yet. A planned thread waits for them. */
export async function waiting(vault: Vault, t: Thread, threads?: Thread[]): Promise<string[]> {
  const targets = linksOf(t.doc.properties.after).map((target) => target.replace(/\.md$/, "").toLowerCase());
  if (!targets.length) return [];
  threads ??= await all(vault);
  return targets
    .map((target) => threads.find((o) => o.path.slice(0, -3).toLowerCase() === target || o.title.toLowerCase() === target))
    .filter((o): o is Thread => o !== undefined && !["validated", "closed", "dropped"].includes(phase(o)))
    .map((o) => o.title);
}

/** What a tool returns: the thread's state and its next step. */
export async function view(vault: Vault, t: Thread) {
  const r = lastRound(t);
  const count = (state: Task["state"]) => t.plan.filter((task) => task.state === state).length;
  const p = phase(t);
  const before = p === "planned" || p === "in progress" ? await waiting(vault, t) : [];
  return {
    title: t.title,
    path: t.path,
    phase: p,
    next: before.length ? { step: "wait" as const, text: `wait for ${before.join(", ")} to be validated` } : next(t),
    requirements: t.requirements.length,
    tasks: { done: count("done"), open: count("open"), dropped: count("dropped") },
    rounds: t.rounds.length,
    budget: budget(t),
    ...(r && {
      last_round: {
        n: r.n,
        verdict: r.verdict,
        current: current(t, r),
        failing: Object.entries(r.results).filter(([, v]) => v === "fail").map(([id]) => id),
        open_findings: openFindings(t),
      },
    }),
    ...(t.problems.length && { problems: t.problems }),
  };
}

// The board: every thread of the vault

/** Every thread: each session document of the threads module directly in `threads/`. */
export async function all(vault: Vault): Promise<Thread[]> {
  const out: Thread[] = [];
  for (const path of await vault.list(THREADS)) {
    if (path.slice(THREADS.length + 1).includes("/")) continue;
    const doc = await readDocument(vault, path);
    if (doc.properties.type === "session" && doc.properties.module === "threads") out.push(parse(doc));
  }
  return out;
}

/** The thread a reference names: its title, a link to it, or its path. A path in another folder names no thread. */
export async function find(vault: Vault, ref: string): Promise<Thread> {
  const target = linkTarget(ref).replace(/\.md$/, "").toLowerCase();
  const found = (await all(vault)).find((t) => (target.includes("/") ? t.path.slice(0, -3).toLowerCase() === target : t.title.toLowerCase() === target));
  if (!found) throw new Error(`No thread is named "${ref}". threads_status with no thread lists them.`);
  return found;
}

const RANK: Record<string, number> = { failed: 0, "in progress": 1, unvalidated: 2, validated: 3, planned: 4, specified: 5, stub: 6 };

/** The open threads, the most urgent first: by phase, then priority. A thread that waits comes after those that can go on. */
export async function board(vault: Vault) {
  const threads = await all(vault);
  const out: { title: string; path: string; phase: Phase; next: Next; priority: string; description: string }[] = [];
  for (const t of threads.filter((x) => !x.outcome)) {
    const p = phase(t);
    const priority = PRIORITIES.includes(String(t.doc.properties.priority)) ? String(t.doc.properties.priority) : "normal";
    const before = p === "planned" || p === "in progress" ? await waiting(vault, t, threads) : [];
    const step = before.length ? { step: "wait" as const, text: `wait for ${before.join(", ")} to be validated` } : next(t);
    out.push({ title: t.title, path: t.path, phase: p, next: step, priority, description: String(t.doc.properties.description ?? "") });
  }
  const rank = (x: (typeof out)[number]) => (x.next.step === "wait" ? RANK.stub! + 1 : RANK[x.phase]!);
  return out.sort((a, b) => rank(a) - rank(b) || PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) || (a.title < b.title ? -1 : 1));
}

/** Open threads whose title and description share most of their words with a new one. */
export async function similar(vault: Vault, title: string, description: string) {
  const words = new Set(tokens(`${title} ${description}`));
  return (await board(vault)).filter((other) => {
    const theirs = new Set(tokens(`${other.title} ${other.description}`));
    const shared = [...words].filter((word) => theirs.has(word)).length;
    return other.title !== title && shared >= 2 && shared >= Math.min(words.size, theirs.size) / 2;
  });
}

// Writing

/** Thread writes run one at a time, so two writers never lose each other's change. */
let queue: Promise<unknown> = Promise.resolve();

export function serial<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.catch(() => undefined);
  return run;
}

/** Writes the thread's document with its sections in order, and its derived phase as a copy for the ledger. */
export async function save(vault: Vault, t: Thread, sections: Record<string, string | undefined>): Promise<Thread> {
  t.doc.body = assemble(t.doc.body, sections);
  const saved = parse(t.doc);
  saved.doc.properties.phase = phase(saved);
  saved.doc.properties.updated = timestamp();
  await writeDocument(vault, saved.doc);
  return saved;
}

/** A body with each given section set, or removed when its text is empty, and every section in thread order. */
export function assemble(body: string, sections: Record<string, string | undefined>): string {
  const [head, ...rest] = body.split(/^## /m);
  const parts = new Map<string, string>();
  for (const part of rest) {
    const end = part.indexOf("\n");
    parts.set((end === -1 ? part : part.slice(0, end)).trim(), end === -1 ? "" : part.slice(end + 1).trim());
  }
  for (const [heading, text] of Object.entries(sections)) {
    if (text === undefined) continue;
    if (text.trim()) parts.set(heading, text.trim());
    else parts.delete(heading);
  }
  const rank = (heading: string) => (ORDER.includes(heading) ? ORDER.indexOf(heading) : ORDER.length);
  const headings = [...parts.keys()].sort((a, b) => rank(a) - rank(b));
  return `${head!.trimEnd()}\n\n${headings.map((h) => `## ${h}\n\n${parts.get(h)}`.trimEnd()).join("\n\n")}\n`;
}

/** Refuses a write that would rewrite a section holding lines the tools cannot read, so it never loses the user's text. */
export function readable(t: Thread, heading: string): void {
  const problem = t.problems.find((p) => p.startsWith(`## ${heading} `));
  if (problem) throw new Error(problem);
}

export function oneLine(what: string, text: string | undefined): string {
  const out = (text ?? "").trim();
  if (!out) throw new Error(`${what} is empty.`);
  if (out.includes("\n")) throw new Error(`${what} is more than one line.`);
  return out;
}

/** Refuses a heading as deep as `deepest` or above, with up to three spaces before it: `##` ends a section of the thread, and `###` a round. */
export function noHeadings(what: string, text: string, deepest = 2): string {
  if (new RegExp(`^ {0,3}#{1,${deepest}} `, "m").test(text)) throw new Error(`${what} holds a heading line, which would break the thread's sections. Write it as plain text.`);
  return text.trim();
}

/** A list of items as a markdown list; an item's later lines are indented under it. */
export function bullets(what: string, items: string[] | undefined): string {
  return (items ?? [])
    .map((item) => noHeadings(what, item))
    .filter(Boolean)
    .map((item) => `- ${item.replace(/\n/g, "\n  ")}`)
    .join("\n");
}

/** The decision line that keeps the user's words with what they asked for. */
export function decision(what: string, userAsked: string): string {
  return `The user asked (${timestamp().slice(0, 10)}): "${oneLine("user_asked", userAsked)}". ${what.charAt(0).toUpperCase()}${what.slice(1)}.`;
}

/**
 * After a pass, more work is the user's call: refuses it without their words, and returns the decision
 * that keeps them. A thread that used its budget gets the one round that validates the work they asked for.
 */
export function afterPass(t: Thread, what: string, userAsked: string | undefined): string | undefined {
  if (phase(t) !== "validated") return undefined;
  if (!userAsked?.trim()) throw new Error(`${t.title} passed round ${lastRound(t)!.n}: ${what} now would make that round stale. Close the thread; or, when the user asks for it, give their words in user_asked.`);
  if (t.rounds.length < budget(t)) return decision(what, userAsked);
  t.doc.properties.budget = t.rounds.length + 1;
  return `${decision(what, userAsked)} One more round: the budget is ${t.rounds.length + 1}.`;
}

export function renderPlan(plan: Task[]): string {
  return plan
    .map((task) => {
      const box = { open: " ", done: "x", dropped: "-" }[task.state];
      const trail = task.state === "open" ? "" : `${SEP}${task.state}: ${task.trail}`;
      const details = task.details ? `\n${task.details.split("\n").map((line) => (line ? `  ${line}` : "")).join("\n")}` : "";
      return `- [${box}] **${task.id}** ${task.text}${SEP}serves ${task.serves.join(", ")}${trail}${details}`;
    })
    .join("\n");
}

/** Text that a person or an agent wrote, made safe to show in a round: no line of it can read as a round's data. */
const shown = (text: string) => text.replace(/<!--/g, "&lt;!--");

/** The round's markdown for people, and its data for code in one hidden comment on the last line. */
export function renderRound(r: Round, scope: string, evidence: Record<string, string>, notes: string): string {
  const cell = (text: string) => shown(text).replace(/\|/g, "\\|").replace(/\n+/g, " ");
  return [
    `### Round ${r.n}`,
    "",
    `${timestamp().slice(0, 16).replace("T", " ")} · **${r.verdict}**`,
    "",
    `Scope: ${shown(scope)}`,
    ...(r.resolved ? ["", `Outcomes of round ${r.n - 1}:`, "", ...Object.entries(r.resolved).map(([id, o]) => `- **${id}** → ${o.outcome}: ${shown(o.note)}`)] : []),
    "",
    "| Requirement | Result | Evidence |",
    "|---|---|---|",
    ...Object.entries(r.results).map(([id, result]) => `| ${id} | ${result} | ${cell(evidence[id] ?? "")} |`),
    "",
    "Findings:",
    "",
    r.findings.length ? r.findings.map((f) => `- **${f.id}**${f.blocking ? " (blocking)" : ""}${f.predates ? ` (predates ${shown(f.predates)})` : ""} ${shown(f.text)}`).join("\n") : "None.",
    ...(notes ? ["", `Notes: ${shown(notes)}`] : []),
    "",
    roundData(r),
  ].join("\n");
}

/** The comment that holds a round's data, on one line. `<`, `>`, and the Unicode line separators are escaped, so no text inside can end it or break the line. */
export function roundData(r: Round): string {
  return `<!-- threads-round ${JSON.stringify(r).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029")} -->`;
}

/** The next id of a kind: `R` or `T`, and one more than the largest number used. */
export function nextId(prefix: string, used: string[]): string {
  return `${prefix}${Math.max(0, ...used.map((id) => Number(id.slice(1)) || 0)) + 1}`;
}
