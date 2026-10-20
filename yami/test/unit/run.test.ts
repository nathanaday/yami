import { afterEach, describe, expect, it, vi } from "vitest";
import { runTool } from "../../src/agent/index.js";
import { FileConversations } from "../../src/conversation/index.js";
import { link, parseDocument, readDocument } from "../../src/document/index.js";
import { Yami, YamiModule, type RunResult, type Session, type SessionStatus } from "../../src/index.js";
import { review, ScriptedAgent, ScriptedSession, testYami, type TestYami, type Turn } from "../../src/testing/index.js";
import { Hello } from "../fixtures/hello.js";

let t: TestYami | undefined;
afterEach(async () => {
  await t?.dispose();
  t = undefined;
});

async function fresh(name: string, module: Hello = new Hello(), turns: Turn[] = []) {
  t = await testYami({ modules: [module], turns });
  const session = await module.greet.create({ name, exact: true });
  return { ...t, module, session, path: session.path };
}

const write = (name: string) => () => t!.vault.write(`greetings/${name}.md`, `Hello, ${name}`);
/** A turn that runs until something stops it, and the promise that it began. */
function hold(): { turn: Turn; begun: Promise<void> } {
  let begin!: () => void;
  const begun = new Promise<void>((resolve) => (begin = resolve));
  return {
    turn: () => {
      begin();
      return new Promise(() => undefined);
    },
    begun,
  };
}

describe("a run of the agent loop", () => {
  it("meets the promise on the second iteration and records both", async () => {
    const { session, vault, agent, path } = await fresh("second");
    agent.queue(() => {}, write("second"), review());
    const result = await session.start();
    expect(result).toMatchObject({ state: "done", iterations: 2 });
    expect(result.reason).toBeUndefined();
    const [first, second] = agent.started[0]!.prompts;
    expect(first).toContain('This is the Yami session "second", a "greet" session of the module "Hello world". The session document is hello/second.md.');
    expect(first).toContain("## Policies");
    expect(first).toContain("## Promises");
    expect(first).toContain("- greeting: Hello");
    // The README quotes this text, so a host or a test can tell check feedback in a conversation record.
    expect(second).toBe("Yami checked the promises after your last turn.\n\n- greeting-note: unmet, no file at greetings/second.md\n\nMeet the unmet promises. Follow the policies.");
    const doc = await vault.read(path);
    expect(doc).toContain("iteration 1: 0 met, 1 unmet");
    expect(doc).toContain("iteration 2: 1 met, 0 unmet");
    expect(doc).toContain("iteration 2: review: 1 followed, 0 broken");
    expect(doc).toContain("- [x] [[internal/hello/promises/greeting-note/PROMISE|greeting-note]]");
    expect(doc).toContain("state: done");
    expect(doc).toContain('conversation: "[[conversations/hello second|hello second]]"');
    const record = await vault.read(result.conversation!);
    expect(result.conversation).toBe("conversations/hello second.md");
    expect(record).toMatch(/^---\ntype: conversation\nagent: claude\n/);
    expect(record).toContain("session: scripted-1");
    expect(record).toContain('module: "[[hello/second|second]]"');
    expect(record.match(/> \[!user\]/g)).toHaveLength(2);
    expect(record.trim().endsWith("ok")).toBe(true);
  });

  it("invokes the base skill by command, and lists the session's skills to load, since the Yami gives its agents the skill sets", async () => {
    const { session, agent } = await fresh("invoked");
    agent.queue(write("invoked"), review());
    await session.start();
    const [first] = agent.started[0]!.prompts;
    expect(first!.startsWith('/yami:run This is the Yami session "invoked"')).toBe(true);
    expect(first).toContain("Load the first one now, and the others when you need them.");
    expect(first).toContain("- `hello:greeting`: How to greet a person or a session by name. Its folder: internal/hello/skills/greeting/");
    expect(first).not.toContain("Keep it to one line");
    expect(first).not.toContain("Check the work before the turn ends");
  });

  it("inlines a skill for an agent that does not have the module's skill set", async () => {
    const { session } = await fresh("inlined");
    const outside = new ScriptedAgent([write("inlined")]);
    await session.start({ agent: outside });
    const [first] = outside.started[0]!.prompts;
    expect(first!.startsWith("## How to run a Yami session\n\n# Run a Yami session")).toBe(true);
    expect(first).toContain("Check the work before the turn ends");
    expect(first).toContain("## Skills\n\n### greeting\n\n# Greeting");
    expect(first).toContain("Keep it to one line");
  });

  it("opens the conversation with the flow's access and adds its instructions", async () => {
    class Quiet extends Hello {
      readonly id = "quiet";
      readonly sessionsIn = "internal";
      readonly instructions = "Module instructions.";
      readonly hush = this.flow({ name: "hush", description: "Quiet.", access: "read-only", instructions: "Flow instructions.", promises: [this.note], maxIterations: 1 });
    }
    const quiet = new Quiet();
    t = await testYami({ modules: [quiet] });
    const session = await quiet.hush.create({ name: "hidden" });
    expect(session.path).toBe("internal/quiet/sessions/hidden.md");
    await session.start();
    expect(t.agent.last!.options.access).toBe("read-only");
    expect(t.agent.last!.prompts[0]).toContain("Module instructions.\n\nFlow instructions.");
    expect(await t.vault.read("conversations/quiet hidden.md")).toContain("access: read-only");
  });

  it("needs attention when the iterations run out, by the flow's count or the run's", async () => {
    const { session, vault, path } = await fresh("never");
    expect(await session.start()).toMatchObject({ state: "needs-attention", iterations: 3, reason: "iteration 3: 0 met, 1 unmet" });
    expect(await session.start({ maxIterations: 1 })).toMatchObject({ state: "needs-attention", iterations: 1, reason: "iteration 4: 0 met, 1 unmet" });
    const doc = await vault.read(path);
    expect(doc).toContain("state: needs-attention");
    expect(doc).toContain("iteration: 4");
    expect(doc).toContain('unmet:\n  - "[[internal/hello/promises/greeting-note/PROMISE|greeting-note]]"');
  });

  it("needs attention when the reviewer gives no verdict on a promise with no check", async () => {
    class Manual extends Hello {
      readonly id = "manual";
      readonly judged = this.promise({ name: "judged", description: "A person decides.", body: "A person decides." });
      readonly judge = this.flow({ name: "judge", description: "Judged.", promises: [this.judged] });
    }
    const manual = new Manual();
    t = await testYami({ modules: [manual] });
    const session = await manual.judge.create({ name: "manual" });
    expect(await session.start()).toMatchObject({ state: "needs-attention", iterations: 1, reason: "iteration 1: review: 0 met, 0 unmet; no verdict on judged" });
    const doc = await t.vault.read(session.path);
    expect(doc).toContain("iteration 1: 0 met, 0 unmet");
    expect(doc).toContain("iteration 1: review: 0 met, 0 unmet; no verdict on judged");
    expect(doc).toContain("- no verdict: [[internal/manual/promises/judged/PROMISE|judged]]");
  });

  it("fails when the harness fails", async () => {
    const { session, vault, path } = await fresh("broken", new Hello(), [() => ({ status: "failed", error: "boom" })]);
    expect(await session.start()).toMatchObject({ state: "failed", reason: "iteration 1: turn failed: boom" });
    const doc = await vault.read(path);
    expect(doc).toContain("state: failed");
    expect(doc).toContain("iteration 1: turn failed: boom");
    expect(await session.status()).toBe("failed");
  });

  it("fails when Yami's own code throws, and the reason names the error and where it was thrown", async () => {
    const { session, vault, path, yami } = await fresh("faulty");
    yami.openConversation = async () => {
      throw new TypeError("no conversations");
    };
    const result = await session.start();
    expect(result.state).toBe("failed");
    expect(result.reason).toMatch(/^failed: TypeError: no conversations \(at .*\(run\.test\.ts:\d+:\d+\)\)$/);
    expect(await vault.read(path)).toContain(result.reason);
  });

  it("continues the iteration count on a later run", async () => {
    const { session, vault, path, agent } = await fresh("again");
    await session.start({ maxIterations: 1 });
    agent.queue(write("again"), review());
    expect((await session.start({ maxIterations: 1 })).state).toBe("done");
    const doc = await vault.read(path);
    expect(doc).toContain("iteration: 2");
    expect(doc).toContain("iteration 2:");
  });

  it("runs a module's own check before the core check of the same name", async () => {
    class Own extends Hello {
      readonly id = "own";
      readonly checks = { exists: async () => ({ status: "met" as const, detail: "the module's own check" }) };
    }
    const { session, vault, path } = await fresh("own", new Own(), [() => {}, review()]);
    expect((await session.start({ maxIterations: 1 })).state).toBe("done");
    expect(await vault.read(path)).toContain("the module's own check");
  });

  it("writes a check's detail on the one line of its deliverable, also a detail with a heading line", async () => {
    class Own extends Hello {
      readonly id = "own";
      readonly checks = { exists: async () => ({ status: "met" as const, detail: "first\n## Progress\nlast" }) };
    }
    const { session, vault, path } = await fresh("own", new Own(), [() => {}, review()]);
    expect((await session.start({ maxIterations: 1 })).state).toBe("done");
    expect(await vault.read(path)).toContain("— first ## Progress last\n");
  });

  it("refuses a document that is no session, of a module the Yami lacks, or naming a flow the module lacks", async () => {
    const { yami, vault } = await fresh("x");
    await vault.write("plain.md", "No properties.\n");
    await vault.write("hello/lost.md", "---\ntype: session\nmodule: gone\n---\n");
    await vault.write("hello/odd.md", "---\ntype: session\nmodule: hello\nflow: missing\n---\n");
    await expect(yami.session("plain.md").start()).rejects.toThrow("plain.md is not a session document.");
    await expect(yami.session("hello/lost.md").start()).rejects.toThrow('of the module "gone", which this Yami does not have');
    await expect(yami.session("hello/odd.md").start()).rejects.toThrow('names the flow "missing"');
  });
});

describe("the status of a session", () => {
  it("is open, then working and checking while the run is live, then the state the run ends in", async () => {
    const { session, yami, agent } = await fresh("watched");
    const seen: SessionStatus[] = [];
    const all: string[] = [];
    session.on((status) => seen.push(status));
    yami.onSession((s, status) => all.push(`${s.path} ${status}`));
    expect(await session.status()).toBe("open");
    agent.queue(async () => {
      expect(session.running).toBe(true);
      expect(yami.running).toEqual([session]);
      expect(await session.status()).toBe("working");
    }, write("watched"), review());
    await session.start();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(seen).toEqual(["working", "checking", "working", "checking", "reviewing", "done"]);
    expect(all.at(-1)).toBe("hello/watched.md done");
    expect(session.running).toBe(false);
    expect(yami.running).toEqual([]);
    expect(await session.status()).toBe("done");
  });

  it("reads a document left running with no live run as stopped", async () => {
    const { session, vault, path } = await fresh("crashed");
    const doc = await readDocument(vault, path);
    await vault.write(path, (await vault.read(path)).replace("state: open", "state: running"));
    expect(doc.properties.state).toBe("open");
    expect(await session.status()).toBe("stopped");
  });

  it("refuses a second run while one is live", async () => {
    const { session, agent } = await fresh("busy");
    const { turn, begun } = hold();
    agent.queue(turn);
    const run = session.start();
    await begun;
    await expect(session.start()).rejects.toThrow("hello/busy.md is running.");
    await session.stop();
    expect((await run).state).toBe("stopped");
  });
});

describe("stop, kill, and resume", () => {
  it("sends no turn when a stop comes while the conversation opens", async () => {
    t = await testYami();
    const agent = new ScriptedAgent();
    let open!: () => void;
    const opened = new Promise<void>((resolve) => (open = resolve));
    let opening!: () => void;
    const asked = new Promise<void>((resolve) => (opening = resolve));
    const files = new FileConversations(t.vault);
    const yami = new Yami({ vault: t.vault, agents: [agent], modules: [new Hello()], conversations: { open: async (options) => (opening(), await opened, files.open(options)) } });
    await yami.enable();
    const session = await (yami.module("hello") as Hello).greet.create({ name: "early" });
    const run = session.start();
    await asked;
    const stopped = session.stop();
    open();
    await stopped;
    expect(await run).toMatchObject({ state: "stopped", iterations: 0 });
    expect(agent.started[0]!.prompts).toEqual([]);
    await yami.close();
  });

  it("stops a turn and records it; a resume checks first, then continues the same conversation", async () => {
    const { session, vault, path, agent } = await fresh("paused");
    const { turn, begun } = hold();
    agent.queue(turn);
    const run = session.start();
    await begun;
    await session.stop();
    const stopped = await run;
    expect(stopped).toMatchObject({ state: "stopped", iterations: 1 });
    expect(await session.status()).toBe("stopped");
    expect(await vault.read(path)).toContain("iteration 1: 0 met, 1 unmet; stopped");

    agent.queue(write("paused"), review());
    const resumed = await session.resume();
    expect(resumed).toMatchObject({ state: "done", iterations: 1, conversation: stopped.conversation });
    expect(agent.started).toHaveLength(3);
    expect(agent.started[1]!.id).toBe(agent.started[0]!.id);
    expect(agent.started[1]!.prompts[0]).toMatch(/^Yami checked the promises/);
    const record = await vault.read(stopped.conversation!);
    expect(record.match(/> \[!user\]/g)).toHaveLength(2);
    expect(record).toContain("status: active");
  });

  it("kills the agent at once, and the run ends stopped", async () => {
    const { session, vault, path, agent } = await fresh("killed");
    const { turn, begun } = hold();
    agent.queue(turn);
    const run = session.start();
    await begun;
    await session.kill();
    expect((await run).state).toBe("stopped");
    expect(agent.last!.closed).toBe(true);
    expect(await vault.read(path)).toContain("state: stopped");
    expect(await session.status()).toBe("stopped");
  });

  it("ends a resume with no worker turn when the work is done already, as by the person's own hand, once the review passes", async () => {
    const { session, vault, path, agent } = await fresh("by-hand");
    await session.start({ maxIterations: 1 });
    await write("by-hand")();
    agent.queue(review());
    expect(await session.resume()).toMatchObject({ state: "done", iterations: 0 });
    expect(agent.started).toHaveLength(2);
    expect(agent.last!.options.access).toBe("read-only");
    const doc = await vault.read(path);
    expect(doc).toContain("resumed: 1 met, 0 unmet");
    expect(doc).toContain("resumed: review: 1 followed, 0 broken");
  });

  it("starts a session with no conversation when asked to resume it", async () => {
    const { session, agent } = await fresh("never-ran");
    agent.queue(write("never-ran"), review());
    expect(await session.resume()).toMatchObject({ state: "done", iterations: 1 });
    expect(agent.started[0]!.prompts[0]).toContain("This is the Yami session");
  });

  it("ends stopped when the person interrupts the turn in the conversation", async () => {
    const { session, agent } = await fresh("interrupted");
    const { turn, begun } = hold();
    agent.queue(turn);
    const run = session.start();
    await begun;
    await agent.last!.interrupt();
    expect((await run).state).toBe("stopped");
  });
});

/** Holds every conversation's close until `release`, as a harness that is slow to exit does. */
function slowClose() {
  const close = ScriptedSession.prototype.close;
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let pending = 0;
  const spy = vi.spyOn(ScriptedSession.prototype, "close").mockImplementation(async function (this: ScriptedSession) {
    pending += 1;
    await released;
    pending -= 1;
    return close.call(this);
  });
  return { release: () => (release(), spy.mockRestore()), pending: () => pending };
}

describe("the end of a run", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is one step for a host: when the document records stopped, done, or failed, the run is not live, and the harness closes after", async () => {
    const ends: Record<string, (session: Session, agent: ScriptedAgent) => Promise<void>> = {
      stopped: async (session, agent) => {
        const { turn, begun } = hold();
        agent.queue(turn);
        void session.start();
        await begun;
        void session.stop();
      },
      done: async (session, agent) => {
        agent.queue(write("done"), review());
        void session.start({ maxIterations: 1 });
      },
      failed: async (session, agent) => {
        agent.queue(() => ({ status: "failed", error: "boom" }));
        void session.start();
      },
    };
    for (const [end, begin] of Object.entries(ends)) {
      const { session, vault, path, yami, agent } = await fresh(end);
      const closes = slowClose();
      const seen: Record<string, unknown> = {};
      let recorded!: () => void;
      const ended = new Promise<void>((resolve) => (recorded = resolve));
      const vaultWrite = vault.write.bind(vault);
      vault.write = async (file, text) => {
        const ending = file === path && text.includes(`state: ${end}`);
        if (ending) seen.before = { running: yami.running.length, status: await session.status() };
        await vaultWrite(file, text);
        if (!ending) return;
        seen.after = {
          running: yami.running.length,
          status: await session.status(),
          acts: session.acts(parseDocument(vault, path, text).properties).map((act) => act.kind),
        };
        recorded();
      };
      try {
        await begin(session, agent);
        await ended;
        expect(seen.before, end).toEqual({ running: 0, status: end });
        expect(seen.after, end).toEqual({ running: 0, status: end, acts: ["start", "resume"] });
        // The harness exits after the end: the run is not live while it closes.
        await vi.waitFor(() => expect(closes.pending()).toBeGreaterThan(0));
        expect(yami.running, end).toEqual([]);
        expect(await session.status(), end).toBe(end);
      } finally {
        closes.release();
      }
      await t!.dispose();
      t = undefined;
    }
  });

  it("starts a new run, and resolves a kill, only once the last run's harness closed", async () => {
    const { session, agent } = await fresh("next");
    const closes = slowClose();
    agent.queue(() => ({ status: "failed", error: "boom" }));
    const first = session.start();
    let second: Promise<RunResult>;
    try {
      await vi.waitFor(() => expect(closes.pending()).toBe(1));
      expect(session.running).toBe(false);
      let killed = false;
      void session.kill().then(() => (killed = true));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(killed).toBe(false);
      agent.queue(write("next"), review());
      second = session.start();
      expect(session.running).toBe(true);
      expect(agent.started).toHaveLength(1);
    } finally {
      closes.release();
    }
    expect((await first).state).toBe("failed");
    expect((await second).state).toBe("done");
    expect(agent.started).toHaveLength(3);
  });
});

describe("the wiki, built in", () => {
  it("ingests a file into a session that ends done when the agent proposes its change with wiki_change, and a rejection unmets it with the reason", async () => {
    t = await testYami();
    const { yami, vault, agent } = t;
    await vault.write("Notes/Darts.md", "# Darts\n\nA dart takes in fullness at the bust.\n");
    const session = await yami.ingest({ files: ["Notes/Darts.md"] });
    expect(session.path).toMatch(/^internal\/wiki\/sessions\/Ingest Darts \d{4}-\d\d-\d\d\.md$/);
    const source = (await readDocument(vault, session.path)).properties.sources as string[];
    expect(source).toEqual(["[[wiki/sources/Darts (source)|Darts (source)]]"]);
    const sourcePath = "wiki/sources/Darts (source).md";
    agent.queue(async () => {
      const change = agent.last!.options.tools!.tools.find((tool) => tool.name === "wiki_change")!;
      const result = await runTool(
        change,
        {
          title: "Ingest darts",
          session: session.path,
          writes: [
            {
              op: "create",
              path: "wiki/topics/Dart.md",
              properties: { description: "A fold sewn into fabric to shape it.", sources: [link(sourcePath)] },
              body: `## Definition\n\nA dart takes in fullness ([[${sourcePath.slice(0, -3)}|Darts]]). Drafted in [[${session.path.slice(0, -3)}|its session]].`,
            },
            { op: "modify", path: sourcePath, properties: { description: "Notes on darts.", status: "absorbed" }, body: "[[Notes/Darts|Darts]]\n\n## Summary\n\nDarts.\n" },
          ],
        },
        new AbortController().signal,
      );
      if (result.isError) throw new Error(result.text);
    }, review());
    const result = await session.start({ maxIterations: 2 });
    const doc = await vault.read(session.path);
    expect(result, doc).toMatchObject({ state: "done", iterations: 1 });
    // The two code checks judge the proposal; clean-topics has no check, so the review judges it.
    expect(doc).toContain("iteration 1: 2 met, 0 unmet");
    expect(doc).toContain("iteration 1: review: 3 followed, 0 broken, 1 met, 0 unmet");
    expect(doc).toContain("change-applied]] — 1 change(s) of the session stand: proposed");
    expect(agent.started[0]!.options.access).toBe("read-only");

    // The wiki holds nothing until a person approves the change.
    expect(await vault.exists("wiki/topics/Dart.md")).toBe(false);
    const [change] = await yami.wiki.changes();
    expect(change).toMatchObject({ title: "Ingest darts", status: "proposed", session: session.path, module: "wiki", creates: 1, modifies: 1 });
    await yami.wiki.reject(change!.path, "Cite the page.");
    const check = await session.check();
    expect(check.checks.map((c) => c.status)).toEqual(["unmet", "unmet"]);
    expect(JSON.stringify(check.checks)).toContain("Ingest darts was rejected: Cite the page.");
  });

  it("names an ingest by its folder or its files, and adds the policies it is given", async () => {
    class Journal extends YamiModule {
      readonly id = "journal";
      readonly name = "Journal";
      readonly sessionsIn = "none";
      readonly own = this.policy({ name: "own-words", description: "Quote the user.", body: "Quote the user exactly." });
    }
    const journal = new Journal();
    t = await testYami({ modules: [journal] });
    const { yami, vault } = t;
    await vault.write("papers/a.md", "A.\n");
    await vault.write("papers/b.md", "B.\n");
    const folder = await yami.ingest({ folder: "papers" });
    expect(folder.path).toMatch(/Ingest papers \(2 files\) /);
    const files = await yami.ingest({ files: ["papers/a.md", "papers/b.md"], name: "Mine", policies: [journal.own] });
    expect(files.path).toBe("internal/wiki/sessions/Mine.md");
    const doc = await readDocument(vault, files.path);
    expect(doc.properties.sources).toEqual(["[[wiki/sources/a (source)|a (source)]]", "[[wiki/sources/b (source)|b (source)]]"]);
    expect(doc.properties.policies).toContain("[[internal/journal/policies/own-words/POLICY|own-words]]");
    expect(doc.properties.policies).toHaveLength(4);
    const two = await yami.ingest({ files: ["papers/a.md", "papers/b.md"] });
    expect(two.path).toMatch(/Ingest a and 1 more /);
    await expect(yami.ingest({})).rejects.toThrow("Name a file or a folder to ingest.");
  });
});

describe("what review found", () => {
  it("gives a resumed conversation the whole context again when the harness lost its session", async () => {
    const { session, agent } = await fresh("lost");
    await session.start({ maxIterations: 1 });
    agent.forget();
    agent.queue(write("lost"), review());
    expect(await session.resume()).toMatchObject({ state: "done", iterations: 1 });
    expect(agent.started[1]!.id).not.toBe(agent.started[0]!.id);
    const [prompt] = agent.started[1]!.prompts;
    expect(prompt).toMatch(/^\/yami:run This is the Yami session "lost"/);
    expect(prompt).toContain("Yami checked the promises after your last turn.");
  });

  it("writes run notes to the Yami's conversation folder", async () => {
    t = await testYami();
    const yami = new Yami({ vault: t.vault, agents: [new ScriptedAgent()], modules: [new Hello()], conversationFolder: "chats" });
    await yami.enable();
    const session = await (yami.module("hello") as Hello).greet.create({ name: "x" });
    expect((await session.start({ maxIterations: 1 })).conversation).toBe("chats/hello x.md");
  });

  it("refuses a run of no iteration, and reads an iteration count that is no number as 0", async () => {
    const { session, vault, path } = await fresh("counts");
    await expect(session.start({ maxIterations: 0 })).rejects.toThrow("A run takes one iteration or more, not 0.");
    expect(await vault.read(path)).toContain("state: open");
    await vault.write(path, (await vault.read(path)).replace("iteration: 0", "iteration: lots"));
    expect(await session.start({ maxIterations: 1 })).toMatchObject({ iterations: 1 });
    expect(await vault.read(path)).toContain("iteration: 1\n");
  });

  it("refuses a resume with an agent other than the one its conversation is with", async () => {
    const { session } = await fresh("other");
    await session.start({ maxIterations: 1 });
    await expect(session.resume({ agent: new ScriptedAgent() })).rejects.toThrow("continues a conversation with claude");
  });

  it("reports no stale status when a run starts right after another ends", async () => {
    const { session, agent } = await fresh("twice");
    const seen: SessionStatus[] = [];
    session.on((status) => seen.push(status));
    await session.start({ maxIterations: 1 });
    agent.queue(write("twice"), review());
    await session.start({ maxIterations: 1 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(seen).toEqual(["working", "checking", "needs-attention", "working", "checking", "reviewing", "done"]);
  });

  it("refuses fields and a schema that set a core field of a session", async () => {
    const hello = new Hello();
    t = await testYami({ modules: [hello] });
    await expect(hello.greet.create({ fields: { state: "done", greeting: "Hi" } })).rejects.toThrow("A session's state is a core field");
    class Bad extends Hello {
      readonly id = "bad";
      readonly schema = { iteration: { type: "number" as const } };
    }
    expect(() => new Yami({ vault: t!.vault, modules: [new Bad()] })).toThrow("The bad module's schema holds iteration");
  });
});

describe("a note whose properties do not parse", () => {
  const broken = "---\ndescription: Fix a scroll stop: the editor counted as out of view.\n---\nAn old note.\n";

  it("anywhere in the vault, does not fail a session that never links it", async () => {
    const { session, vault, agent, path } = await fresh("unrelated");
    await vault.write("tool/sessions/old.md", broken);
    agent.queue(write("unrelated"), review());
    expect(await session.start()).toMatchObject({ state: "done", iterations: 1 });
    expect(await vault.read(path)).toContain("iteration 1: 1 met, 0 unmet");
  });

  it("linked by a session, leaves its promise unmet and names the note, instead of failing the run", async () => {
    class Reads extends Hello {
      readonly id = "reads";
      readonly checked = this.promise({ name: "notes-checked", description: "Every note is checked.", check: "property", field: "notes", property: "checked", value: true, body: "Every linked note is checked." });
      readonly read = this.flow({ name: "read", description: "Reads.", promises: [this.checked], maxIterations: 1 });
      readonly schema = { notes: { type: "links" as const, default: [] } };
    }
    const reads = new Reads();
    t = await testYami({ modules: [reads] });
    await t.vault.write("notes/Broken.md", broken);
    const session = await reads.read.create({ name: "r", fields: { notes: ["[[notes/Broken]]"] } });
    expect(await session.start()).toMatchObject({ state: "needs-attention" });
    const doc = await t.vault.read(session.path);
    expect(doc).toContain("the check could not finish: The properties of notes/Broken.md do not parse: Nested mappings are not allowed in compact mappings");
  });

  it("keeps a progress line on one line, whatever the error holds", async () => {
    const { session, vault, path } = await fresh("lines", new Hello(), [() => ({ status: "failed", error: "first line\n\n   second line\n   ^" })]);
    expect((await session.start()).reason).toBe("iteration 1: turn failed: first line second line ^");
    const progress = (await vault.read(path)).split("## Progress\n")[1]!;
    expect(progress).toMatch(/^- \d\d:\d\d iteration 1: turn failed: first line second line \^\n$/);
  });
});
