import type { Agent } from "../agent/agent.js";
import type { Harness } from "../agent/types.js";
import { linksOf, readDocument, resolveLink, type Document } from "../document/document.js";
import { SESSION_STATES, type SessionState } from "../document/schema.js";
import type { Properties } from "../document/vault.js";
import type { ModuleDocument, SessionTemplate, YamiModule } from "./module.js";
import { runSession, sessionParts, type RunControl, type RunResult } from "./run.js";
import type { Yami } from "./yami.js";

/**
 * What a session does now. While a run is live: `working` (an agent turn) or `checking` (the promises).
 * Otherwise the state that the document records: `open`, `done`, `needs-attention`, `failed`, or `stopped`.
 */
export type SessionStatus = Exclude<SessionState, "running"> | "working" | "checking";

export interface RunOptions {
  /** The agent that runs the session, or its harness. Default: the Yami's first agent. A resume takes the agent of the conversation it continues. */
  agent?: Agent | Harness;
  /** Agent turns in this run. Default: the template's. */
  maxIterations?: number;
}

/** What a new session document holds beyond its template. */
export interface NewSession {
  /** The document name. Default: the template's name and the time. A name that a file cannot take is made safe, and a name in use gets a number. */
  name?: string;
  /** Refuse a name that is in use or that a file cannot take, instead of changing it. */
  exact?: boolean;
  /** The module's session fields. */
  fields?: Properties;
  /** Documents linked on top of the template's, for example a policy of another module. */
  add?: ModuleDocument[];
}

interface LiveRun {
  promise: Promise<RunResult>;
  control: RunControl;
  phase: "working" | "checking";
}

/**
 * One session document, and the runs of the agent loop on it. Get one with `yami.session(path)` or
 * `template.create()`. A Yami gives one handle for each path, so its listeners see every run.
 */
export class Session {
  #run: LiveRun | undefined;
  readonly #listeners = new Set<(status: SessionStatus) => void>();

  constructor(
    readonly yami: Yami,
    /** The session document, as a vault path. */
    readonly path: string,
  ) {}

  /** The session document as it is now. */
  read(): Promise<Document> {
    return readDocument(this.yami.vault, this.path);
  }

  async module(): Promise<YamiModule> {
    return sessionParts(this.yami, await this.read()).module;
  }

  async template(): Promise<SessionTemplate | undefined> {
    return sessionParts(this.yami, await this.read()).template;
  }

  /** Whether a run of this Yami is live on the session. */
  get running(): boolean {
    return this.#run !== undefined;
  }

  /**
   * The live phase of a run, or the state the document records. A document that says `running` with no
   * live run reads as `stopped`: its run ended without recording its end, for example when the app quit.
   */
  async status(): Promise<SessionStatus> {
    if (this.#run) return this.#run.phase;
    const state = (await this.read()).properties.state;
    if (state === "running") return "stopped";
    return SESSION_STATES.includes(state as SessionState) ? (state as SessionStatus) : "open";
  }

  /** Calls the listener at each change of status. Returns the function that stops it. */
  on(listener: (status: SessionStatus) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Runs the agent loop in a new conversation, with the session's full context. The iteration count continues. */
  start(options: RunOptions = {}): Promise<RunResult> {
    return this.run(false, options);
  }

  /**
   * Continues the session's conversation, so the agent keeps what it did. It checks the promises first: a
   * session whose promises are met ends there. A session with no conversation starts instead.
   */
  async resume(options: RunOptions = {}): Promise<RunResult> {
    const target = linksOf((await this.read()).properties.conversation)[0];
    const conversation = target && (await resolveLink(this.yami.vault, target, []));
    const named = conversation && this.yami.agentNamed((await readDocument(this.yami.vault, conversation)).properties.agent);
    if (named && options.agent && this.yami.agent(options.agent) !== named) {
      throw new Error(`${this.path} continues a conversation with ${named.harness}. Resume it with that agent, or start the session again.`);
    }
    return this.run(true, named ? { ...options, agent: named } : options);
  }

  /** Interrupts the agent's turn and ends the run as `stopped`. A later resume continues it. */
  async stop(): Promise<void> {
    const run = this.#run;
    if (!run) return;
    run.control.stopping = true;
    await run.control.conversation?.interrupt();
    await run.promise.catch(() => undefined);
  }

  /** Closes the agent's harness session at once, without waiting for the turn to stop, and ends the run as `stopped`. */
  async kill(): Promise<void> {
    const run = this.#run;
    if (!run) return;
    run.control.stopping = true;
    await run.control.conversation?.close();
    await run.promise.catch(() => undefined);
  }

  private run(resume: boolean, options: RunOptions): Promise<RunResult> {
    if (this.#run) return Promise.reject(new Error(`${this.path} is running.`));
    let agent: Agent;
    try {
      agent = this.yami.agent(options.agent);
    } catch (error) {
      return Promise.reject(error);
    }
    const control: RunControl = {
      stopping: false,
      phase: (phase) => {
        if (!this.#run || this.#run.phase === phase) return;
        this.#run.phase = phase;
        this.emit(phase);
      },
    };
    const live: LiveRun = { control, phase: resume ? "checking" : "working", promise: undefined as unknown as Promise<RunResult> };
    this.#run = live;
    live.promise = runSession(this.yami, this.path, agent, control, { resume, maxIterations: options.maxIterations });
    this.emit(live.phase);
    live.promise.then(
      (result) => {
        this.#run = undefined;
        this.emit(result.state === "running" ? "stopped" : result.state);
      },
      () => {
        this.#run = undefined;
        // The run threw before it changed the document, so the document says what the session is.
        void this.status().then((status) => !this.#run && this.emit(status), () => undefined);
      },
    );
    return live.promise;
  }

  private emit(status: SessionStatus): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(status);
      } catch (error) {
        console.error("yami: session listener threw", error);
      }
    }
    this.yami.sessionChanged(this, status);
  }
}
