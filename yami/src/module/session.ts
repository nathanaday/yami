import type { Agent } from "../agent/agent.js";
import type { Harness } from "../agent/types.js";
import { basename, linksOf, linkTarget, readDocument, resolveLink, sectionText, type Document } from "../document/document.js";
import { SESSION_STATES, type SessionState } from "../document/schema.js";
import type { Properties } from "../document/vault.js";
import { AGENT_RUN_LINE, isLiveRun, type AgentRun, type AgentRunStatus } from "./agent-run.js";
import { linkedDocuments, type LinkedDocument } from "./links.js";
import type { ActionResult, DocumentRef, Flow, SessionAction, YamiModule } from "./module.js";
import { readProgress, type ProgressLine } from "./progress.js";
import { isJudged } from "./review.js";
import { KILL } from "./fresh-run.js";
import { checkSession, runSession, sessionParts, type RunControl, type RunResult, type SessionCheck } from "./run.js";
import type { Yami } from "./yami.js";

/**
 * What a session does now. While a run is live: `working` (an agent turn), `checking` (the promises), or
 * `reviewing` (a reviewer judges the policies and the promises with no check). Otherwise the state that the
 * document records: `open`, `done`, `needs-attention`, `failed`, or `stopped`.
 */
export type SessionStatus = Exclude<SessionState, "running"> | "working" | "checking" | "reviewing";

/** How a person reads each status, in a list, a button, or a notice. */
export const STATUS_LABELS: Record<SessionStatus, string> = {
  open: "Not started",
  working: "Working",
  checking: "Checking",
  reviewing: "Reviewing",
  done: "Done",
  "needs-attention": "Needs attention",
  failed: "Failed",
  stopped: "Stopped",
};

/** A session at a glance: what a list of sessions shows. */
export interface SessionSummary {
  session: Session;
  path: string;
  /** The document's name. */
  name: string;
  module: YamiModule;
  flow: Flow | undefined;
  status: SessionStatus;
  /** When the session was created, as `YYYY-MM-DDTHH:MM:SS`. */
  created: string | undefined;
  /** The agent turns so far, over every run. */
  iteration: number;
  /** The promises met, and the promises not met or for review, at the last check. */
  met: number;
  unmet: number;
  /** The document's properties: the core fields and the module's own. */
  properties: Properties;
}

/**
 * A linked document of a session. A promise also says whether the last check or review met it, and a
 * policy whether the last review found it followed: undefined before any. `reason` says why.
 */
export interface SessionDocument extends LinkedDocument {
  met?: boolean;
  followed?: boolean;
  /**
   * Why the last check or review decided so, as the session document shows it:
   * for a promise, the check's detail, `review: <reason>` once a review judged it, or `the review judges it`;
   * for a policy, the reviewer's reason. Undefined before any.
   */
  reason?: string;
  /** For a promise: `true` when it has no check, so the review judges it, and `false` when Yami checks it. */
  judged?: boolean;
  /** The document's `description`: every form has one, and an article can. Undefined when the link finds no note. */
  description?: string;
}

/** All of a session: what a page about one session shows. */
export interface SessionDetails extends SessionSummary {
  /** The documents the session links: promises, policies, skills, agents, then articles. */
  documents: SessionDocument[];
  /** The conversation note that records the runs, when one exists. */
  conversation: string | undefined;
  /** The conversation note of the last review, when one exists. */
  review: string | undefined;
  /** The runs of agents that the session called with `yami_agent`, oldest first, as its Progress section records them. */
  agentRuns: AgentRun[];
  /** The harness of the last run. */
  harness: string | undefined;
  /** The lines of the Progress section, oldest first, each with its time. */
  progress: ProgressLine[];
}

/** Something a person can do with a session now. */
export interface SessionAct {
  kind: "start" | "resume" | "stop" | "kill" | "action";
  /** What a button says, such as "Run with Claude". */
  label: string;
  /** The agent of a start. */
  agent?: Agent;
  /** The module's action, for the kind `action`. */
  action?: SessionAction;
  /** Does the act. Resolves when it ends, with what to tell the person. */
  run(): Promise<ActionResult>;
}
export interface RunOptions {
  /** The agent that runs the session, or its harness. Default: the Yami's first agent. A resume takes the agent of the conversation it continues. */
  agent?: Agent | Harness;
  /** Agent turns in this run. Default: the flow's. */
  maxIterations?: number;
}

/** What a new session document holds beyond its flow. */
export interface NewSession {
  /** The document name. Default: the flow's name and the time. A name that a file cannot take is made safe, and a name in use gets a number. */
  name?: string;
  /** Refuse a name that is in use or that a file cannot take, instead of changing it. */
  exact?: boolean;
  /**
   * The text of the Request section: what the session must do. Without one the section stays empty, for a
   * person to write. A line that starts with `## ` would start a section, so `create` refuses it: write it
   * as plain text, or as `###`.
   */
  request?: string;
  /** The module's session fields. */
  fields?: Properties;
  /** Documents linked on top of the flow's, for example a policy or an agent of another module. */
  add?: DocumentRef[];
}

interface LiveRun {
  promise: Promise<RunResult>;
  control: RunControl;
  abort: AbortController;
  phase: "working" | "checking" | "reviewing";
}

/**
 * One session document, and the runs of the agent loop on it. Get one with `yami.session(path)` or
 * `flow.create()`. A Yami gives one handle for each path, so its listeners see every run.
 */
export class Session {
  #run: LiveRun | undefined;
  /** The end that the last run is writing, while its document still says `running`. */
  #ending: SessionStatus | undefined;
  /** The last run, until its conversations close. A new run starts after it. */
  #closing: Promise<unknown> = Promise.resolve();
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

  async flow(): Promise<Flow | undefined> {
    return sessionParts(this.yami, await this.read()).flow;
  }

  /**
   * Whether a run of this Yami is live on the session. A run is live until it writes its end to the
   * document, and its harness sessions close after that.
   */
  get running(): boolean {
    return this.#run !== undefined;
  }

  /**
   * The live phase of a run, or the state the document records. A document that says `running` with no
   * live run reads as `stopped`: its run ended without recording its end, for example when the app quit.
   */
  async status(): Promise<SessionStatus> {
    return this.#statusFrom((await this.read()).properties);
  }

  #statusFrom(properties: Properties): SessionStatus {
    if (this.#run) return this.#run.phase;
    const state = properties.state;
    if (state === "running") return this.#ending ?? "stopped";
    return SESSION_STATES.includes(state as SessionState) ? (state as SessionStatus) : "open";
  }

  /**
   * The session at a glance, from its document as read; `yami.summaries` reads each document once and
   * calls it. A flow the module does not have reads as none, so a document in the middle of an edit
   * still shows.
   */
  summarize(doc: Document): SessionSummary {
    const module = this.yami.module(String(doc.properties.module ?? ""));
    if (doc.properties.type !== "session" || !module) throw new Error(`${doc.path} is not a session of a module of this Yami.`);
    const flow = module.flowOf(doc.properties.flow);
    const properties = doc.properties;
    const iteration = Number(properties.iteration);
    return {
      session: this,
      path: this.path,
      name: basename(this.path),
      module,
      flow,
      status: this.#statusFrom(properties),
      created: typeof properties.created === "string" ? properties.created : undefined,
      iteration: Number.isFinite(iteration) && iteration > 0 ? Math.trunc(iteration) : 0,
      met: linksOf(properties.met).length,
      unmet: linksOf(properties.unmet).length,
      properties,
    };
  }

  /** All of the session: its summary, the documents it links with the paths they resolve to, its conversation, and its progress. */
  async details(): Promise<SessionDetails> {
    const doc = await this.read();
    const summary = this.summarize(doc);
    // The loop records each promise by its path, so a promise linked by its name still finds its mark.
    const paths = async (field: string) => new Set(await Promise.all(linksOf(doc.properties[field]).map((target) => resolveLink(this.yami.vault, target, []))));
    const marks = async (yes: string, no: string) => {
      const [y, n] = [await paths(yes), await paths(no)];
      return (path: string) => (y.has(path) ? true : n.has(path) ? false : undefined);
    };
    const met = await marks("met", "unmet");
    const followed = await marks("followed", "broken");
    // The text after an item's link on its line of a section that the loop writes.
    const reasons = async (section: string, line: RegExp) => {
      const found = new Map<string, string>();
      for (const match of sectionText(doc.body, section).split("\n").map((text) => line.exec(text))) {
        const path = match && (await resolveLink(this.yami.vault, linkTarget(match[1]!), []));
        if (path) found.set(path, match![2]!);
      }
      return found;
    };
    const checked = await reasons("Deliverables", /^- \[[ x]\] (\[\[[^\]]+\]\]) — (.*)$/);
    const reviewed = await reasons("Review", /^- (?:followed|broken): (\[\[[^\]]+\]\]) — (.*)$/);
    const documents: SessionDocument[] = [];
    for (const d of await linkedDocuments(this.yami.vault, summary.module.id, doc.properties)) {
      const linked = d.path ? await readDocument(this.yami.vault, d.path).catch(() => undefined) : undefined;
      const description = typeof linked?.properties.description === "string" ? linked.properties.description : undefined;
      if (d.path && d.kind === "promises") documents.push({ ...d, met: met(d.path), reason: checked.get(d.path), judged: linked && isJudged(linked), description });
      else if (d.path && d.kind === "policies") documents.push({ ...d, followed: followed(d.path), reason: reviewed.get(d.path), description });
      else documents.push(d.path ? { ...d, description } : d);
    }
    const target = linksOf(doc.properties.conversation)[0];
    const review = linksOf(doc.properties.review)[0];
    const progress = readProgress(doc.body);
    // The last line of each run's note says what the run is now; a run that is live here is working.
    const runs = new Map<string, AgentRun>();
    for (const { text } of progress) {
      const match = AGENT_RUN_LINE.exec(text);
      const conversation = match && (await resolveLink(this.yami.vault, linkTarget(match[3]!), []));
      if (!conversation) continue;
      const state = match![2]!;
      const status: AgentRunStatus = state === "started" ? (isLiveRun(this.yami, conversation) ? "working" : "stopped") : (state as AgentRunStatus);
      runs.set(conversation, { agent: match![1]!, conversation, status });
    }
    return {
      ...summary,
      documents,
      conversation: target ? await resolveLink(this.yami.vault, target, []) : undefined,
      review: review ? await resolveLink(this.yami.vault, review, []) : undefined,
      agentRuns: [...runs.values()],
      harness: typeof doc.properties.harness === "string" ? doc.properties.harness : undefined,
      progress,
    };
  }

  /**
   * What a person can do with the session now, from its properties as read: start it with each agent and
   * resume its conversation while no run is live, stop or kill a live run, and the actions of its module
   * that its flow takes and whose `when` holds. A host shows these as commands or buttons.
   */
  acts(properties: Properties): SessionAct[] {
    const name = basename(this.path);
    // A live run can always be stopped, whatever its document says now.
    if (this.#run) {
      return [
        { kind: "stop", label: "Stop", run: () => this.stop().then(() => `Stopped ${name}. Resume it to go on.`) },
        { kind: "kill", label: "Kill the agent", run: () => this.kill().then(() => `Killed the agent of ${name}. Resume the session to go on.`) },
      ];
    }
    let parts;
    try {
      parts = sessionParts(this.yami, { path: this.path, properties, body: "" });
    } catch {
      return [];
    }
    const ended = (more: string) => (result: RunResult) =>
      `${name}: ${STATUS_LABELS[result.state === "running" ? "stopped" : result.state].toLowerCase()} after ${result.iterations}${more} iteration${result.iterations === 1 ? "" : "s"}${result.reason ? `: ${result.reason}` : "."}`;
    const acts: SessionAct[] = this.yami.agents.map((agent) => ({
      kind: "start",
      label: `Run with ${capitalize(this.yami.agentName(agent))}`,
      agent,
      run: () => this.start({ agent }).then(ended("")),
    }));
    if (linksOf(properties.conversation).length) acts.push({ kind: "resume", label: "Resume", run: () => this.resume().then(ended(" more")) });
    for (const action of parts.module.actions) {
      if ("on" in action && action.on === parts.flow && (!action.when || action.when(properties))) acts.push({ kind: "action", label: action.name, action, run: () => action.run(this) });
    }
    return acts;
  }

  /**
   * Runs the checks of the session's promises now, and records nothing: what the self-check tool,
   * `yami_check`, returns to an agent. A promise with no check is in `judged`, for the review.
   */
  check(): Promise<SessionCheck> {
    return checkSession(this.yami, this.path);
  }

  /** Calls the listener at each change of status. Returns the function that stops it. */
  on(listener: (status: SessionStatus) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Runs the agent loop in a new conversation, with the session's full context. The iteration count
   * continues. Resolves once the run's harness sessions close, after the document records its end. A start
   * while the last run's harness sessions close waits for them.
   * @example
   * const result = await session.start({ agent: "claude" });
   */
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

  /**
   * Interrupts the agent's turn, or the reviewer's during a review, and ends the run as `stopped`. A later
   * resume continues it. Resolves once the last run's harness sessions close, also after the run ended.
   */
  async stop(): Promise<void> {
    this.#run?.abort.abort();
    await this.#closing;
  }

  /**
   * Closes the harness session of the live turn at once, the worker's or the reviewer's, without waiting for
   * the turn to stop, and ends the run as `stopped`. Resolves once the last run's harness sessions close, also
   * after the run ended.
   */
  async kill(): Promise<void> {
    this.#run?.abort.abort(KILL);
    await this.#closing;
  }

  private run(resume: boolean, options: RunOptions): Promise<RunResult> {
    if (this.#run) return Promise.reject(new Error(`${this.path} is running.`));
    let agent: Agent;
    try {
      agent = this.yami.agent(options.agent);
    } catch (error) {
      return Promise.reject(error);
    }
    const abort = new AbortController();
    // The run ends when it writes its end, not when its harness exits, so the handle and the document agree.
    const end = (state: SessionState) => {
      if (this.#run === live) this.#run = undefined;
      if (this.#run) return;
      this.#ending = state === "running" ? "stopped" : state;
      this.emit(this.#ending);
    };
    const control: RunControl = {
      signal: abort.signal,
      phase: (phase) => {
        if (this.#run !== live || live.phase === phase) return;
        live.phase = phase;
        this.emit(phase);
      },
      end,
    };
    const live: LiveRun = { control, abort, phase: resume ? "checking" : "working", promise: undefined as unknown as Promise<RunResult> };
    this.#run = live;
    this.#ending = undefined;
    live.promise = this.#closing.then(() => runSession(this.yami, this.path, agent, control, { resume, maxIterations: options.maxIterations }));
    this.#closing = live.promise.catch(() => undefined);
    this.emit(live.phase);
    live.promise.then(
      (result) => {
        if (this.#run === live) end(result.state);
        if (!this.#run) this.#ending = undefined;
      },
      () => {
        if (this.#run === live) this.#run = undefined;
        if (this.#run) return;
        this.#ending = undefined;
        // The run threw before its end reached the document, so the document says what the session is.
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

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
