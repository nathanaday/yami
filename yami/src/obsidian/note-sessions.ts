import type { Agent, AgentSession, ResumedSession, SessionStart } from "../agent/index.js";
import type { ConversationAgent } from "./agents.js";

export interface SlotOptions {
  /** The agent of a session that starts now. */
  agent(): Agent;
  /** The options of a session that starts now, read when `open` starts it. */
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
  #turn = false;
  #closing: Promise<void> = Promise.resolve();
  readonly #holders = new Set<object>();
  #timer: number | undefined;

  constructor(private readonly slot: SlotOptions) {}

  /** The session when it is open, also in the middle of a turn. */
  get live(): AgentSession | undefined {
    return this.session && !this.session.closed ? this.session : undefined;
  }

  /** The open session, or a new one. A session in a turn stays, also when its agent is gone. */
  open(): Promise<AgentSession> {
    window.clearTimeout(this.#timer);
    const live = this.live;
    if (live && (this.#turn || this.#agent === this.#current())) return Promise.resolve(live);
    if (live) void this.close();
    // The call that starts the session gives its options; a call while it starts waits for the same session.
    this.starting ??= this.#start(this.slot.options()).finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  async #start(options: SessionStart): Promise<AgentSession> {
    // A session that closes must exit before the next one continues its conversation.
    await this.#closing;
    const agent = this.slot.agent();
    const { session, continued } = await agent.resumeOrStart({ ...options, resume: this.slot.resume() });
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
    this.slot.started?.(session);
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

export interface NoteSessionsOptions {
  /** The ids that the host stored, for example in its plugin data. Default: none. */
  ids?: SessionIds;
  /** Called with every id after each change: a session that starts, a rename, a removed note, or `forget`. The host stores them. */
  save?: (ids: SessionIds) => void | Promise<void>;
  /** Minutes with no turn after which a session's process closes. A function is read at each use. Default: the `idleMinutes` of `createYami`. */
  idleMinutes?: number | (() => number);
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

/** What `NoteSessions` needs of its Yami. */
export interface NoteSessionsHost {
  agents(): readonly ConversationAgent[];
  idleMinutes(): number;
  addWork(work: AgentWork): () => void;
}

interface Entry {
  path: string;
  readonly slot: SessionSlot;
  options: SessionStart;
  endWork?: () => void;
}

/**
 * The harness sessions of notes: one for each note and agent, for a plugin whose agents work in a note that
 * is not a conversation note. `ObsidianYami.noteSessions` makes one.
 */
export class NoteSessions {
  readonly #ids: SessionIds;
  readonly #entries = new Map<string, Map<string, Entry>>();
  #closed = false;

  constructor(
    private readonly host: NoteSessionsHost,
    private readonly options: NoteSessionsOptions = {},
  ) {
    this.#ids = structuredClone(options.ids ?? {});
  }

  /** The stored ids, as `save` last got them. */
  get ids(): SessionIds {
    return structuredClone(this.#ids);
  }

  /**
   * The harness session of a note and an agent. A session that is open stays, with the options it started
   * with. Otherwise a new one starts with `options`, and continues the stored session of the note and agent
   * when the harness still has it. `continued` is false only for a session that starts new, with none of the
   * note's earlier exchange. While the session is in a turn, the status bar shows the agent working in the
   * note, and `yami-stop` in the note interrupts the turn. `agent` is the name of an agent of the Yami;
   * default: the first. The session follows the note when it is renamed, and closes when it is removed.
   * @example
   * const { session, continued } = await notes.session(file.path, "claude", { instructions, access: "read-only", tools, skills: [] });
   * const turn = await session.send(continued ? request : `${context}\n\n${request}`);
   */
  async session(path: string, agent?: string, options: SessionStart = {}): Promise<ResumedSession> {
    if (this.#closed) throw new Error("Yami is turned off.");
    const name = agent ?? this.host.agents()[0]?.name;
    if (name === undefined) throw new Error("Yami has no agents.");
    this.#agent(name);
    let entries = this.#entries.get(path);
    if (!entries) this.#entries.set(path, (entries = new Map()));
    const entry = entries.get(name) ?? this.#entry(path, name);
    entries.set(name, entry);
    entry.options = options;
    const before = entry.slot.live;
    const session = await entry.slot.open();
    return { session, continued: session === before || entry.slot.continued };
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

  /** Moves the ids and the sessions of a note, or of the notes of a folder, to the new path. */
  renamed(from: string, to: string): void {
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
  removed(path: string): void {
    for (const each of this.#under(path)) void this.forget(each);
  }

  /** Closes, once idle, each session whose agent is gone or replaced; its next session starts with the agent of that name now. */
  agentsChanged(): void {
    for (const entries of this.#entries.values()) for (const entry of entries.values()) entry.slot.refresh();
  }

  /** Closes every session. Later calls of `session` reject. */
  async close(): Promise<void> {
    this.#closed = true;
    const entries = [...this.#entries.values()].flatMap((each) => [...each.values()]);
    this.#entries.clear();
    await Promise.all(entries.map((entry) => entry.slot.close()));
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
    const entry: Entry = {
      path,
      options: {},
      slot: new SessionSlot({
        agent: () => this.#agent(name).agent,
        options: () => entry.options,
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
        started: (session) =>
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
          }),
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
