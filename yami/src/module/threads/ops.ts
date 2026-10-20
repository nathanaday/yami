import { z } from "../../agent/index.js";
import { link, readDocument, sectionText } from "../../document/document.js";
import { timestamp } from "../../document/schema.js";
import { hash } from "../../wiki/tokens.js";
import type { Flow } from "../module.js";
import {
  afterPass,
  budget,
  bullets,
  decision,
  ELSEWHERE,
  find,
  lastRound,
  nextId,
  noHeadings,
  oneLine,
  openFindings,
  OUTCOMES,
  parseThread,
  threadPhase,
  planHash,
  readable,
  renderPlan,
  renderRound,
  save,
  serial,
  similar,
  specHash,
  view,
  type Finding,
  type FindingOutcome,
  type Requirement,
  type Round,
  type Task,
  type Thread,
  type ThreadStatus,
  type Where,
} from "./thread.js";

/** The input of each threads tool is declared once: the tool's schema, and the type of its SDK function. */
type In<S extends z.ZodRawShape> = z.infer<z.ZodObject<S>>;

const ref = z.string().describe("The thread: its title, a [[link]] to it, or its path.");
const userAsked = z.string().optional().describe("The user's words, as given, when they asked for this change.");
const resolved = z
  .array(
    z.object({
      finding: z.string().describe("The finding's id, such as F2."),
      outcome: z.enum(OUTCOMES).describe("fixed (note: the tasks), spec (note: what changed), stub (note: a link to the stub), declined (note: why), or knowledge (note: what the wiki should learn)."),
      note: z.string().describe("One line."),
      user_asked: z.string().optional().describe("The user's words, when they asked to fix a finding that predates the thread here."),
    }),
  )
  .optional()
  .describe("The outcome of each finding of the last round.");

export const stubShape = {
  threads: z
    .array(
      z.object({
        title: z.string().describe("A short name for the work: the file name."),
        idea: z.string().describe("The user's words, as given."),
        description: z.string().describe("One line: what the work is, and where it lands."),
        context: z.string().optional().describe("What the research found, in short markdown."),
        repositories: z.array(z.string()).optional().describe("The folders of the repositories the work changes."),
        tags: z.array(z.string()).optional(),
        after: z.array(z.string()).optional().describe("Threads that must be validated or ended first."),
        priority: z.enum(["high", "normal", "low"]).optional(),
      }),
    )
    .min(1),
};

export const specShape = {
  thread: ref,
  goal: z.string().describe("One paragraph: what the work is for."),
  requirements: z.array(z.object({ id: z.string().optional(), text: z.string().describe("One line, with the check that shows it and its cases.") })).min(1),
  retire: z.array(z.object({ id: z.string(), reason: z.string() })).optional(),
  rules: z.array(z.string()).optional(),
  decisions: z.array(z.string()).optional(),
  out_of_scope: z.array(z.string()).optional(),
  knowledge: z.array(z.string()).optional(),
  open_questions: z.array(z.string()).optional(),
  budget: z.number().int().min(1).optional().describe("The rounds the thread may take. The user's to change: only with user_asked."),
  user_asked: userAsked,
};

export const planShape = {
  thread: ref,
  add: z.array(z.object({ text: z.string().describe("One line: the step and its result."), serves: z.array(z.string()).min(1), details: z.string().optional() })).optional(),
  done: z.array(z.object({ id: z.string(), trail: z.string().describe("repository@commit, or a note.") })).optional(),
  drop: z.array(z.object({ id: z.string(), reason: z.string() })).optional(),
  user_asked: userAsked,
};

export const roundShape = {
  thread: ref,
  scope: z.string().describe("heads: each repository@commit checked, then the commits checked and how."),
  results: z.array(z.object({ requirement: z.string(), result: z.enum(["pass", "fail"]), evidence: z.string(), carried: z.boolean().optional() })).min(1),
  findings: z.array(z.object({ text: z.string(), blocking: z.boolean().optional(), predates: z.string().optional().describe("repository@commit where the problem shows before the thread's work.") })).optional(),
  notes: z.string().optional().describe("What limits the round: what could not run, and why."),
  resolved,
};

export const closeShape = {
  thread: ref,
  outcome: z.enum(["closed", "dropped"]),
  summary: z.string().describe("closed: what is true now, in one or two sentences. dropped: why the work stops."),
  delete: z.boolean().optional().describe("dropped only: remove a stub planted by mistake, which has no spec. It goes to the trash."),
  resolved,
};

/** Plants a thread: its session document, with the idea in the user's words and the research's context. */
export async function stub(where: Where, flow: Flow, input: In<typeof stubShape>["threads"][number]) {
  const vault = where.vault;
  const idea = noHeadings("idea", input.idea);
  if (!idea) throw new Error("idea is empty: give the user's words.");
  const description = oneLine("description", input.description);
  const context = noHeadings("context", input.context ?? "");
  const after = [];
  for (const other of input.after ?? []) after.push(link((await find(where, other)).path));
  const similarTo = await similar(where, input.title, description);
  const { path } = await flow.create({
    name: input.title,
    exact: true,
    request: idea,
    fields: { description, repositories: input.repositories ?? [], tags: input.tags ?? [], after, ...(input.priority && { priority: input.priority }) },
  });
  const t = await save(vault, parseThread(await readDocument(vault, path)), { Context: context });
  return { ...(await view(where, t)), ...(similarTo.length && { similar: similarTo.map(({ title, path, phase }) => ({ title, path, phase })) }) };
}

/** Writes the spec of a thread, or its new text. The plan stays. */
export function spec(where: Where, input: In<typeof specShape>): Promise<ThreadStatus> {
  return withThread(where, input.thread, async (t, vault) => {
    readable(t, "Requirements");
    // The budget as the agent read it: one more round that the user's words give below is not undone by sending it back.
    const before = budget(t);
    const goal = noHeadings("goal", input.goal);
    if (!goal) throw new Error("goal is empty.");
    const old = new Map(t.requirements.map((r) => [r.id, r]));
    const retired = Array.isArray(t.doc.properties.retired) ? t.doc.properties.retired.map(String) : [];
    const retire = new Map<string, string>();
    for (const r of input.retire ?? []) {
      const id = r.id.trim().toUpperCase();
      if (!old.has(id)) throw new Error(`retire names ${id}, which the spec does not hold.`);
      retire.set(id, oneLine(`the reason to retire ${id}`, r.reason));
    }
    const requirements: Requirement[] = [];
    for (const r of input.requirements) {
      let id = r.id?.trim().toUpperCase();
      if (id && !old.has(id)) throw new Error(`${id} is not a requirement of the spec; give a new requirement with no id.`);
      if (id && retire.has(id)) throw new Error(`${id} is both kept and retired.`);
      if (id && requirements.some((other) => other.id === id)) throw new Error(`The requirements hold ${id} twice.`);
      // A new requirement takes a number that no requirement had, retired ones included.
      id ??= nextId("R", [...old.keys(), ...retired, ...requirements.map((x) => x.id)]);
      requirements.push({ id, text: oneLine("a requirement", r.text) });
    }
    const missing = [...old.keys()].filter((id) => !retire.has(id) && !requirements.some((r) => r.id === id));
    if (missing.length) throw new Error(`The requirements leave out ${missing.join(", ")}: give each again with its id, or retire it with a reason.`);
    const rules = bullets("rules", input.rules);
    const asked: string[] = [];
    if (t.requirements.length && specHash(t, requirements, rules) !== specHash(t)) {
      const line = afterPass(t, "the requirements or the rules changed", input.user_asked);
      if (line) asked.push(line);
    }
    if (input.budget !== undefined && input.budget !== before && input.budget !== budget(t)) {
      if (!input.user_asked?.trim()) throw new Error("The budget is the user's to change: ask them, and give their words in user_asked.");
      t.doc.properties.budget = input.budget;
      asked.push(decision(`a budget of ${input.budget} rounds`, input.user_asked));
    }
    // Decisions that code wrote stay, so the record of a retirement or of the user's words is never lost.
    const kept = sectionText(t.doc.body, "Decisions").split("\n").filter((line) => /^- (Retired R\d+|The user asked)/.test(line));
    const decisions = [...kept, bullets("decisions", input.decisions), ...[...retire].map(([id, reason]) => `- Retired ${id} (${old.get(id)!.text}): ${reason}`), ...asked.map((line) => `- ${line}`)];
    t.doc.properties.retired = [...retired, ...retire.keys()];
    return save(vault, t, {
      Goal: goal,
      Requirements: requirements.map((r) => `- **${r.id}** ${r.text}`).join("\n"),
      Rules: rules,
      Decisions: [...new Set(decisions.filter(Boolean))].join("\n"),
      "Out of scope": bullets("out_of_scope", input.out_of_scope),
      Knowledge: bullets("knowledge", input.knowledge),
      "Open questions": bullets("open_questions", input.open_questions),
    });
  });
}

/** Adds tasks, and marks tasks done or dropped. A task that needs more work after it is done gets a new task. */
export function plan(where: Where, input: In<typeof planShape>): Promise<ThreadStatus> {
  return withThread(where, input.thread, async (t, vault) => {
    if (!t.requirements.length) throw new Error(`${t.title} has no spec yet; write it with threads_spec first.`);
    if (!input.add?.length && !input.done?.length && !input.drop?.length) throw new Error("threads_plan needs add, done, or drop.");
    readable(t, "Plan");
    const asked = afterPass(t, "the plan changed", input.user_asked);
    const tasks: Task[] = t.plan.map((task) => ({ ...task }));
    const get = (id: string) => {
      const task = tasks.find((x) => x.id === id.trim().toUpperCase());
      if (!task) throw new Error(`The plan holds no ${id}.`);
      return task;
    };
    const known = new Set(t.requirements.map((r) => r.id));
    for (const a of input.add ?? []) {
      const text = oneLine("a task", a.text);
      if (text.includes(" · ")) throw new Error(`The task "${text}" holds " · ", which separates a task from its trail.`);
      const serves = [...new Set(a.serves.map((r) => r.trim().toUpperCase()))];
      for (const r of serves) if (!known.has(r)) throw new Error(`The task "${text}" serves ${r}, which the spec does not hold.`);
      tasks.push({ id: nextId("T", tasks.map((x) => x.id)), text, serves, state: "open", trail: "", details: noHeadings("details", a.details ?? "") });
    }
    for (const d of input.done ?? []) {
      const task = get(d.id);
      if (task.state === "done") throw new Error(`${task.id} is done already.`);
      Object.assign(task, { state: "done", trail: oneLine(`the trail of ${task.id}`, d.trail) });
    }
    for (const d of input.drop ?? []) {
      const task = get(d.id);
      if (task.state === "dropped") throw new Error(`${task.id} is dropped already.`);
      Object.assign(task, { state: "dropped", trail: oneLine(`the reason to drop ${task.id}`, d.reason) });
    }
    const decisions = asked ? [sectionText(t.doc.body, "Decisions"), `- ${asked}`].filter(Boolean).join("\n") : undefined;
    return save(vault, t, { Plan: renderPlan(tasks), Decisions: decisions });
  });
}

/** Records a validation round, as the validator reported it. It holds the outcomes of the round before. */
export function round(where: Where, input: In<typeof roundShape>): Promise<ThreadStatus> {
  return withThread(where, input.thread, async (t, vault) => {
    if (!t.plan.length) throw new Error(`${t.title} has no plan; a round checks done work.`);
    const open = t.plan.filter((task) => task.state === "open").map((task) => task.id);
    if (open.length) throw new Error(`${open.join(", ")} ${open.length === 1 ? "is" : "are"} open: mark each done or dropped with threads_plan before a round.`);
    if (t.rounds.length >= budget(t)) throw new Error(`${t.title} used its ${budget(t)} rounds: ask the user whether it goes on.`);
    const prev = lastRound(t);
    const outcomes = resolve(t, input.resolved ?? [], false);
    const scope = noHeadings("scope", input.scope, 3);
    if (!scope) throw new Error("scope is empty: name the commit checked in each repository, and how.");
    const got = new Map<string, (typeof input.results)[number]>();
    for (const r of input.results) {
      const id = r.requirement.trim().toUpperCase();
      if (got.has(id)) throw new Error(`The results hold ${id} twice.`);
      got.set(id, r);
    }
    const results: Round["results"] = {};
    const evidence: Record<string, string> = {};
    const checked: Round["checked"] = {};
    for (const req of t.requirements) {
      const r = got.get(req.id);
      if (!r) throw new Error(`The results skip ${req.id}; give one result for each requirement.`);
      got.delete(req.id);
      if (!r.evidence.trim()) throw new Error(`The result of ${req.id} has no evidence.`);
      checked[req.id] = hash(req.text);
      evidence[req.id] = r.evidence.trim();
      if (r.carried) {
        if (r.result !== "pass") throw new Error(`${req.id} is carried and fails; a carried result is a pass from the last round.`);
        if (!prev) throw new Error(`${req.id} is carried, and there is no round before; round 1 checks every requirement.`);
        if (prev.results[req.id] !== "pass") throw new Error(`${req.id} is carried, and it did not pass in round ${prev.n}; check it again.`);
        if (prev.checked[req.id] !== checked[req.id]) throw new Error(`${req.id} is carried, and its text changed since round ${prev.n}; check it again.`);
        evidence[req.id] = `Carried from round ${prev.n}: ${evidence[req.id]}`;
      }
      results[req.id] = r.result;
    }
    if (got.size) throw new Error(`The results hold ${[...got.keys()].join(", ")}, which the spec does not hold.`);
    const findings: Finding[] = (input.findings ?? []).map((f, i) => {
      const id = `F${i + 1}`;
      const predates = f.predates?.trim() ? oneLine(`the predates of ${id}`, f.predates) : undefined;
      if (predates && f.blocking) throw new Error(`${id} predates the thread and blocks it; a problem that shows before the thread's work does not block it. Set blocking false (a stub takes it), or leave predates out when this thread's work must fix it.`);
      return { id, text: oneLine("a finding", f.text), blocking: Boolean(f.blocking), ...(predates && { predates }) };
    });
    const failing = Object.values(results).includes("fail");
    const blocking = findings.some((f) => f.blocking);
    if (failing && !blocking) throw new Error("A requirement fails, and no blocking finding says what is wrong; add one.");
    const r: Round = {
      n: t.rounds.length + 1,
      verdict: failing || blocking ? "fail" : "pass",
      spec: specHash(t),
      plan: planHash(t.plan),
      checked,
      results,
      findings,
      ...(Object.keys(outcomes).length && { resolved: outcomes }),
    };
    const rendered = renderRound(r, scope, evidence, noHeadings("notes", input.notes ?? "", 3));
    return save(vault, t, { Validation: [sectionText(t.doc.body, "Validation"), rendered].filter(Boolean).join("\n\n") });
  });
}

/** Closes a validated thread, or drops a thread. The outcome goes into its document. */
export function close(where: Where, input: In<typeof closeShape>): Promise<ThreadStatus> {
  return withThread(where, input.thread, async (t, vault) => {
    const summary = oneLine("summary", input.summary);
    const date = timestamp().slice(0, 10);
    if (input.outcome === "dropped") {
      if (!input.delete) return save(vault, t, { Outcome: `Dropped ${date}: ${summary}` });
      if (t.requirements.length) throw new Error(`${t.title} has a spec; drop it without delete, so its record stays.`);
      await vault.remove(t.path);
      return { ...t, outcome: "dropped" as const };
    }
    const p = threadPhase(t);
    if (p !== "validated") throw new Error(`${t.title} is ${p}, not validated: ${(await view(where, t)).next.text}.`);
    const r = lastRound(t)!;
    const outcomes = resolve(t, input.resolved ?? [], true);
    const done = t.plan.filter((task) => task.state === "done").length;
    const dropped = t.plan.filter((task) => task.state === "dropped").length;
    const lines = [
      `Closed ${date}. ${summary}`,
      "",
      `- Validated in round ${r.n}: ${Object.keys(r.results).length} requirements pass.`,
      `- Plan: ${done} tasks done${dropped ? `, ${dropped} dropped` : ""}.`,
      ...Object.entries(outcomes).map(([id, o]) => `- ${id} of round ${r.n} → ${o.outcome}: ${o.note}`),
    ];
    return save(vault, t, { Outcome: lines.join("\n") });
  });
}

/** Runs a write on a thread that has not ended, one write at a time, and returns the thread's view after it. */
function withThread(where: Where, ref: string, work: (t: Thread, vault: Where["vault"]) => Promise<Thread>): Promise<ThreadStatus> {
  return serial(async () => {
    const t = await find(where, ref);
    if (t.outcome) throw new Error(`${t.title} is ${t.outcome}; it takes no more changes.`);
    return view(where, await work(t, where.vault));
  });
}

/**
 * The outcomes of the last round's findings: every one needs an outcome, given once. At the close, a
 * finding of the passing round takes stub, declined, or knowledge; so does a predating finding, unless
 * the user asked to fix it here.
 */
function resolve(t: Thread, input: NonNullable<In<typeof roundShape>["resolved"]>, closing: boolean): Record<string, FindingOutcome> {
  const last = lastRound(t);
  if (!last) {
    if (input.length) throw new Error("resolved names findings, and the thread has no round yet.");
    return {};
  }
  const out: Record<string, FindingOutcome> = {};
  for (const res of input) {
    const id = res.finding.trim().toUpperCase();
    const f = openFindings(t).find((x) => x.id === id);
    if (!f) throw new Error(`Round ${last.n} holds no ${id}.`);
    if (out[id]) throw new Error(`resolved gives ${id} twice.`);
    let note = oneLine(`the note of ${id}`, res.note);
    const said = res.user_asked?.trim();
    if (!ELSEWHERE.includes(res.outcome)) {
      if (closing) throw new Error(`${id} is a finding of round ${last.n}, which passed: ${res.outcome} now would need another round. Give it stub, declined, or knowledge; when the user asks for the fix, add its task with threads_plan and user_asked first.`);
      if (f.predates && !said) throw new Error(`${id} predates the thread (it shows at ${f.predates}): plant a stub for it, or decline it with the reason. Record ${res.outcome} only when the user asks to fix it here, with their words in user_asked.`);
    }
    if (said) note += ` (the user asked: "${oneLine("user_asked", said)}")`;
    out[id] = { outcome: res.outcome, note };
  }
  const open = last.findings.filter((f) => !out[f.id]).map((f) => f.id);
  if (open.length) throw new Error(`${open.join(", ")} of round ${last.n} ${open.length === 1 ? "has" : "have"} no outcome: give each one in resolved with ${closing ? "the close" : "the new round"}.`);
  return out;
}
