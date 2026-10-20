import { defineTool, z } from "../../agent/index.js";
import type { AgentTool } from "../../agent/types.js";
import type { LedgerView } from "../../document/bases.js";
import { readDocument } from "../../document/document.js";
import type { Schema } from "../../document/schema.js";
import type { Check } from "../checks.js";
import { YamiModule } from "../module.js";
import { changeThroughTools, reviewerAgent, runSkill, specSkill, stubSkill, threadClosed, validatorAgent } from "./documents.js";
import { close, closeShape, plan, planShape, round, roundShape, spec, specShape, stub, stubShape } from "./ops.js";
import { board, find, nextStep, parseThread, THREAD_FLOW, threadPhase, view, waiting, type BoardEntry, type ThreadStatus, type Where } from "./thread.js";

/**
 * Met when the thread is closed or dropped. For review when the user must decide: the thread used its
 * budget of rounds, or waits for a thread before it. The phase is derived from the document, never read
 * from a property.
 */
async function threadCheck(where: Where, path: string): ReturnType<Check> {
  const t = parseThread(await readDocument(where.vault, path));
  const p = threadPhase(t);
  if (p === "closed" || p === "dropped") return { status: "met", detail: `the thread is ${p}` };
  const before = p === "planned" || p === "in progress" ? await waiting(where, t) : [];
  if (before.length) return { status: "review", detail: `the thread waits for ${before.join(", ")}` };
  const step = nextStep(t);
  if (step.step === "ask") return { status: "review", detail: step.text };
  return { status: "unmet", detail: `the thread is ${p}; next: ${step.text}` };
}

/**
 * The built-in threads module: validated work on repositories, one session document per thread, from the
 * idea to closed. It takes vault flows, so a person adds their own kinds of work to it with no code; their
 * sessions go in `threads/` beside the threads, and are not threads.
 */
export class ThreadsModule extends YamiModule {
  readonly id = "threads";
  readonly name = "Threads";
  readonly icon = "spool";
  /** Its own color, outside `MODULE_COLORS`, so the host's modules keep the colors they had before threads was built in. */
  readonly color = "#6e56cf";
  readonly vaultFlows = true;
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
      filters: { and: ['type == "session"', `flow == "${THREAD_FLOW}"`] },
      order: ["file.name", "phase", "priority", "description", "created"],
      sort: [{ property: "created", direction: "DESC" }],
    },
  ];
  readonly checks: Record<string, Check> = { thread: (_promise, context) => threadCheck(this, context.path) };

  readonly changeThroughTools = this.policy(changeThroughTools);
  readonly closed = this.promise(threadClosed);
  readonly stubSkill = this.skill(stubSkill);
  readonly specSkill = this.skill(specSkill);
  readonly runSkill = this.skill(runSkill);
  readonly reviewer = this.agent(reviewerAgent);
  readonly validator = this.agent(validatorAgent);

  /**
   * A thread: `/threads:stub` or the stub tool plants one, and a run takes it to closed. A thread document
   * holds structured sections that only the tools write, so the module offers no command for a blank one.
   */
  readonly thread = this.flow({
    name: THREAD_FLOW,
    description: "One piece of validated work on repositories, from the stub to closed.",
    command: false,
    skills: [this.runSkill],
    agents: [this.reviewer, this.validator],
    policies: [this.changeThroughTools],
    promises: [this.closed],
  });

  /**
   * One thread's phase, next step, plan counts, last round, and problems, from its document; or, with no
   * thread, the open threads, the most urgent first. A thread is named by its title, a `[[link]]` to it, or
   * its path. It reads only, and `threads_status` returns the same. It throws when no thread has the name.
   * @example
   * const { phase, next } = await threads.status("Divide"); // "planned", { step: "execute", text: "do T1, T2" }
   */
  status(thread: string): Promise<ThreadStatus>;
  status(): Promise<{ threads: BoardEntry[] }>;
  async status(thread?: string): Promise<ThreadStatus | { threads: BoardEntry[] }> {
    return thread ? view(this, await find(this, thread)) : { threads: await board(this) };
  }

  tools(): AgentTool[] {
    const flow = this.thread;
    const json = (value: unknown) => JSON.stringify(value);
    return [
      defineTool({
        name: "stub",
        description: `Plants one thread or more: a document in ${this.layout.sessions}/ with the idea in the user's words and the research's context. Returns each thread's phase and next step, and \`similar\`: open threads that may hold the same idea.`,
        input: stubShape,
        title: ({ threads: list }) => `Plant ${list.map((t) => t.title).join(", ").slice(0, 60)}`,
        run: async ({ threads: list }) => {
          const planted = [];
          for (const input of list) planted.push(await stub(this, flow, input));
          return json({ planted });
        },
      }),
      defineTool({
        name: "spec",
        description:
          "Writes a thread's spec, or its new text: the goal, every requirement (the ones that stay with their id, new ones with none), retire for the ones that go, the rules, decisions, out of scope, knowledge, and open questions. After a passing round, a change to the requirements or the rules needs user_asked. The budget is the user's to change.",
        input: specShape,
        title: ({ thread: t }) => `Write the spec of ${t.slice(0, 60)}`,
        run: async (input) => json(await spec(this, input)),
      }),
      defineTool({
        name: "plan",
        description:
          "Changes a thread's plan: add tasks (each serving requirements, with details), mark tasks done (with a trail: repository@commit, or a note), or drop them (with a reason). After a passing round, a change needs user_asked.",
        input: planShape,
        title: ({ thread: t }) => `Change the plan of ${t.slice(0, 60)}`,
        run: async (input) => json(await plan(this, input)),
      }),
      defineTool({
        name: "round",
        description:
          "Records a validation round as the validator reported it: the scope (starting with the heads checked), one result per requirement with evidence, the findings, and notes; with the outcome of each finding of the last round in resolved.",
        input: roundShape,
        title: ({ thread: t }) => `Record a round of ${t.slice(0, 60)}`,
        run: async (input) => json(await round(this, input)),
      }),
      defineTool({
        name: "close",
        description: "Closes a validated thread with a summary, giving each finding of its last round an outcome (stub, declined, or knowledge); or drops a thread with the reason.",
        input: closeShape,
        title: ({ thread: t, outcome }) => `${outcome === "closed" ? "Close" : "Drop"} ${t.slice(0, 60)}`,
        run: async (input) => json(await close(this, input)),
      }),
      defineTool({
        name: "status",
        description: "One thread's phase, next step, plan counts, last round, and problems; or, with no thread, the open threads, the most urgent first. Reads only.",
        input: { thread: z.string().optional().describe("The thread: its title, a [[link]] to it, or its path.") },
        readOnly: true,
        title: ({ thread: t }) => (t ? `Status of ${t.slice(0, 60)}` : "List the open threads"),
        run: async ({ thread: t }) => json(t ? await this.status(t) : await this.status()),
      }),
    ];
  }
}
