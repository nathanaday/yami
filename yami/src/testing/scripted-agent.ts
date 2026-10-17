import { Agent, type ActiveTurn, type AgentInfo, type AgentSession, BaseSession, runTool, type SessionOptions, type TurnResult } from "../agent/index.js";
import type { Verdict } from "../module/review.js";

/**
 * What the agent does in one turn: any work on the vault, and the result, by default completed. It gets
 * the turn's message, and the session, whose `tool` calls a tool as the agent would.
 */
export type Turn = (prompt: string, session: ScriptedSession) => Promise<Partial<TurnResult> | void> | Partial<TurnResult> | void;

/** A session that takes the next turn of its agent's script for each message. */
export class ScriptedSession extends BaseSession {
  readonly harness = "claude";
  readonly id: string;
  /** Every message the session received, in order. */
  readonly prompts: string[] = [];

  constructor(
    private readonly agent: ScriptedAgent,
    readonly options: SessionOptions,
  ) {
    super();
    this.id = options.resume ?? `scripted-${agent.started.length + 1}`;
  }

  protected async startTurn(prompt: string, turn: ActiveTurn) {
    this.prompts.push(prompt);
    const behavior = this.agent.turns.shift() ?? (() => ({}));
    const outcome = (await behavior(prompt, this)) ?? {};
    turn.finish({ status: "completed", text: "ok", ...outcome });
  }

  /**
   * Calls a tool of the session's tool set by its full name, such as `wiki_search` or `yami_check`, as the
   * harness would: the input is checked against the tool's schema. Throws when the session has no such tool.
   */
  async tool(name: string, input: unknown): Promise<{ text: string; isError: boolean }> {
    const tool = this.options.tools?.tools.find((t) => t.name === name);
    if (!tool) throw new Error(`The session has no tool ${name}.`);
    return runTool(tool, input, new AbortController().signal);
  }

  protected async interruptTurn(turn: ActiveTurn) {
    turn.finish({ status: "interrupted", text: "" });
  }

  async close() {
    this.markClosed();
  }

  async models() {
    return [];
  }

  async commands() {
    return [];
  }

  async configure() {}
}

/**
 * An agent with no harness, for tests: each turn of each session runs the next function of its script,
 * and a turn with no function left completes with no work. Interrupt and close behave as a harness's do.
 */
export class ScriptedAgent extends Agent {
  readonly harness = "claude";
  /** The turns still to run, shared by every session of the agent. */
  readonly turns: Turn[];
  /** Every session the agent started, in order. */
  readonly started: ScriptedSession[] = [];

  constructor(turns: Turn[] = []) {
    super({});
    this.turns = [...turns];
  }

  /** The session the agent started last. */
  get last(): ScriptedSession | undefined {
    return this.started.at(-1);
  }

  /** Adds turns to the end of the script. */
  queue(...turns: Turn[]): this {
    this.turns.push(...turns);
    return this;
  }

  async connect(): Promise<AgentInfo> {
    return { harness: "claude", version: "0", account: {} };
  }

  /** Forgets every session, as a harness does when it cleans up old sessions: a resume of one fails. */
  forget(): void {
    this.forgotten = this.started.length;
  }

  private forgotten = 0;

  protected async createSession(options: SessionOptions): Promise<AgentSession> {
    if (options.resume && !this.started.slice(this.forgotten).some((s) => s.id === options.resume)) throw new Error(`No session ${options.resume}.`);
    const session = new ScriptedSession(this, this.sessionOptions(options));
    this.started.push(session);
    return session;
  }
}

/** A verdict for `review`: the verdict, or the verdict and its reason. */
export type ScriptedVerdict = Verdict | [Verdict, string];

/**
 * A turn that plays the reviewer of a session: it records a verdict with `yami_review` for each policy and
 * each promise of the review. An item that `verdicts` names, by its name or its path, gets that verdict;
 * any other is followed or met. A reviewer that records nothing is a turn that does nothing, `() => {}`.
 * It throws when its session is no review's: only a review's conversation has `yami_review`.
 *
 * ```ts
 * t.agent.queue(meetTheChecks, review({ "<policy name>": ["broken", "<reason>"] }), fixIt, review());
 * ```
 */
export function review(verdicts: Record<string, ScriptedVerdict> = {}): Turn {
  return async (_prompt, session) => {
    if (!session.options.tools?.tools.some((tool) => tool.name === "yami_review")) throw new Error("The turn is no review: its session has no yami_review tool.");
    const call = async (list: { item: string; verdict: Verdict; reason: string }[]) => {
      const result = await session.tool("yami_review", { verdicts: list });
      if (result.isError) throw new Error(result.text);
      return JSON.parse(result.text) as { remaining: { kind: "policy" | "promise"; name: string; path: string }[] };
    };
    const { remaining } = await call([]);
    await call(
      remaining.map((item) => {
        const given = verdicts[item.name] ?? verdicts[item.path];
        const [verdict, reason] = Array.isArray(given) ? given : [given ?? (item.kind === "policy" ? "followed" : "met"), undefined];
        return { item: item.path, verdict, reason: reason ?? `The scripted reviewer finds it ${verdict}.` };
      }),
    );
  };
}
