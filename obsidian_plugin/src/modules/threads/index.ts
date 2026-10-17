import { defineTool, YamiModule, z, type AgentTool, type Check, type LedgerView, type Schema } from "yami";
import { readDocument } from "yami/document";
import reviewerAgent from "./agents/reviewer.md";
import validatorAgent from "./agents/validator.md";
import changePolicy from "./policies/Change a thread through its tools.md";
import closedPromise from "./promises/Thread closed.md";
import runSkill from "./skills/run/SKILL.md";
import reviewerBrief from "./skills/spec/reviewer.md";
import specSkill from "./skills/spec/SKILL.md";
import stubSkill from "./skills/stub/SKILL.md";
import validateSkill from "./skills/validate/SKILL.md";
import { close, closeShape, plan, planShape, round, roundShape, spec, specShape, status, stub, stubShape } from "./ops.js";
import { next, parse, phase, waiting } from "./thread.js";

/**
 * Met when the thread is closed or dropped. For review when the user must decide: the thread used its
 * budget of rounds, or waits for a thread before it. The phase is derived from the document, never read
 * from a property.
 */
const thread: Check = async (_promise, context) => {
  const t = parse(await readDocument(context.vault, context.path));
  const p = phase(t);
  if (p === "closed" || p === "dropped") return { status: "met", detail: `the thread is ${p}` };
  const before = p === "planned" || p === "in progress" ? await waiting(context.vault, t) : [];
  if (before.length) return { status: "review", detail: `the thread waits for ${before.join(", ")}` };
  const step = next(t);
  if (step.step === "ask") return { status: "review", detail: step.text };
  return { status: "unmet", detail: `the thread is ${p}; next: ${step.text}` };
};

/** Validated work on repositories: one session document per thread, from idea to closed. */
export class Threads extends YamiModule {
  readonly id = "threads";
  readonly name = "Threads";
  readonly icon = "spool";
  readonly description =
    "Work on repositories as threads: the idea, a spec with checkable requirements, a plan, validation rounds by a fresh read-only agent, and the outcome, in one document each.";
  readonly schema: Schema = {
    /** One line: what the work is, and where it lands. */
    description: { type: "text" },
    /** The folders of the repositories the work changes. */
    repositories: { type: "list", default: [] },
    /** The threads that come before this one. */
    after: { type: "links", default: [] },
    priority: { type: "text", values: ["high", "normal", "low"] },
    /** The rounds the thread may take before the user decides. */
    budget: { type: "number" },
    /** The requirements the spec retired. */
    retired: { type: "list", default: [] },
    /** A copy of the derived phase, for the ledger. No code trusts it. */
    phase: { type: "text" },
    tags: { type: "list", default: [] },
  };
  readonly ledgerViews: LedgerView[] = [
    {
      type: "table",
      name: "Board",
      filters: { and: ['type == "session"'] },
      order: ["file.name", "phase", "priority", "description", "created"],
      sort: [{ property: "created", direction: "DESC" }],
    },
  ];
  readonly checks = { thread };

  readonly changeThroughTools = this.policy("Change a thread through its tools", changePolicy);
  readonly closed = this.promise("Thread closed", closedPromise);
  readonly stubSkill = this.skill(stubSkill);
  readonly specSkill = this.skill(specSkill, { "reviewer.md": reviewerBrief });
  readonly runSkill = this.skill(runSkill);
  readonly validateSkill = this.skill(validateSkill);
  readonly reviewer = this.agent(reviewerAgent);
  readonly validator = this.agent(validatorAgent);

  /**
   * A thread: `/threads:stub` or the stub tool plants one, and a run takes it to closed. A thread document
   * holds structured sections that only the tools write, so the module offers no command for a blank one.
   */
  readonly thread = this.template({
    id: "thread",
    name: "Thread",
    command: false,
    skills: [this.runSkill],
    policies: [this.changeThroughTools],
    promises: [this.closed],
  });

  tools(): AgentTool[] {
    const vault = this.vault;
    const template = this.thread;
    const json = (value: unknown) => JSON.stringify(value);
    return [
      defineTool({
        name: "stub",
        description: `Plants one thread or more: a document in ${this.layout.sessions}/ with the idea in the user's words and the research's context. Returns each thread's phase and next step, and \`similar\`: open threads that may hold the same idea.`,
        input: stubShape,
        title: ({ threads: list }) => `Plant ${list.map((t) => t.title).join(", ").slice(0, 60)}`,
        run: async ({ threads: list }) => {
          const planted = [];
          for (const input of list) planted.push(await stub(vault, template, input));
          return json({ planted });
        },
      }),
      defineTool({
        name: "spec",
        description:
          "Writes a thread's spec, or its new text: the goal, every requirement (the ones that stay with their id, new ones with none), retire for the ones that go, the rules, decisions, out of scope, knowledge, and open questions. After a passing round, a change to the requirements or the rules needs user_asked. The budget is the user's to change.",
        input: specShape,
        title: ({ thread: t }) => `Write the spec of ${t.slice(0, 60)}`,
        run: async (input) => json(await spec(vault, input)),
      }),
      defineTool({
        name: "plan",
        description:
          "Changes a thread's plan: add tasks (each serving requirements, with details), mark tasks done (with a trail: repository@commit, or a note), or drop them (with a reason). After a passing round, a change needs user_asked.",
        input: planShape,
        title: ({ thread: t }) => `Change the plan of ${t.slice(0, 60)}`,
        run: async (input) => json(await plan(vault, input)),
      }),
      defineTool({
        name: "round",
        description:
          "Records a validation round as the validator reported it: the scope (starting with the heads checked), one result per requirement with evidence, the findings, and notes; with the outcome of each finding of the last round in resolved.",
        input: roundShape,
        title: ({ thread: t }) => `Record a round of ${t.slice(0, 60)}`,
        run: async (input) => json(await round(vault, input)),
      }),
      defineTool({
        name: "close",
        description: "Closes a validated thread with a summary, giving each finding of its last round an outcome (stub, declined, or knowledge); or drops a thread with the reason.",
        input: closeShape,
        title: ({ thread: t, outcome }) => `${outcome === "closed" ? "Close" : "Drop"} ${t.slice(0, 60)}`,
        run: async (input) => json(await close(vault, input)),
      }),
      defineTool({
        name: "status",
        description: "One thread's phase, next step, plan counts, last round, and problems; or, with no thread, the open threads, the most urgent first. Reads only.",
        input: { thread: z.string().optional().describe("The thread: its title, a [[link]] to it, or its path.") },
        readOnly: true,
        title: ({ thread: t }) => (t ? `Status of ${t.slice(0, 60)}` : "List the open threads"),
        run: async ({ thread: t }) => json(await status(vault, t)),
      }),
    ];
  }
}
