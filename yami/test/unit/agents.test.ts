import { afterEach, describe, expect, it, vi } from "vitest";
import { readDocument } from "../../src/document/index.js";
import { YamiModule, type AgentReply } from "../../src/index.js";
import { review, ScriptedSession, testYami, type TestYami, type Turn } from "../../src/testing/index.js";
import { Hello } from "../fixtures/hello.js";

let t: TestYami | undefined;
afterEach(async () => {
  await t?.dispose();
  t = undefined;
});

/** Hello, with a read-only agent, an edit agent, and a flow that names both. */
class Team extends Hello {
  readonly id = "team";
  readonly reader = this.agent({ name: "reader", description: "Reads the greeting and reports it.", body: "Read the note that the task names, and report what it says." });
  readonly writer = this.agent({ name: "writer", description: "Writes the greeting note.", access: "edit", body: "Write the note that the task names." });
  readonly work = this.flow({ name: "work", description: "Work with agents.", agents: [this.reader, this.writer], promises: [this.note] });
  readonly quiet = this.flow({ name: "quiet", description: "Read-only work.", access: "read-only", promises: [this.note], maxIterations: 1 });
}

class Other extends YamiModule {
  readonly id = "other";
  readonly name = "Other";
  readonly helper = this.agent({ name: "helper", description: "Helps.", body: "Help with the task." });
}

async function fresh(name: string, flow: (m: Team) => Team["work"] = (m) => m.work) {
  const team = new Team();
  t = await testYami({ modules: [team, new Other()], threads: false });
  const session = await flow(team).create({ name, exact: true });
  return { ...t, team, session };
}

const names = (session: ScriptedSession) => session.options.tools?.tools.map((tool) => tool.name) ?? [];
const greet = (name: string) => t!.vault.write(`greetings/${name}.md`, `Hello, ${name}`);
const call = (session: ScriptedSession, agent: string, task: string) => session.tool("yami_agent", { agent, task });
const reply = (result: { text: string; isError: boolean }) => {
  expect(result.isError, result.text).toBe(false);
  return JSON.parse(result.text) as AgentReply;
};

describe("the agent tool", () => {
  it("runs a read-only agent in a fresh context on the caller's agent, records the run, and returns its final message", async () => {
    const { session, agent, vault } = await fresh("read");
    const results: { text: string; isError: boolean }[] = [];
    agent.queue(
      async (_prompt, worker) => {
        results.push(await call(worker, "reader", "Report what greetings/read.md says."));
        await greet("read");
      },
      () => ({ text: "The note says hello." }),
    );
    expect(await session.start()).toMatchObject({ state: "done", iterations: 1 });

    const [worker, child] = agent.started;
    expect(agent.started).toHaveLength(2);
    expect(reply(results[0]!)).toEqual({ agent: "team:reader", conversation: "conversations/team read reader.md", message: "The note says hello." });
    expect(worker!.prompts[0]).toContain(
      "## Agents\n\nThe agents of this session. Each works in a fresh context, with its own brief, and returns its final message. To run one, call the tool `yami_agent` with its name and a task that holds everything it needs. Several can run at the same time.\n\n- `reader`: Reads the greeting and reports it. It is read-only.\n- `writer`: Writes the greeting note. It can edit files.",
    );
    expect(child!.id).not.toBe(worker!.id);
    expect(child!.options.access).toBe("read-only");
    expect(child!.options.approval).toBe("accept-edits");
    expect(child!.options.skills).toEqual(worker!.options.skills);
    expect(child!.options.cwd).toBe(t!.root);
    expect(names(child!)).toEqual(["yami_check", "wiki_search", "wiki_match", "wiki_lint", "wiki_tags", "wiki_neighbors", "wiki_chunks"]);
    const [prompt] = child!.prompts;
    expect(prompt).toMatch(/^You are the agent "team:reader" of Yami: Reads the greeting and reports it\.\n\nA caller gave you the task below\. You work in a fresh context/);
    expect(prompt).toContain("You are read-only: change no file. You can run commands that only read or check, such as git log or the tests.");
    expect(prompt).toContain("## Brief\n\nRead the note that the task names, and report what it says.\n\n## Task\n\nReport what greetings/read.md says.");
    const note = await readDocument(vault, "conversations/team read reader.md");
    expect(note.properties).toMatchObject({ type: "conversation", agent: "claude", access: "read-only", module: "[[team/read|read]]" });
    expect(note.body).toContain("The note says hello.");
  });

  it("runs an edit agent with every tool but the agent tool, so agents do not nest", async () => {
    const { session, agent } = await fresh("edit");
    const nested: unknown[] = [];
    agent.queue(
      async (_prompt, worker) => {
        reply(await call(worker, "writer", "Write greetings/edit.md."));
      },
      async (_prompt, child) => {
        await greet("edit");
        nested.push(await call(child, "reader", "Read it.").catch((error: Error) => error.message));
        return { text: "Written." };
      },
    );
    expect(await session.start()).toMatchObject({ state: "done", iterations: 1 });
    const child = agent.started[1]!;
    expect(child.options.access).toBe("edit");
    expect(names(child)).toContain("wiki_change");
    expect(names(child)).toContain("team_greet_user");
    expect(names(child)).not.toContain("yami_agent");
    expect(names(agent.started[0]!)).toContain("yami_agent");
    expect(nested).toEqual(["The session has no tool yami_agent."]);
    expect(child.prompts[0]).not.toContain("You are read-only");
  });

  it("runs two agents at the same time, each with a conversation note of its own", async () => {
    const { session, agent } = await fresh("both");
    let begun = 0;
    let both!: () => void;
    const together = new Promise<void>((resolve) => (both = resolve));
    // Each agent's turn waits until both have begun, so the test ends only if they run at the same time.
    const meet = (text: string): Turn => async () => {
      if (++begun === 2) both();
      await together;
      return { text };
    };
    const replies: AgentReply[] = [];
    agent.queue(
      async (_prompt, worker) => {
        replies.push(...(await Promise.all([call(worker, "reader", "First."), call(worker, "reader", "Second.")])).map(reply));
        await greet("both");
      },
      meet("one"),
      meet("two"),
    );
    expect(await session.start()).toMatchObject({ state: "done" });
    expect(replies.map((r) => r.conversation).sort()).toEqual(["conversations/team both reader 2.md", "conversations/team both reader.md"]);
    expect(replies.map((r) => r.message).sort()).toEqual(["one", "two"]);
  });

  it("stops the agents when the caller's run stops, and when it is killed", async () => {
    for (const end of ["stop", "kill"] as const) {
      const { session, agent } = await fresh(end);
      let begin!: () => void;
      const begun = new Promise<void>((resolve) => (begin = resolve));
      let answered!: (result: { text: string; isError: boolean }) => void;
      const answer = new Promise<{ text: string; isError: boolean }>((resolve) => (answered = resolve));
      agent.queue(
        async (_prompt, worker) => {
          answered(await call(worker, "reader", "Wait."));
        },
        () => {
          begin();
          return new Promise(() => undefined);
        },
      );
      const run = session.start();
      await begun;
      await session[end]();
      expect(await run).toMatchObject({ state: "stopped" });
      expect(await answer).toEqual({ isError: true, text: `The agent team:reader was stopped. Its conversation note: conversations/team ${end} reader.md.` });
      expect((await session.details()).agentRuns).toEqual([{ agent: "team:reader", conversation: `conversations/team ${end} reader.md`, status: "stopped" }]);
      const child = agent.started[1]!;
      expect(child.closed).toBe(true);
      await t!.dispose();
      t = undefined;
    }
  });

  it("records each run of a session in its Progress section, and lists the runs in its details with their agent, note, and status", async () => {
    const { session, agent, vault } = await fresh("runs");
    const during: unknown[] = [];
    agent.queue(
      async (_prompt, worker) => {
        reply(await call(worker, "reader", "First."));
        await call(worker, "reader", "Second.");
        await greet("runs");
      },
      () => ({ text: "One." }),
      async () => {
        during.push((await session.details()).agentRuns);
        return { status: "failed", error: "boom" };
      },
    );
    expect(await session.start()).toMatchObject({ state: "done" });
    const first = { agent: "team:reader", conversation: "conversations/team runs reader.md" };
    const second = { agent: "team:reader", conversation: "conversations/team runs reader 2.md" };
    expect(during).toEqual([[{ ...first, status: "done" }, { ...second, status: "working" }]]);
    const details = await session.details();
    expect(details.agentRuns).toEqual([{ ...first, status: "done" }, { ...second, status: "failed" }]);
    expect(details.progress.map((p) => p.text)).toEqual([
      "agent team:reader started: [[conversations/team runs reader|team runs reader]]",
      "agent team:reader done: [[conversations/team runs reader|team runs reader]]",
      "agent team:reader started: [[conversations/team runs reader 2|team runs reader 2]]",
      "agent team:reader failed: [[conversations/team runs reader 2|team runs reader 2]] — boom",
      "iteration 1: 1 met, 0 unmet",
    ]);

    // A run that started and recorded no end, for example when the app quit, reads as stopped.
    await vault.write(session.path, (await vault.read(session.path)).replace(/\n- \d\d:\d\d agent team:reader failed: .*\n/, "\n"));
    expect((await session.details()).agentRuns).toEqual([{ ...first, status: "done" }, { ...second, status: "stopped" }]);
  });

  it("records a run's end before its harness exits, and returns once it has", async () => {
    const { session, agent } = await fresh("slow");
    const close = ScriptedSession.prototype.close;
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let pending = 0;
    vi.spyOn(ScriptedSession.prototype, "close").mockImplementation(async function (this: ScriptedSession) {
      pending += 1;
      await released;
      return close.call(this);
    });
    let returned = false;
    agent.queue(
      async (_prompt, worker) => {
        reply(await call(worker, "reader", "Report."));
        returned = true;
        await greet("slow");
      },
      () => ({ text: "Done." }),
    );
    const run = session.start({ maxIterations: 1 });
    try {
      await vi.waitFor(() => expect(pending).toBe(1));
      const conversation = "conversations/team slow reader.md";
      await vi.waitFor(async () => expect((await session.details()).agentRuns).toEqual([{ agent: "team:reader", conversation, status: "done" }]));
      expect(returned).toBe(false);
    } finally {
      release();
      vi.restoreAllMocks();
    }
    expect(await run).toMatchObject({ state: "done" });
    expect(returned).toBe(true);
  });

  it("returns the agents the caller can name for a name that finds none", async () => {
    const { session, agent } = await fresh("unknown");
    const results: { text: string; isError: boolean }[] = [];
    agent.queue(async (_prompt, worker) => {
      results.push(await call(worker, "nobody", "Anything."), await call(worker, "missing:helper", "Anything."), await call(worker, "Not A Name", "Anything."));
      await greet("unknown");
    });
    expect(await session.start()).toMatchObject({ state: "done" });
    const list = "The agents: reader, writer, other:helper.";
    expect(results).toEqual([
      { isError: true, text: `No agent is named "nobody". ${list}` },
      { isError: true, text: `No agent is named "missing:helper". ${list}` },
      { isError: true, text: `No agent is named "Not A Name". ${list}` },
    ]);
    expect(agent.started).toHaveLength(1);
  });

  it("runs another module's agent by <module>:<name>, and from a conversation, which has no module", async () => {
    const { session, agent } = await fresh("across");
    const results: { text: string; isError: boolean }[] = [];
    agent.queue(
      async (_prompt, worker) => {
        results.push(await call(worker, "other:helper", "Help."));
        await greet("across");
      },
      () => ({ text: "Helped." }),
    );
    expect(await session.start()).toMatchObject({ state: "done" });
    expect(reply(results[0]!)).toMatchObject({ agent: "other:helper", conversation: "conversations/team across other helper.md", message: "Helped." });

    // A conversation's agent has the tools that the Yami gave it.
    const conversation = await agent.startSession();
    agent.queue(
      async (_prompt, own) => {
        results.push(await call(own, "helper", "Help."), await call(own, "team:reader", "Read."));
      },
      () => ({ text: "Read." }),
    );
    await conversation.send("Ask the reader.");
    expect(results[1]).toEqual({ isError: true, text: 'No agent is named "helper". A conversation has no module, so name an agent as <module>:<name>. The agents: other:helper, team:reader, team:writer.' });
    expect(reply(results[2]!)).toMatchObject({ agent: "team:reader", conversation: "conversations/team reader.md", message: "Read." });
    const note = await readDocument(t!.vault, reply(results[2]!).conversation);
    expect(note.properties.module).toBeUndefined();
  });

  it("refuses an edit agent of a read-only caller, an agent whose document is not valid, and says when an agent fails", async () => {
    const { session, agent, vault } = await fresh("limits", (m) => m.quiet);
    await vault.write("internal/team/agents/broken/AGENT.md", "---\nname: broken\ndescription: Broken.\naccess: admin\n---\nBrief.\n");
    const results: { text: string; isError: boolean }[] = [];
    agent.queue(
      async (_prompt, worker) => {
        results.push(await call(worker, "writer", "Write."), await call(worker, "broken", "Run."), await call(worker, "reader", "Read."));
      },
      () => ({ status: "failed", error: "boom" }),
    );
    await session.start();
    expect(results).toEqual([
      { isError: true, text: "The agent writer edits files, and its caller is read-only. Call a read-only agent." },
      { isError: true, text: "The agent broken cannot run: in internal/team/agents/broken/AGENT.md, access must be one of edit, read-only." },
      { isError: true, text: "The agent team:reader failed: boom. Its conversation note: conversations/team limits reader.md." },
    ]);
  });
});

describe("names of forms", () => {
  it("resolve in the session's module, and as <module>:<name> in another, when a person types them", async () => {
    class Brief extends YamiModule {
      readonly id = "brief";
      readonly name = "Brief";
      readonly short = this.policy({ name: "short", description: "Short lines.", body: "Keep each line short." });
    }
    const team = new Team();
    t = await testYami({ modules: [team, new Brief()], threads: false });
    const session = await team.work.create({ name: "typed" });
    const path = session.path;
    await t.vault.write(path, (await t.vault.read(path)).replace('agents:\n  - "[[internal/team/agents/reader/AGENT|reader]]"', "agents:\n  - reader").replace("policies: []", "policies:\n  - brief:short\n  - always-say-hello"));
    const details = await session.details();
    expect(details.documents.map((d) => [d.kind, d.target, d.path])).toEqual([
      ["promises", "internal/team/promises/greeting-note/PROMISE", "internal/team/promises/greeting-note/PROMISE.md"],
      ["policies", "brief:short", "internal/brief/policies/short/POLICY.md"],
      ["policies", "always-say-hello", "internal/team/policies/always-say-hello/POLICY.md"],
      ["agents", "reader", "internal/team/agents/reader/AGENT.md"],
      ["agents", "internal/team/agents/writer/AGENT", "internal/team/agents/writer/AGENT.md"],
    ]);
    t.agent.queue(() => greet("typed"), review());
    expect(await session.start()).toMatchObject({ state: "done" });
    expect(t.agent.started[0]!.prompts[0]).toContain("- `reader`: Reads the greeting and reports it.");
    expect(t.agent.started[1]!.prompts[0]).toContain("### short\n\nPath: internal/brief/policies/short/POLICY.md");
  });

  it("stop a run before it starts when they find nothing", async () => {
    const team = new Team();
    t = await testYami({ modules: [team], threads: false });
    const session = await team.work.create({ name: "lost" });
    await t.vault.write(session.path, (await t.vault.read(session.path)).replace("policies: []", "policies:\n  - nowhere:short"));
    await expect(session.start()).rejects.toThrow('The session links to policies "nowhere:short", which is not in the vault.');
  });
});
