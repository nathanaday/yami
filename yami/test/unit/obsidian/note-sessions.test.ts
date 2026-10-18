import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({}));

import type { AgentSession } from "../../../src/agent/index.js";
import type { ConversationAgent } from "../../../src/obsidian/agents.js";
import { NoteSessions, type AgentWork, type NoteEvents, type NoteSessionsHost, type NoteSessionsOptions, type SessionIds } from "../../../src/obsidian/note-sessions.js";
import { ScriptedAgent } from "../../../src/testing/index.js";

beforeAll(() => {
  Object.assign(globalThis, { window: globalThis });
});

afterEach(() => {
  vi.useRealTimers();
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A host over agents that the test changes, with the work it records and the events it sends. */
function host(agents: ConversationAgent[], works: AgentWork[] = []) {
  const events: NoteEvents[] = [];
  const value: NoteSessionsHost = {
    agents: () => agents,
    idleMinutes: () => 15,
    addWork: (work) => {
      works.push(work);
      return () => works.splice(works.indexOf(work), 1);
    },
    follow: (each) => void events.push(each),
  };
  return { value, events };
}

/** A NoteSessions over agents that the test changes, with the work and the saves it records. */
function fixture<State = undefined>(ids: SessionIds = {}, options: NoteSessionsOptions<State> = {}) {
  const claude = new ScriptedAgent();
  const agents: ConversationAgent[] = [{ name: "claude", color: "#d97757", agent: claude }];
  const works: AgentWork[] = [];
  const saved: SessionIds[] = [];
  const { value, events } = host(agents, works);
  const notes = new NoteSessions<State>(value, { ids, save: (next) => void saved.push(next), ...options });
  // What the vault and setAgents tell the note sessions.
  const vault = events[0]!;
  return { claude, agents, works, saved, notes, vault };
}

/** A turn that runs until the test releases it. */
function heldTurn(agent: ScriptedAgent) {
  let release!: () => void;
  agent.queue(() => new Promise<void>((resolve) => (release = resolve)));
  return () => release();
}

describe("NoteSessions", () => {
  it("starts one session for a note and an agent, keeps it open, and saves its id", async () => {
    const tools = { name: "note", description: "The note's tools.", tools: [] };
    const { claude, notes, saved } = fixture({}, { setup: () => ({ options: { access: "read-only", tools, skills: [] } }) });
    const [first, second] = await Promise.all([notes.session("Ideas.md", "claude"), notes.session("Ideas.md")]);
    expect(first.continued).toBe(false);
    expect(second.session).toBe(first.session);
    expect(claude.started).toHaveLength(1);
    expect(claude.last!.options).toMatchObject({ access: "read-only", tools, skills: [] });
    expect(await notes.session("Ideas.md", "claude")).toEqual({ session: first.session, continued: true, state: undefined });
    await flush();
    expect(saved.at(-1)).toEqual({ "Ideas.md": { claude: first.session.id } });
    expect(notes.ids).toEqual(saved.at(-1));
  });

  it("continues the stored session when the harness has it, and starts a new one when it lost it", async () => {
    const { claude, notes } = fixture();
    const earlier = await claude.startSession();
    await earlier.close();
    const stored = new NoteSessions(host([{ name: "claude", color: "", agent: claude }]).value, { ids: { "Ideas.md": { claude: earlier.id } } });
    const resumed = await stored.session("Ideas.md");
    expect(resumed).toMatchObject({ continued: true, session: { id: earlier.id } });
    await stored.forget("Ideas.md");
    claude.forget();
    const lost = await new NoteSessions(host([{ name: "claude", color: "", agent: claude }]).value, { ids: { "Ideas.md": { claude: earlier.id } } }).session("Ideas.md");
    expect(lost.continued).toBe(false);
    expect(lost.session.id).not.toBe(earlier.id);
    await expect(notes.session("Ideas.md", "gemini")).rejects.toThrow("Yami has no agent named gemini. Agents: claude.");
  });

  it("follows a renamed note and folder, forgets a removed note, and forgets on request", async () => {
    const { notes, saved, vault } = fixture();
    const a = await notes.session("Projects/A.md");
    const b = await notes.session("B.md");
    vault.renamed("Projects", "Work");
    expect(Object.keys(notes.ids).sort()).toEqual(["B.md", "Work/A.md"]);
    expect(notes.ids["Work/A.md"]).toEqual({ claude: a.session.id });
    expect((await notes.session("Work/A.md")).session).toBe(a.session);
    vault.removed("B.md");
    await flush();
    expect(b.session.closed).toBe(true);
    expect(notes.ids["B.md"]).toBeUndefined();
    await notes.forget("Work/A.md");
    expect(a.session.closed).toBe(true);
    expect(notes.ids).toEqual({});
    await flush();
    expect(saved.at(-1)).toEqual({});
  });

  it("closes a session after the idle minutes with no turn, and the next one continues it", async () => {
    vi.useFakeTimers();
    const { claude, notes } = fixture();
    const first = await notes.session("Ideas.md");
    await first.session.send("Hello");
    vi.advanceTimersByTime(14 * 60_000);
    expect(first.session.closed).toBe(false);
    vi.advanceTimersByTime(60_000);
    await vi.runAllTimersAsync();
    expect(first.session.closed).toBe(true);
    const next = await notes.session("Ideas.md");
    expect(next).toMatchObject({ continued: true, session: { id: first.session.id } });
    expect(claude.started).toHaveLength(2);
  });

  it("shows a turn as work in the note until it ends, and its stop interrupts the turn", async () => {
    const { claude, notes, works, vault } = fixture();
    const { session } = await notes.session("Ideas.md");
    const release = heldTurn(claude);
    const turn = session.send("Hello");
    await flush();
    expect(works.map((work) => [work.name, work.path])).toEqual([["claude", "Ideas.md"]]);
    vault.renamed("Ideas.md", "Plans.md");
    expect(works[0]!.path).toBe("Plans.md");
    await works[0]!.stop!();
    expect(await turn).toMatchObject({ status: "interrupted" });
    expect(works).toEqual([]);
    release();
  });

  it("keeps a replaced agent's session until its turn ends, then closes it and starts the agent of that name now", async () => {
    const { claude, agents, notes, vault } = fixture();
    const { session } = await notes.session("Ideas.md");
    const release = heldTurn(claude);
    const turn = session.send("Hello");
    await flush();
    const replaced = new ScriptedAgent();
    agents[0] = { name: "claude", color: "#d97757", agent: replaced };
    vault.agentsChanged();
    expect((await notes.session("Ideas.md")).session).toBe(session);
    expect(session.closed).toBe(false);
    release();
    await turn;
    await flush();
    await flush();
    expect(session.closed).toBe(true);
    const next = await notes.session("Ideas.md");
    expect(replaced.started).toHaveLength(1);
    expect(replaced.last!.options.resume).toBeUndefined();
    expect(next.continued).toBe(false);
  });

  it("closes an idle session of a removed agent at once, and refuses the agent's name after", async () => {
    const { agents, notes, vault } = fixture();
    const { session } = await notes.session("Ideas.md");
    agents.splice(0, 1, { name: "codex", color: "#4f8cf7", agent: new ScriptedAgent() });
    vault.agentsChanged();
    await flush();
    expect(session.closed).toBe(true);
    await expect(notes.session("Ideas.md", "claude")).rejects.toThrow("Yami has no agent named claude. Agents: codex.");
    agents.length = 0;
    await expect(notes.session("Ideas.md")).rejects.toThrow("Yami has no agents.");
  });

  it("makes the options and the host's state once for each harness session, also for two calls at once", async () => {
    vi.useFakeTimers();
    const made: { path: string; heard: AgentSession[] }[] = [];
    const { claude, notes, vault } = fixture(
      {},
      {
        setup: (note) => {
          const state = { path: note.path, agent: note.agent, heard: [] as AgentSession[], note };
          made.push(state);
          return { options: { instructions: `Answer in ${note.path}.` }, state, started: (session) => state.heard.push(session) };
        },
      },
    );
    const [first, second] = await Promise.all([notes.session("Ideas.md"), notes.session("Ideas.md", "claude")]);
    expect(made).toHaveLength(1);
    expect(first.state).toBe(made[0]);
    expect(second.state).toBe(made[0]);
    expect(first.state).toMatchObject({ path: "Ideas.md", agent: "claude", heard: [first.session] });
    expect(claude.last!.options.instructions).toBe("Answer in Ideas.md.");
    vault.renamed("Ideas.md", "Plans.md");
    expect(first.state.note.path).toBe("Plans.md");
    expect((await notes.session("Plans.md")).state).toBe(made[0]);

    vi.advanceTimersByTime(15 * 60_000);
    await vi.runAllTimersAsync();
    expect(first.session.closed).toBe(true);
    const next = await notes.session("Plans.md");
    expect(made).toHaveLength(2);
    expect(next.state).toBe(made[1]);
    expect(next.state.heard).toEqual([next.session]);
    expect(claude.last!.options.instructions).toBe("Answer in Plans.md.");
  });

  it("rejects when setup or started throws, and leaves no session open", async () => {
    let fail: "setup" | "started" | undefined = "setup";
    const { claude, notes } = fixture(
      {},
      {
        setup: () => {
          if (fail === "setup") throw new Error("no setup");
          return {
            started: () => {
              if (fail === "started") throw new Error("no start");
            },
          };
        },
      },
    );
    await expect(notes.session("Ideas.md")).rejects.toThrow("no setup");
    expect(claude.started).toHaveLength(0);
    fail = "started";
    await expect(notes.session("Ideas.md")).rejects.toThrow("no start");
    expect(claude.last!.closed).toBe(true);
    fail = undefined;
    expect((await notes.session("Ideas.md")).session.closed).toBe(false);
  });

  it("restarts the idle wait at each call", async () => {
    vi.useFakeTimers();
    const { notes } = fixture();
    const { session } = await notes.session("Ideas.md");
    vi.advanceTimersByTime(10 * 60_000);
    expect((await notes.session("Ideas.md")).session).toBe(session);
    vi.advanceTimersByTime(14 * 60_000);
    expect(session.closed).toBe(false);
    vi.advanceTimersByTime(60_000);
    await vi.runAllTimersAsync();
    expect(session.closed).toBe(true);
  });

  it("copies the ids it gets, and gives save a new object at each change", async () => {
    const ids: SessionIds = { "Old.md": { claude: "s-old" } };
    const { notes, saved, vault } = fixture(ids);
    await notes.session("Ideas.md");
    await flush();
    vault.renamed("Ideas.md", "Plans.md");
    await flush();
    expect(ids).toEqual({ "Old.md": { claude: "s-old" } });
    expect(saved).toHaveLength(2);
    expect(saved[0]).not.toBe(saved[1]);
    expect(Object.keys(saved[0]!)).toEqual(["Old.md", "Ideas.md"]);
    expect(Object.keys(saved[1]!)).toEqual(["Old.md", "Plans.md"]);
  });

  it("closes every session when Yami closes, and refuses later calls", async () => {
    const { notes } = fixture();
    const { session } = await notes.session("Ideas.md");
    await notes.close();
    expect(session.closed).toBe(true);
    await expect(notes.session("Ideas.md")).rejects.toThrow("Yami is turned off.");
  });
});
