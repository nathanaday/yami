import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Yami } from "../../src/index.js";
import { FsVault, review, ScriptedAgent, testYami, type TestYami } from "../../src/testing/index.js";
import { Wiki } from "../../src/wiki/index.js";
import { Hello } from "../fixtures/hello.js";

let t: TestYami | undefined;
afterEach(async () => {
  await t?.dispose();
  t = undefined;
});

const tools = { name: "own", description: "The host's own tools.", tools: [] };

describe("resumeOrStart", () => {
  it("continues the session when the harness has it, and starts a new one when it lost it", async () => {
    const agent = new ScriptedAgent();
    const first = await agent.resumeOrStart();
    expect(first.continued).toBe(false);
    const again = await agent.resumeOrStart({ resume: first.session.id, access: "read-only" });
    expect(again).toMatchObject({ continued: true, session: { id: first.session.id } });
    agent.forget();
    const lost = await agent.resumeOrStart({ resume: first.session.id, access: "read-only" });
    expect(lost.continued).toBe(false);
    expect(lost.session.id).not.toBe(first.session.id);
    expect(agent.last!.options).toMatchObject({ access: "read-only", resume: undefined });
  });

  it("rejects with the error of the new start when that fails too", async () => {
    const agent = new ScriptedAgent();
    const start = vi.spyOn(agent, "startSession").mockImplementation(async (options) => {
      throw new Error(options?.resume ? "No session." : "A read-only session does not start: …");
    });
    await expect(agent.resumeOrStart({ resume: "gone" })).rejects.toThrow("A read-only session does not start");
    expect(start).toHaveBeenCalledTimes(2);
  });
});

describe("a session's own options", () => {
  it("replace the agent's tools and skills, so a host leaves Yami's out", async () => {
    t = await testYami();
    const agent = t.agent;
    expect(agent.preferences.skills!.length).toBeGreaterThan(0);
    await agent.startSession({ tools, skills: [] });
    expect(agent.last!.options).toMatchObject({ tools, skills: [] });
    await agent.startSession();
    expect(agent.last!.options.tools?.name).toBe("yami");
    expect(agent.last!.options.skills).toEqual(agent.preferences.skills);
  });
});

describe("agents that change while Yami runs", () => {
  it("sets up an agent that is added, and the acts of a session follow the agents", async () => {
    const hello = new Hello();
    t = await testYami({ modules: [hello] });
    const session = await hello.greet.create({ name: "One", exact: true });
    const second = new ScriptedAgent();
    t.yami.setAgents([t.agent, second]);
    expect(t.yami.agents).toEqual([t.agent, second]);
    expect(second.preferences).toMatchObject({ cwd: t.root, tools: { name: "yami" }, skills: t.yami.skills() });
    const starts = (await session.acts((await session.read()).properties)).filter((act) => act.kind === "start");
    expect(starts.map((act) => act.label)).toEqual(["Run with Claude", "Run with Claude 2"]);
    t.yami.setAgents([second]);
    expect(session.acts((await session.read()).properties).filter((act) => act.kind === "start").map((act) => act.agent)).toEqual([second]);
  });

  it("lets a live run keep an agent that is removed, and closes that agent's sessions when Yami closes", async () => {
    const hello = new Hello();
    t = await testYami({ modules: [hello] });
    const session = await hello.greet.create({ name: "Two", exact: true });
    const removed = t.agent;
    const next = new ScriptedAgent();
    let release: (() => void) | undefined;
    removed.queue(
      async () => {
        await new Promise<void>((resolve) => (release = resolve));
        await t!.vault.write("greetings/Two.md", "Hello, Two");
      },
      review(),
    );
    const run = session.start();
    await vi.waitFor(() => expect(release).toBeDefined());
    t.yami.setAgents([next]);
    release!();
    expect(await run).toMatchObject({ state: "done" });
    expect(removed.started.length).toBeGreaterThan(0);
    expect(next.started).toHaveLength(0);
    const closeAll = vi.spyOn(removed, "closeAll");
    await t.yami.close();
    expect(closeAll).toHaveBeenCalled();
  });
});

describe("options that change while Yami runs", () => {
  it("reads the conversation folder at each use: the runs' notes and the wiki's index follow it", async () => {
    t = await testYami();
    let folder = "chats";
    const hello = new Hello();
    const yami = new Yami({ vault: t.vault, agents: [new ScriptedAgent()], modules: [hello], conversationFolder: () => folder });
    await yami.enable();
    await t.vault.write("chats/Old.md", "---\ntype: note\n---\nAbout rice.");
    await t.vault.write("talk/New.md", "---\ntype: note\n---\nAbout rice.");
    expect((await yami.wiki.search("rice")).map((hit) => hit.path)).toEqual(["talk/New.md"]);
    folder = "talk";
    expect(yami.conversationFolder).toBe("talk");
    expect((await yami.wiki.search("rice")).map((hit) => hit.path)).toEqual(["chats/Old.md"]);
    const session = await hello.greet.create({ name: "Three", exact: true });
    await session.start();
    expect((await session.read()).properties.conversation).toMatch(/^\[\[talk\//);
    await yami.close();
  });

  it("reads the wiki's default algorithm at each query", async () => {
    const vault = new FsVault((t = await testYami()).root);
    let algorithm = "bm25";
    const wiki = new Wiki(vault, { defaultAlgorithm: () => algorithm });
    expect(wiki.defaultAlgorithm).toBe("bm25");
    algorithm = "nonesuch";
    await expect(wiki.search("rice")).rejects.toThrow('No algorithm named "nonesuch"');
  });
});

describe("what a Yami adds to the vault and to its agents", () => {
  it("writes the vault ledger, the base skill, and the wiki module's documents, and gives each agent its tools and two skill sets, as the README lists them", async () => {
    t = await testYami();
    const root = t.root;
    const files = (await readdir(root, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name).slice(root.length + 1))
      .sort();
    expect(files).toEqual([
      "Yami.base",
      "internal/wiki/policies/cite-every-claim/POLICY.md",
      "internal/wiki/policies/one-plan/POLICY.md",
      "internal/wiki/policies/one-topic/POLICY.md",
      "internal/wiki/promises/change-applied/PROMISE.md",
      "internal/wiki/promises/clean-topics/PROMISE.md",
      "internal/wiki/promises/sources-absorbed/PROMISE.md",
      "internal/wiki/sessions.base",
      "internal/wiki/skills/ingest/SKILL.md",
      "internal/wiki/skills/ingest/drafter.md",
      "internal/wiki/skills/ingest/extractor.md",
      "internal/wiki/skills/ingest/page-forms.md",
      "internal/wiki/wiki.md",
      "internal/yami/skills/run/SKILL.md",
    ]);
    expect(t.agent.preferences.tools?.tools.map((tool) => tool.name)).toEqual([
      "yami_check",
      "yami_agent",
      "wiki_search",
      "wiki_match",
      "wiki_lint",
      "wiki_tags",
      "wiki_neighbors",
      "wiki_chunks",
      "wiki_change",
    ]);
    expect(t.agent.preferences.skills).toEqual([join(root, "internal/yami"), join(root, "internal/wiki")]);
  });
});
