import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Agent, type AgentInfo, type AgentSession, BaseSession, type ActiveTurn, runTool, type SessionOptions, setSkills, slashCommand, type TurnResult } from "../../src/agent/index.js";
import type { Vault } from "../../src/document/index.js";
import { captureSource, Wiki } from "../../src/wiki/index.js";
import { wiki as wikiModule } from "../../src/modules/wiki.js";
import { link } from "../../src/document/index.js";
import { FsVault } from "../fixtures/fs-vault.js";
import { createSession, enableModule, moduleSkills, moduleTools, promise, runSession, skill, skillCommand } from "../../src/module/index.js";
import { hello } from "../../src/modules/hello.js";

type Turn = (prompt: string) => Promise<Partial<TurnResult> | void> | Partial<TurnResult> | void;

/** A session that runs one scripted behavior per turn. */
class FakeSession extends BaseSession {
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

class FakeAgent extends Agent {
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

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

async function fresh(name: string, module = hello) {
  root = await mkdtemp(join(tmpdir(), "yami-module-"));
  const vault = new FsVault(root);
  await enableModule(vault, module);
  const path = await createSession(vault, module, name);
  return { vault, path };
}

const write = (vault: Vault, name: string) => () => vault.write(`greetings/${name}.md`, `Hello, ${name}`);

describe("enableModule and createSession", () => {
  it("installs the module's files, with links that carry full paths", async () => {
    const { vault, path } = await fresh("x");
    for (const file of ["Yami.base", "hello/sessions.base", "internal/hello/hello.md", "internal/hello/policies/Always say hello.md", "internal/hello/skills/greeting/SKILL.md"]) {
      expect(await vault.exists(file), file).toBe(true);
    }
    const created = await vault.read(path);
    expect(created).toContain('"[[internal/hello/skills/greeting/SKILL|greeting]]"');
    expect(created).toContain('"[[internal/hello/policies/Always say hello|Always say hello]]"');
    expect(created).toContain("greeting: Hello");
  });

  it("keeps edited documents and bases on a second enable", async () => {
    const { vault } = await fresh("x");
    await vault.write("internal/hello/policies/Always say hello.md", "---\ntype: policy\nmodule: hello\n---\nEdited by the user.\n");
    await vault.write("hello/sessions.base", "views:\n  - type: table\n    name: Mine\n");
    await enableModule(vault, hello);
    expect(await vault.read("internal/hello/policies/Always say hello.md")).toContain("Edited by the user.");
    expect(await vault.read("hello/sessions.base")).toContain("Mine");
  });

  it("refuses a duplicate session name", async () => {
    const { vault } = await fresh("x");
    await expect(createSession(vault, hello, "x")).rejects.toThrow("exists");
  });
});

describe("moduleTools", () => {
  it("serves the tools of every module in one set, named by module", async () => {
    const { vault } = await fresh("tools");
    const set = moduleTools({ vault, wiki: new Wiki(vault) }, [hello, { ...hello, id: "hello-two", name: "Two" }, { id: "none", name: "None" }]);
    expect(set?.name).toBe("yami");
    expect(set?.description).toContain("Hello world, Two");
    expect(set?.tools.map((tool) => tool.name)).toEqual(["hello_greet_user", "hello_two_greet_user"]);
    expect(await runTool(set!.tools[0]!, { name: "Ada" }, new AbortController().signal)).toEqual({ text: "Hello, Ada!", isError: false });
    expect(moduleTools({ vault, wiki: new Wiki(vault) }, [{ id: "none", name: "None" }])).toBeUndefined();
  });

  it("reaches the agent's sessions through its preferences", async () => {
    const { vault, path } = await fresh("with-tools");
    const agent = new FakeAgent([write(vault, "with-tools")]);
    agent.setPreferences({ tools: moduleTools({ vault, wiki: new Wiki(vault) }, [hello]) });
    await runSession(vault, agent, hello, path);
    expect(agent.last!.options.tools?.tools.map((tool) => tool.name)).toEqual(["hello_greet_user"]);
  });
});

describe("runSession", () => {
  it("meets the promise on the second iteration and records both", async () => {
    const { vault, path } = await fresh("second");
    const agent = new FakeAgent([() => {}, write(vault, "second")]);
    const result = await runSession(vault, agent, hello, path);
    expect(result).toMatchObject({ state: "done", iterations: 2 });
    const [first, second] = agent.last!.prompts;
    expect(first).toContain("## Policies");
    expect(first).toContain("## Promises");
    expect(first).toContain("### greeting");
    expect(first).toContain("- greeting: Hello");
    expect(second).toMatch(/^Yami checked/);
    expect(second).toContain("no file at greetings/second.md");
    const doc = await vault.read(path);
    expect(doc).toContain("iteration 1: 0 met, 1 unmet");
    expect(doc).toContain("iteration 2: 1 met, 0 unmet");
    expect(doc).toContain("- [x] [[internal/hello/promises/Greeting note|Greeting note]]");
    expect(doc).toContain("state: done");
    expect(doc).toContain('conversation: "[[conversations/hello second|hello second]]"');
    expect(doc).toContain("\n\n## Deliverables\n");
    const record = await vault.read(result.conversation);
    expect(result.conversation).toBe("conversations/hello second.md");
    expect(record).toMatch(/^---\ntype: conversation\nagent: claude\n/);
    expect(record).toContain("session: fake-session");
    expect(record).toContain('module: "[[hello/second|second]]"');
    expect(record).toContain("> [!user]\n> You are running the Yami session");
    expect(record).toContain("> [!user]\n> Yami checked the promises");
    expect(record.match(/> \[!user\]/g)).toHaveLength(2);
    expect(record.trim().endsWith("ok")).toBe(true);
    expect(await vault.exists("internal/hello/logs/second.md")).toBe(false);
  });

  it("opens the conversation with the module's access setting, and keeps internal sessions under internal/", async () => {
    const internal = { ...hello, id: "quiet", name: "Quiet", sessions: "internal" as const, access: "read-only" as const };
    const { vault, path } = await fresh("hidden", internal);
    expect(path).toBe("internal/quiet/sessions/hidden.md");
    expect(await vault.exists("internal/quiet/sessions.base")).toBe(true);
    expect(await vault.exists("quiet/sessions.base")).toBe(false);
    const agent = new FakeAgent([]);
    await runSession(vault, agent, internal, path, { maxIterations: 1 });
    expect(agent.last!.options.access).toBe("read-only");
    expect(await vault.read("conversations/quiet hidden.md")).toContain("access: read-only");
  });

  it("needs attention when the iterations run out", async () => {
    const { vault, path } = await fresh("never");
    const result = await runSession(vault, new FakeAgent([]), hello, path, { maxIterations: 2 });
    expect(result).toMatchObject({ state: "needs-attention", iterations: 2 });
    const doc = await vault.read(path);
    expect(doc).toContain("state: needs-attention");
    expect(doc).toContain('unmet:\n  - "[[internal/hello/promises/Greeting note|Greeting note]]"');
  });

  it("needs attention when a promise has no check", async () => {
    const reviewed = { ...hello, id: "review", documents: [...hello.documents!.filter((d) => d.type !== "promise"), promise("Greeting note", {}, "No check.")] };
    const { vault, path } = await fresh("manual", reviewed);
    const result = await runSession(vault, new FakeAgent([]), reviewed, path);
    expect(result).toMatchObject({ state: "needs-attention", iterations: 1 });
    expect(await vault.read(path)).toContain("1 for review");
  });

  it("fails when the harness fails", async () => {
    const { vault, path } = await fresh("broken");
    const result = await runSession(vault, new FakeAgent([() => ({ status: "failed", error: "boom" })]), hello, path);
    expect(result.state).toBe("failed");
    const doc = await vault.read(path);
    expect(doc).toContain("state: failed");
    expect(doc).toContain("turn failed: boom");
  });

  it("continues the iteration count on a later run", async () => {
    const { vault, path } = await fresh("resume");
    await runSession(vault, new FakeAgent([]), hello, path, { maxIterations: 1 });
    const result = await runSession(vault, new FakeAgent([write(vault, "resume")]), hello, path, { maxIterations: 1 });
    expect(result.state).toBe("done");
    const doc = await vault.read(path);
    expect(doc).toContain("iteration: 2");
    expect(doc).toContain("iteration 2:");
  });
});

describe("module skills", () => {
  const withFiles = { ...hello, documents: [...(hello.documents ?? []).filter((doc) => doc.type !== "skill"), skill("greeting", "How to greet by name.", "# Greeting\n\nRead tone.md first.", { "tone.md": "Warm and short." })] };

  it("installs a skill's files beside its SKILL.md, and keeps edited ones", async () => {
    const { vault } = await fresh("files", withFiles);
    expect(await vault.read("internal/hello/skills/greeting/tone.md")).toBe("Warm and short.");
    await vault.write("internal/hello/skills/greeting/tone.md", "Edited.");
    await enableModule(vault, withFiles);
    expect(await vault.read("internal/hello/skills/greeting/tone.md")).toBe("Edited.");
  });

  it("names each module's internal folder as a skill set, and each skill by /<module>:<skill>", async () => {
    const { vault } = await fresh("sets");
    expect(moduleSkills(vault, [hello, { id: "plain", name: "Plain" }])).toEqual([`${vault.root}/internal/hello`]);
    expect(skillCommand("internal/wiki/skills/ingest/SKILL.md")).toEqual({ command: "wiki:ingest", root: "internal/wiki" });
    expect(skillCommand("notes/SKILL.md")).toBeUndefined();
    expect(setSkills([`${vault.root}/internal/hello`])).toEqual([
      { command: "hello:greeting", set: "hello", name: "greeting", path: `${vault.root}/internal/hello/skills/greeting/SKILL.md`, description: "How to greet a person or a session by name." },
    ]);
    expect(slashCommand("/wiki:ingest the context\nwith lines")).toEqual({ command: "wiki:ingest", rest: "the context\nwith lines" });
    expect(slashCommand("/hello:greeting")).toEqual({ command: "hello:greeting", rest: "" });
    expect(slashCommand("no command")).toBeUndefined();
  });

  it("invokes a session's skill by command when the agent has the module's skill set, and inlines it otherwise", async () => {
    const { vault, path } = await fresh("invoked");
    const agent = new FakeAgent([write(vault, "invoked")]);
    agent.setPreferences({ skills: moduleSkills(vault, [hello]) });
    await runSession(vault, agent, hello, path);
    const [first] = agent.last!.prompts;
    expect(first!.startsWith("/hello:greeting You are running the Yami session")).toBe(true);
    expect(first).toContain("- `hello:greeting`: How to greet a person or a session by name. Its folder: internal/hello/skills/greeting/");
    expect(first).not.toContain("Keep it to one line");

    const plain = await createSession(vault, hello, "inlined");
    const other = new FakeAgent([write(vault, "inlined")]);
    await runSession(vault, other, hello, plain);
    const [inlined] = other.last!.prompts;
    expect(inlined!.startsWith("You are running")).toBe(true);
    expect(inlined).toContain("## Skills\n\n### greeting\n\n# Greeting");
    expect(inlined).toContain("Keep it to one line");
  });
});

describe("a wiki session end to end", () => {
  it("ends done after the agent applies its change with wiki_change, and a topic may link the session", async () => {
    root = await mkdtemp(join(tmpdir(), "yami-wiki-session-"));
    const vault = new FsVault(root);
    await enableModule(vault, wikiModule);
    await vault.write("Notes/Darts.md", "# Darts\n\nA dart takes in fullness at the bust.\n");
    const source = await captureSource(vault, "Notes/Darts.md");
    const path = await createSession(vault, wikiModule, "Ingest darts", { sources: [link(source)] });
    const wiki = new Wiki(vault);
    const agent = new FakeAgent([
      async () => {
        const change = agent.last!.options.tools!.tools.find((tool) => tool.name === "wiki_change")!;
        const result = await runTool(
          change,
          {
            title: "Ingest darts",
            session: path,
            writes: [
              {
                op: "create",
                path: "wiki/topics/Dart.md",
                properties: { description: "A fold sewn into fabric to shape it.", sources: [link(source)] },
                body: `## Definition\n\nA dart takes in fullness ([[${source.slice(0, -3)}|Darts]]). Drafted in [[${path.slice(0, -3)}|its session]].`,
              },
              { op: "modify", path: source, properties: { description: "Notes on darts.", status: "absorbed" }, body: "[[Notes/Darts|Darts]]\n\n## Summary\n\nDarts.\n" },
            ],
          },
          new AbortController().signal,
        );
        if (result.isError) throw new Error(result.text);
      },
    ]);
    agent.setPreferences({ tools: moduleTools({ vault, wiki }, [wikiModule]) });
    const result = await runSession(vault, agent, wikiModule, path, { wiki, maxIterations: 2 });
    const doc = await vault.read(path);
    expect(result, doc).toMatchObject({ state: "done", iterations: 1 });
    expect(doc).toContain("iteration 1: 3 met, 0 unmet");
  });
});
