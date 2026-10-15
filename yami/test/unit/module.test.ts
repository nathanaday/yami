import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import YAML from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import { Agent, type AgentInfo, type AgentSession, BaseSession, type ActiveTurn, type TurnResult } from "../../src/agent/index.js";
import type { Properties, Vault } from "../../src/document/index.js";
import { createSession, enableModule, promise, runSession } from "../../src/module/index.js";
import { hello } from "../../src/modules/hello.js";

/** A vault on the file system. */
class FsVault implements Vault {
  constructor(readonly root: string) {}
  private abs(path: string) {
    return join(this.root, path);
  }
  read(path: string) {
    return readFile(this.abs(path), "utf8");
  }
  async write(path: string, text: string) {
    await mkdir(dirname(this.abs(path)), { recursive: true });
    await writeFile(this.abs(path), text);
  }
  async exists(path: string) {
    return existsSync(this.abs(path));
  }
  async list(folder: string) {
    const dir = this.abs(folder);
    if (!existsSync(dir)) return [];
    const entries = await readdir(dir, { withFileTypes: true, recursive: true });
    return entries.filter((e) => e.isFile() && e.name.endsWith(".md")).map((e) => relative(this.root, join(e.parentPath, e.name)));
  }
  parseProperties(yaml: string): Properties {
    return (YAML.parse(yaml) as Properties | null) ?? {};
  }
  stringifyProperties(properties: Properties) {
    return YAML.stringify(properties);
  }
}

type Turn = (prompt: string) => Promise<Partial<TurnResult> | void> | Partial<TurnResult> | void;

/** A session that runs one scripted behavior per turn. */
class FakeSession extends BaseSession {
  readonly harness = "claude";
  readonly id = "fake-session";
  readonly prompts: string[] = [];
  constructor(private readonly turns: Turn[]) {
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
  protected async createSession(): Promise<AgentSession> {
    this.last = new FakeSession(this.turns);
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
