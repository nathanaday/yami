import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copyStyles, pluginBuild } from "../../src/build/esbuild.js";
import { STATUS_LABELS, type Session } from "../../src/index.js";
import { review, ScriptedAgent, testYami, type TestYami, type Turn } from "../../src/testing/index.js";
import { Hello } from "../fixtures/hello.js";

let t: TestYami | undefined;
afterEach(async () => {
  await t?.dispose();
  t = undefined;
});

/** A module with a second flow, an article, and an action on its sessions that applies once a session is done. */
class Rich extends Hello {
  readonly id: string = "rich";
  readonly guide = this.article("Style guide", "Short lines.");
  readonly tidy = this.flow({ name: "tidy", description: "Tidies.", articles: [this.guide], promises: [this.note] });
  readonly archive = this.action({ id: "archive", name: "Archive this greeting", on: this.greet, when: (p) => p.state === "done", run: async (s) => `Archived ${s.path}.` });
}

async function fresh(turns: Turn[] = []) {
  const rich = new Rich();
  t = await testYami({ modules: [rich], turns });
  t.yami.setAgents([...t.yami.agents, new ScriptedAgent()]);
  return { ...t, rich };
}

const write = (name: string) => () => t!.vault.write(`greetings/${name}.md`, `Hello, ${name}`);
const kinds = (session: Session, properties: Record<string, unknown>) => session.acts(properties).map((a) => `${a.kind}:${a.label}`);

describe("what a view of the sessions reads", () => {
  it("summarizes each session in one read, newest first, for one module or flow", async () => {
    const { yami, rich, agent } = await fresh();
    await rich.greet.create({ name: "a" });
    agent.queue(write("b"), review());
    const b = await rich.greet.create({ name: "b" });
    await b.start();
    await rich.tidy.create({ name: "c" });
    const all = await yami.summaries(rich);
    expect(all.map((s) => [s.name, s.status, s.flow?.name, s.iteration, s.met, s.unmet])).toEqual([
      ["c", "open", "tidy", 0, 0, 0],
      ["b", "done", "greet", 1, 1, 0],
      ["a", "open", "greet", 0, 0, 0],
    ]);
    expect(all[0]!.session).toBe(yami.session("rich/c.md"));
    expect(all[0]!.module).toBe(rich);
    expect(all[0]!.created).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/);
    expect((await yami.summaries(rich.tidy)).map((s) => s.name)).toEqual(["c"]);
    expect((await yami.summaries()).map((s) => s.name)).toEqual(["c", "b", "a"]);
    expect((await yami.summaries(rich.greet)).find((s) => s.name === "b")).toMatchObject({ status: "done", properties: { greeting: "Hello" } });
  });

  it("gives a session's documents with their paths, which promises the last check met, its conversation, and its progress", async () => {
    const { rich, agent, vault } = await fresh();
    const session = await rich.tidy.create({ name: "x" });
    const before = await session.details();
    expect(before.documents.map((d) => [d.kind, d.name, d.path, d.met])).toEqual([
      ["promises", "greeting-note", "internal/rich/promises/greeting-note/PROMISE.md", undefined],
      ["articles", "Style guide", "internal/rich/articles/Style guide.md", undefined],
    ]);
    expect(before.documents.map((d) => d.description)).toEqual(["A note with the greeting.", undefined]);
    expect(before.conversation).toBeUndefined();
    expect(before.progress).toEqual([]);

    agent.queue(() => {}, write("x"));
    await session.start();
    const after = await session.details();
    expect(after.documents[0]).toMatchObject({ kind: "promises", met: true });
    expect(after.conversation).toBe("conversations/rich x.md");
    expect(after.harness).toBe("claude");
    expect(after.progress.map((p) => p.text)).toEqual(["iteration 1: 0 met, 1 unmet", "iteration 2: 1 met, 0 unmet"]);
    expect(after.progress[0]!.time).toMatch(/^\d\d:\d\d$/);

    await vault.write(session.path, (await vault.read(session.path)).replace("Style guide|Style guide]]", "Gone|Gone]]").replace("articles/Style guide", "articles/Gone"));
    expect((await session.details()).documents.find((d) => d.kind === "articles")).toMatchObject({ name: "Gone", path: undefined });
  });

  it("marks a promise unmet when the last check did not meet it", async () => {
    const { rich } = await fresh();
    const session = await rich.greet.create({ name: "never" });
    await session.start({ maxIterations: 1 });
    const details = await session.details();
    expect(details.documents.find((d) => d.kind === "promises")).toMatchObject({ name: "greeting-note", met: false });
    expect(details).toMatchObject({ status: "needs-attention", met: 0, unmet: 1 });
  });

  it("gives the acts that apply now: run with each agent, resume once there is a conversation, the module's actions whose when holds, and stop or kill while a run is live", async () => {
    const { rich, agent } = await fresh();
    const session = await rich.greet.create({ name: "acts" });
    expect(kinds(session, (await session.read()).properties)).toEqual(["start:Run with Claude", "start:Run with Claude 2"]);

    let release!: () => void;
    agent.queue(() => new Promise<void>((resolve) => (release = resolve)), write("acts"), review());
    const run = session.start({ maxIterations: 2 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(kinds(session, (await session.read()).properties)).toEqual(["stop:Stop", "kill:Kill the agent"]);
    release();
    await run;

    const done = (await session.read()).properties;
    expect(kinds(session, done)).toEqual(["start:Run with Claude", "start:Run with Claude 2", "resume:Resume", "action:Archive this greeting"]);
    const archive = session.acts(done).find((a) => a.kind === "action")!;
    expect(archive.action).toBe(rich.archive);
    expect(await archive.run()).toBe("Archived rich/acts.md.");
    const tidy = await rich.tidy.create({ name: "tidy" });
    expect(kinds(tidy, { ...(await tidy.read()).properties, state: "done" })).not.toContain("action:Archive this greeting");
    expect(session.acts({ type: "session", module: "gone" })).toEqual([]);
  });

  it("runs an act and says how it ended", async () => {
    const { rich, agent } = await fresh();
    const session = await rich.greet.create({ name: "said" });
    agent.queue(write("said"), review());
    const start = session.acts((await session.read()).properties)[0]!;
    expect(start.agent).toBe(agent);
    expect(await start.run()).toBe("said: done after 1 iteration.");
  });

  it("says why a run that an act began did not end done", async () => {
    const { rich, agent } = await fresh();
    const session = await rich.greet.create({ name: "sunk" });
    agent.queue(() => ({ status: "failed", error: "boom" }));
    const start = session.acts((await session.read()).properties)[0]!;
    expect(await start.run()).toBe("sunk: failed after 1 iteration: iteration 1: turn failed: boom");
  });

  it("keeps stop and kill for a live run whose document names a flow the module lacks", async () => {
    const { rich, agent } = await fresh();
    const session = await rich.greet.create({ name: "odd" });
    let release!: () => void;
    let begun!: () => void;
    const started = new Promise<void>((resolve) => (begun = resolve));
    agent.queue(() => {
      begun();
      return new Promise<void>((resolve) => (release = resolve));
    });
    const run = session.start({ maxIterations: 1 });
    await started;
    expect(kinds(session, { ...(await session.read()).properties, flow: "gone" })).toEqual(["stop:Stop", "kill:Kill the agent"]);
    release();
    await run;
  });

  it("lists a session whose document is in the middle of an edit, and skips one whose properties do not parse", async () => {
    const { yami, rich, vault } = await fresh();
    await rich.greet.create({ name: "odd" });
    await rich.greet.create({ name: "broken" });
    await vault.write("rich/odd.md", (await vault.read("rich/odd.md")).replace("flow: greet", "flow: gon"));
    await vault.write("rich/broken.md", (await vault.read("rich/broken.md")).replace("flow: greet", "flow: [unclosed"));
    const summaries = await yami.summaries(rich);
    expect(summaries.map((s) => [s.name, s.flow?.name])).toEqual([["odd", undefined]]);
  });

  it("puts the newest session first by when it was created, whatever its name", async () => {
    const { yami, rich, vault } = await fresh();
    for (const [name, created] of [["Zebra", "2026-10-01T09:00:00"], ["Apple", "2026-10-03T09:00:00"], ["Mango", "2026-10-02T09:00:00"]] as const) {
      const { path } = await rich.greet.create({ name });
      await vault.write(path, (await vault.read(path)).replace(/created: .*/, `created: ${created}`));
    }
    expect((await yami.summaries(rich)).map((s) => s.name)).toEqual(["Apple", "Mango", "Zebra"]);
  });

  it("marks a promise that a person names by its bare name, as the loop records it by its path", async () => {
    const { rich, vault, agent } = await fresh();
    const session = await rich.greet.create({ name: "named" });
    await vault.write(session.path, (await vault.read(session.path)).replace('"[[internal/rich/promises/greeting-note/PROMISE|greeting-note]]"', "greeting-note"));
    agent.queue(write("named"), review());
    expect(await session.start()).toMatchObject({ state: "done" });
    expect((await session.details()).documents.find((d) => d.kind === "promises")).toMatchObject({ target: "greeting-note", path: "internal/rich/promises/greeting-note/PROMISE.md", met: true });
  });

  it("gives what a person can do with a module: a new session from each flow that offers one, then each action on no session", () => {
    const rich = new Rich();
    const acting = new (class extends Rich {
      readonly id = "acting";
      readonly hidden = this.flow({ name: "hidden", description: "Hidden.", command: false });
      readonly publish = this.action({ id: "publish", name: "Publish", run: async () => "Published." });
    })();
    const quiet = new (class extends Rich {
      readonly id = "quiet";
      readonly sessionsIn = "none";
    })();
    expect(quiet.acts()).toEqual([]);
    expect(acting.acts().map((a) => `${a.kind}:${a.label}`)).toEqual(["new:New greet", "new:New tidy", "action:Publish"]);
    expect(rich.acts().map((a) => a.label)).toEqual(["New greet", "New tidy"]);
  });

  it("names each status for a person", () => {
    expect(STATUS_LABELS).toEqual({ open: "Not started", working: "Working", checking: "Checking", reviewing: "Reviewing", done: "Done", "needs-attention": "Needs attention", failed: "Failed", stopped: "Stopped" });
  });
});

describe("copyStyles", () => {
  it("writes the Obsidian layer's stylesheet, then the plugin's own, in order", async () => {
    const dir = await mkdtemp(join(tmpdir(), "yami-styles-"));
    try {
      await writeFile(join(dir, "panel.css"), ".panel { color: red; }");
      await copyStyles(join(dir, "styles.css"), [join(dir, "panel.css")]);
      const css = await readFile(join(dir, "styles.css"), "utf8");
      expect(css).toContain(".yami-composer");
      expect(css.endsWith(`/* ${join(dir, "panel.css")} */\n.panel { color: red; }\n`)).toBe(true);
      await copyStyles([join(dir, "a.css"), join(dir, "b.css")], [join(dir, "panel.css")]);
      expect(await readFile(join(dir, "a.css"), "utf8")).toBe(css);
      expect(await readFile(join(dir, "b.css"), "utf8")).toBe(css);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("pluginBuild", () => {
  it("gives its plugins, then the host's, so a host adds one with no spread", () => {
    const install = { name: "install", setup() {} };
    const options = pluginBuild({ production: true, plugins: [install] });
    expect(options.plugins.map((plugin) => plugin.name)).toEqual(["claude-sdk-in-renderer", "mcp-validator", "install"]);
    expect(options).toMatchObject({ minify: true, sourcemap: false, format: "cjs" });
  });
});
