import { Agent, type ActiveTurn, type AgentInfo, type AgentSession, BaseSession, type SessionOptions, type TurnResult } from "../../src/agent/index.js";

/** One scripted behavior for one agent turn. */
export type Turn = (prompt: string) => Promise<Partial<TurnResult> | void> | Partial<TurnResult> | void;


/** A session that runs one scripted behavior per turn. */
export class FakeSession extends BaseSession {
  readonly harness = "claude";
  readonly id = "fake-session";
  readonly prompts: string[] = [];
  constructor(
    private readonly turns: Turn[],
    readonly options: SessionOptions,
  ) {
    super();
  }
  protected async startTurn(prompt: string, turn: ActiveTurn) {
    this.prompts.push(prompt);
    const behavior = this.turns.shift() ?? (() => ({}));
    const outcome = (await behavior(prompt)) ?? {};
    turn.finish({ status: "completed", text: "ok", ...outcome });
  }
  protected async interruptTurn() {}
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

export class FakeAgent extends Agent {
  readonly harness = "claude";
  last: FakeSession | undefined;
  constructor(private readonly turns: Turn[]) {
    super({});
  }
  async connect(): Promise<AgentInfo> {
    return { harness: "claude", version: "0", account: {} };
  }
  protected async createSession(options: SessionOptions): Promise<AgentSession> {
    this.last = new FakeSession(this.turns, this.sessionOptions(options));
    return this.last;
  }
}

