import type { TFile } from "obsidian";
import type { Agent, AgentSession, ResumedSession, SessionStart } from "../agent/index.js";
import type { ConversationAgent } from "./agents.js";

export interface SlotOptions {
  /** The agent of a session that starts now. */
  agent(): Agent;
  /** The options of a session that starts now, read once for each start. */
  options(): SessionStart;
  /** The id of the session to continue, when there is one. */
  resume(): string | undefined;
  /** Records the id of a session that started. */
  record(id: string): void | Promise<void>;
  idleMinutes(): number;
  /** Hears each session that starts, before `open` gives it. */
  started?(session: AgentSession): void;
}

/**
 * One harness session of a note. It starts when first needed and continues the session it last recorded, or
 * starts a new one when the harness lost it. It closes after `idleMinutes` with no turn and no holder, and
 * once idle when the agent it started with is no longer the one that `agent()` gives. A conversation note has
 * one, and so has each note and agent of `NoteSessions`.
 */
export class SessionSlot {
  session: AgentSession | undefined;
  /** Whether the session continued the recorded one when it started. */
  continued = false;
  starting: Promise<AgentSession> | undefined;
  #agent: Agent | undefined;
  /** The agent of the session, also of one that closed: the agent that `agent()` gave when it started. */
  get agent(): Agent | undefined {
    return this.#agent;
  }
  #turn = false;
  #closing: Promise<void> = Promise.resolve();
  readonly #holders = new Set<object>();
  #timer: number | undefined;

  constructor(private readonly slot: SlotOptions) {}

  /** The session when it is open, also in the middle of a turn. */
  get live(): AgentSession | undefined {
    return this.session && !this.session.closed ? this.session : undefined;
  }

  /**
   * The open session, or a new one. A session in a turn stays, also when its agent is gone. Each call
   * restarts the idle wait. A call while a session starts waits for the same session.
   */
  open(): Promise<AgentSession> {
    const live = this.live;
    if (live && (this.#turn || this.#agent === this.#current())) {
      this.#idle();
      return Promise.resolve(live);
    }
    window.clearTimeout(this.#timer);
    if (live) void this.close();
    this.starting ??= this.#start().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  async #start(): Promise<AgentSession> {
    // A session that closes must exit before the next one continues its conversation.
    await this.#closing;
    const agent = this.slot.agent();
    const { session, continued } = await agent.resumeOrStart({ ...this.slot.options(), resume: this.slot.resume() });
    this.session = session;
    this.#agent = agent;
    this.continued = continued;
    session.on((event) => {
      if (session !== this.session) return;
      if (event.type === "turn-start") {
        this.#turn = true;
        window.clearTimeout(this.#timer);
      } else if (event.type === "turn-end") {
        this.#turn = false;
        this.#idle();
        // After the other listeners of this turn's end, so they see the turn end before the session closes.
        window.setTimeout(() => this.refresh(), 0);
      } else if (event.type === "closed") {
        this.session = undefined;
        this.#turn = false;
      }
    });
    try {
      this.slot.started?.(session);
    } catch (error) {
      await this.close();
      throw error;
    }
    await this.slot.record(session.id);
    this.#idle();
    return session;
  }

  /** Keeps the session open while the holder holds it. */
  hold(holder: object): void {
    this.#holders.add(holder);
    window.clearTimeout(this.#timer);
  }

  release(holder: object): void {
    this.#holders.delete(holder);
    this.#idle();
  }

  /** Closes the session when it is idle and its agent is no longer the one that `agent()` gives. */
  refresh(): void {
    if (this.live && !this.#turn && !this.starting && this.#current() !== this.#agent) void this.close();
  }

  /** The agent that `agent()` gives now, or none when it is gone. */
  #current(): Agent | undefined {
    try {
      return this.slot.agent();
    } catch {
      return undefined;
    }
  }

  /** Closes the session, also one that still starts. The next `open` continues it. */
  close(): Promise<void> {
    window.clearTimeout(this.#timer);
    const session = this.session;
    const starting = this.starting;
    this.session = undefined;
    this.#turn = false;
    this.#closing = (async () => {
      await (session ?? (await starting?.catch(() => undefined)))?.close();
    })();
    return this.#closing;
  }

  #idle(): void {
    window.clearTimeout(this.#timer);
    if (this.#turn || this.#holders.size || !this.live) return;
    this.#timer = window.setTimeout(() => {
      if (!this.#turn && !this.#holders.size) void this.close();
    }, this.slot.idleMinutes() * 60_000);
  }
}

/** The stored session ids of note sessions: for each note path, the id of each agent's session, by the agent's name. */
export type SessionIds = Record<string, Record<string, string>>;

/** A note and an agent of `NoteSessions`. */
export interface NoteAgent {
  /** The path of the note. It is read at each use, so it follows a rename. */
  readonly path: string;
  /** The note's file. Obsidian keeps one `TFile` for a note, and changes its `path` on a rename. */
  readonly file: TFile;
  /** The name of the agent. */
  readonly agent: string;
}

/**
 * What `setup` gives for a session that starts. When `State` cannot be undefined, `state` is required, so
 * `notes.session()` always gives a state of the type that `setup` gives.
 */
export type NoteSessionSetup<State> = {
  /** The options of the session, such as its `instructions`, `access`, `tools`, and `skills`. Default: none. */
  options?: SessionStart;
  /** Hears the session once it started, before `notes.session()` gives it, for example to follow its events. */
  started?(session: AgentSession): void;
} & (undefined extends State
  ? {
      /** The host's own state of the session, such as tools bound to it. `notes.session()` gives it with the session. */
      state?: State;
    }
  : {
      /** The host's own state of the session, such as tools bound to it. `notes.session()` gives it with the session. */
      state: State;
    });

export interface NoteSessionsOptions<State = undefined> {
  /** The ids that the host stored, for example in its plugin data. Yami copies them, and never changes this object. Default: none. */
  ids?: SessionIds;
  /** Called with every id after each change: a session that starts, a rename, a removed note, or `forget`. Each call gets a new object. The host stores it. */
  save?: (ids: SessionIds) => void | Promise<void>;
  /** Minutes with no turn after which a session's process closes. A function is read at each use. Default: the `idleMinutes` of `createYami`. */
  idleMinutes?: number | (() => number);
  /**
   * Makes each session that starts: its options, the host's state of it, and a hook for the session once it
   * started. Yami calls it once for each harness session, so a session that closed and starts again gets a
   * new setup. It gets the note's path, file, and agent. Default: no options and no state. When it gives a
   * state on one path and none on another, the type of `state` includes `undefined`.
   */
  setup?(note: NoteAgent): NoteSessionSetup<State>;
}

/** A harness session of a note, with the host's state of it. */
export interface NoteSession<State = undefined> extends ResumedSession {
  /** The `state` that `setup` gave when this harness session started. Its type includes `undefined` when a setup can give none. */
  state: State;
}

/** A piece of agent work that the status bar shows, and that the Stop command of its note stops. */
export interface AgentWork {
  /** The name that the status bar shows, such as the agent's. */
  readonly name: string;
  /** The note that the agent works in. It is read at each use, so it can follow a rename. */
  readonly path?: string;
  /** Stops the work. `yami-stop` calls it when the note is open in the editor. */
  stop?(): unknown;
}

/** What the vault and the agents tell `NoteSessions`. */
export interface NoteEvents {
  /** A note or a folder was renamed. */
  renamed(from: string, to: string): void;
  /** A note or a folder was removed. */
  removed(path: string): void;
  /** `setAgents` changed the agents. */
  agentsChanged(): void;
}

/** What `NoteSessions` needs of its Yami. */
export interface NoteSessionsHost {
  agents(): readonly ConversationAgent[];
  /** The note at a path, or null when there is none. */
  file(path: string): TFile | null;
  idleMinutes(): number;
  addWork(work: AgentWork): () => void;
  /** Sends the events of the vault and the agents to the note sessions. */
  follow(events: NoteEvents): void;
}

interface Entry {
  path: string;
  readonly slot: SessionSlot;
  endWork?: () => void;
}

/**
 * The harness sessions of notes: one for each note and agent, for a plugin whose agents work in a note that
 * is not a conversation note. `ObsidianYami.noteSessions` makes one.
 */
export class NoteSessions<State = undefined> {
  readonly #ids: SessionIds;
  readonly #entries = new Map<string, Map<string, Entry>>();
  readonly #states = new WeakMap<AgentSession, State>();
  #closed = false;

  constructor(
    private readonly host: NoteSessionsHost,
    private readonly options: NoteSessionsOptions<State> = {},
  ) {
    this.#ids = structuredClone(options.ids ?? {});
    host.follow({ renamed: (from, to) => this.#renamed(from, to), removed: (path) => this.#removed(path), agentsChanged: () => this.#agentsChanged() });
  }

  /** The stored ids, as `save` last got them. */
  get ids(): SessionIds {
    return structuredClone(this.#ids);
  }

  /**
   * The harness session of a note and an agent, with the host's state of it. A session that is open stays.
   * Otherwise `setup` makes the options and the state of a new one, which continues the stored session of the
   * note and agent when the harness still has it. Two calls at once share one start, and so one setup.
   * `continued` is false only for a session that starts new, with none of the note's earlier exchange.
   * Each call restarts the idle wait, so the session stays open for the idle minutes after the call, and a turn
   * keeps it open until the turn ends. While the session is in a turn, the status bar shows the agent working
   * in the note, and `yami-stop` in the note interrupts the turn. `agent` is the name of an agent of the Yami;
   * default: the first. Rejects with `Yami has no agent named <name>. Agents: <names>.` or `Yami has no agents.`,
   * and, before a new session starts, with `There is no note at <path>.`
   * @example
   * const notes = yami.noteSessions({ setup: ({ file }) => { const live = new Reply(file); return { options: { tools: live.tools, skills: [] }, state: live, started: (s) => s.on(live.hear) }; } });
   * const { session, continued, state: live } = await notes.session(file.path, "claude");
   * await session.send(continued ? request : `${context}\n\n${request}`);
   */
  async session(path: string, agent?: string): Promise<NoteSession<State>> {
    if (this.#closed) throw new Error("Yami is turned off.");
    const name = agent ?? this.host.agents()[0]?.name;
    if (name === undefined) throw new Error("Yami has no agents.");
    this.#agent(name);
    let entries = this.#entries.get(path);
    if (!entries) this.#entries.set(path, (entries = new Map()));
    const entry = entries.get(name) ?? this.#entry(path, name);
    entries.set(name, entry);
    const before = entry.slot.live;
    const session = await entry.slot.open();
    return { session, continued: session === before || entry.slot.continued, state: this.#states.get(session) as State };
  }

  /** Closes the sessions of a note, and drops their ids, so the next session of the note starts new. */
  async forget(path: string): Promise<void> {
    const entries = this.#entries.get(path);
    this.#entries.delete(path);
    if (this.#ids[path]) {
      delete this.#ids[path];
      this.#save();
    }
    await Promise.all([...(entries?.values() ?? [])].map((entry) => entry.slot.close()));
  }

  /** Closes every session. Later calls of `session` reject. The plugin's unload calls it. */
  async close(): Promise<void> {
    this.#closed = true;
    const entries = [...this.#entries.values()].flatMap((each) => [...each.values()]);
    this.#entries.clear();
    await Promise.all(entries.map((entry) => entry.slot.close()));
  }

  /** Moves the ids and the sessions of a note, or of the notes of a folder, to the new path. */
  #renamed(from: string, to: string): void {
    let moved = false;
    for (const path of this.#under(from)) {
      const next = to + path.slice(from.length);
      const ids = this.#ids[path];
      if (ids) {
        delete this.#ids[path];
        this.#ids[next] = ids;
        moved = true;
      }
      const entries = this.#entries.get(path);
      if (entries) {
        this.#entries.delete(path);
        this.#entries.set(next, entries);
        for (const entry of entries.values()) entry.path = next;
      }
    }
    if (moved) this.#save();
  }

  /** Forgets a removed note, or the notes of a removed folder. */
  #removed(path: string): void {
    for (const each of this.#under(path)) void this.forget(each);
  }

  /** Closes, once idle, each session whose agent is gone or replaced; its next session starts with the agent of that name now. */
  #agentsChanged(): void {
    for (const entries of this.#entries.values()) for (const entry of entries.values()) entry.slot.refresh();
  }

  #under(path: string): string[] {
    const paths = new Set([...Object.keys(this.#ids), ...this.#entries.keys()]);
    return [...paths].filter((each) => each === path || each.startsWith(`${path}/`));
  }

  #agent(name: string): ConversationAgent {
    const agents = this.host.agents();
    const found = agents.find((candidate) => candidate.name === name);
    if (!found) throw new Error(agents.length ? `Yami has no agent named ${name}. Agents: ${agents.map((a) => a.name).join(", ")}.` : "Yami has no agents.");
    return found;
  }

  #entry(path: string, name: string): Entry {
    // The setup of the session that starts now: `options` and `started` run in turn for each start.
    let setup: NoteSessionSetup<State> | undefined;
    const entry: Entry = {
      path,
      slot: new SessionSlot({
        agent: () => this.#agent(name).agent,
        options: () => {
          const file = this.host.file(entry.path);
          if (!file) throw new Error(`There is no note at ${entry.path}.`);
          const note: NoteAgent = {
            get path() {
              return entry.path;
            },
            file,
            agent: name,
          };
          setup = this.options.setup?.(note);
          return setup?.options ?? {};
        },
        resume: () => this.#ids[entry.path]?.[name],
        record: (id) => {
          if (this.#ids[entry.path]?.[name] === id) return;
          (this.#ids[entry.path] ??= {})[name] = id;
          this.#save();
        },
        idleMinutes: () => {
          const minutes = this.options.idleMinutes;
          return minutes === undefined ? this.host.idleMinutes() : typeof minutes === "function" ? minutes() : minutes;
        },
        started: (session) => {
          this.#states.set(session, setup?.state as State);
          session.on((event) => {
            if (event.type === "turn-start") {
              entry.endWork?.();
              entry.endWork = this.host.addWork({
                name,
                get path() {
                  return entry.path;
                },
                stop: () => session.interrupt(),
              });
            } else if (event.type === "turn-end" || event.type === "closed") {
              entry.endWork?.();
              entry.endWork = undefined;
            }
          });
          setup?.started?.(session);
        },
      }),
    };
    return entry;
  }

  #save(): void {
    const save = this.options.save;
    if (!save) return;
    void Promise.resolve()
      .then(() => save(this.ids))
      .catch((error) => console.error("Yami: the host could not save the note sessions", error));
  }
}
