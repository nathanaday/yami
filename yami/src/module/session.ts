import type { Agent } from "../agent/agent.js";
import type { Harness } from "../agent/types.js";
import { basename, linksOf, readDocument, resolveLink, sectionText, type Document } from "../document/document.js";
import { SESSION_STATES, type SessionState } from "../document/schema.js";
import type { Properties } from "../document/vault.js";
import { linkedDocuments, type LinkedDocument } from "./links.js";
import type { ActionResult, ModuleDocument, SessionAction, SessionTemplate, YamiModule } from "./module.js";
import { runSession, sessionParts, type RunControl, type RunResult } from "./run.js";
import type { Yami } from "./yami.js";

/**
 * What a session does now. While a run is live: `working` (an agent turn) or `checking` (the promises).
 * Otherwise the state that the document records: `open`, `done`, `needs-attention`, `failed`, or `stopped`.
 */
export type SessionStatus = Exclude<SessionState, "running"> | "working" | "checking";

/** How a person reads each status, in a list, a button, or a notice. */
export const STATUS_LABELS: Record<SessionStatus, string> = {
  open: "Not started",
  working: "Working",
  checking: "Checking",
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
  template: SessionTemplate | undefined;
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

/** A linked document of a session. A promise also says whether the last check met it: undefined before any check. */
export interface SessionDocument extends LinkedDocument {
  met?: boolean;
}

/** All of a session: what a page about one session shows. */
export interface SessionDetails extends SessionSummary {
  /** The documents the session links: promises, policies, skills, then articles. */
  documents: SessionDocument[];
  /** The conversation note that records the runs, when one exists. */
  conversation: string | undefined;
  /** The harness of the last run. */
  harness: string | undefined;
  /** The lines of the Progress section, oldest first, each with its time. */
  progress: { time: string; text: string }[];
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
    return this.#statusFrom((await this.read()).properties);
  }

  #statusFrom(properties: Properties): SessionStatus {
    if (this.#run) return this.#run.phase;
    const state = properties.state;
    if (state === "running") return "stopped";
    return SESSION_STATES.includes(state as SessionState) ? (state as SessionStatus) : "open";
  }

  /**
   * The session at a glance, from its document as read; `yami.summaries` reads each document once and
   * calls it. A template the module does not have reads as none, so a document in the middle of an edit
   * still shows.
   */
  summarize(doc: Document): SessionSummary {
    const module = this.yami.module(String(doc.properties.module ?? ""));
    if (doc.properties.type !== "session" || !module) throw new Error(`${doc.path} is not a session of a module of this Yami.`);
    const template = module.templateOf(doc.properties.template);
    const properties = doc.properties;
    const iteration = Number(properties.iteration);
    return {
      session: this,
      path: this.path,
      name: basename(this.path),
      module,
      template,
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
    const met = await paths("met");
    const unmet = await paths("unmet");
    const documents = (await linkedDocuments(this.yami.vault, summary.module.layout, doc.properties)).map((d): SessionDocument =>
      d.kind !== "promises" || !d.path ? d : { ...d, met: met.has(d.path) ? true : unmet.has(d.path) ? false : undefined },
    );
    const target = linksOf(doc.properties.conversation)[0];
    const progress = sectionText(doc.body, "Progress")
      .split("\n")
      .map((line) => /^- (\d\d:\d\d) (.*)$/.exec(line))
      .filter((match) => match !== null)
      .map(([, time, text]) => ({ time: time!, text: text! }));
    return {
      ...summary,
      documents,
      conversation: target ? await resolveLink(this.yami.vault, target, []) : undefined,
      harness: typeof doc.properties.harness === "string" ? doc.properties.harness : undefined,
      progress,
    };
  }

  /**
   * What a person can do with the session now, from its properties as read: start it with each agent and
   * resume its conversation while no run is live, stop or kill a live run, and the actions of its module
   * that its template takes and whose `when` holds. A host shows these as commands or buttons.
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
      `${name}: ${STATUS_LABELS[result.state === "running" ? "stopped" : result.state].toLowerCase()} after ${result.iterations}${more} iteration${result.iterations === 1 ? "" : "s"}.`;
    const acts: SessionAct[] = this.yami.agents.map((agent) => ({
      kind: "start",
      label: `Run with ${capitalize(this.yami.agentName(agent))}`,
      agent,
      run: () => this.start({ agent }).then(ended("")),
    }));
    if (linksOf(properties.conversation).length) acts.push({ kind: "resume", label: "Resume", run: () => this.resume().then(ended(" more")) });
    for (const action of parts.module.actions) {
      if ("on" in action && action.on === parts.template && (!action.when || action.when(properties))) acts.push({ kind: "action", label: action.name, action, run: () => action.run(this) });
    }
    return acts;
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

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
