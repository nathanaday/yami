import { Agent, type ActiveTurn, type AgentInfo, type AgentSession, BaseSession, type SessionOptions, type TurnResult } from "../agent/index.js";

/** What the agent does in one turn: any work on the vault, and the result, by default completed. */
export type Turn = (prompt: string) => Promise<Partial<TurnResult> | void> | Partial<TurnResult> | void;

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
    const outcome = (await behavior(prompt)) ?? {};
    turn.finish({ status: "completed", text: "ok", ...outcome });
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
