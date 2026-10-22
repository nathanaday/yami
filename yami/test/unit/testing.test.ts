import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FsVault, markdownText, review, ScriptedAgent, testYami } from "../../src/testing/index.js";

describe("testing helpers", () => {
  it("gives a Yami over a fresh vault and removes the vault on dispose", async () => {
    const t = await testYami();
    expect(existsSync(t.root)).toBe(true);
    await t.vault.write("notes/Idea.md", "hello");
    expect(await t.vault.read("notes/Idea.md")).toBe("hello");
    expect(await t.vault.exists("notes/Idea.md")).toBe(true);
    expect(await readFile(join(t.root, "notes/Idea.md"), "utf8")).toBe("hello");
    expect(t.yami.module("threads")).toBeDefined();
    await t.dispose();
    expect(existsSync(t.root)).toBe(false);
  });

  it("leaves out the threads module when asked", async () => {
    const t = await testYami({ threads: false });
    try {
      expect(t.yami.module("threads")).toBeUndefined();
    } finally {
      await t.dispose();
    }
  });

  it("copies files into the vault, and leaves no folder behind when a file is missing", async () => {
    const source = await mkdtemp(join(tmpdir(), "yami-testing-src-"));
    try {
      await writeFile(join(source, "Idea.md"), "from disk");
      const t = await testYami({ files: { "notes/Idea.md": join(source, "Idea.md") } });
      expect(await t.vault.read("notes/Idea.md")).toBe("from disk");
      await t.dispose();
      await expect(testYami({ files: { "a.md": join(source, "missing.md") } })).rejects.toThrow(/cannot copy .*missing\.md to a\.md/);
    } finally {
      await rm(source, { recursive: true, force: true });
    }
  });

  it("lists, removes and round-trips files of an FsVault", async () => {
    const root = await mkdtemp(join(tmpdir(), "yami-testing-fs-"));
    try {
      const vault = new FsVault(root);
      await vault.write("a/b.md", "x");
      await vault.writeBinary("a/c.bin", new Uint8Array([1, 2, 3]));
      expect([...(await vault.readBinary("a/c.bin"))]).toEqual([1, 2, 3]);
      expect((await vault.files("a")).sort()).toEqual(["a/b.md", "a/c.bin"]);
      await vault.remove("a/b.md");
      expect(await vault.exists("a/b.md")).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("runs the scripted turns in order, records the prompts, and completes when the script is empty", async () => {
    const t = await testYami({ turns: [async (_prompt, session) => (await session.tool("yami_agent", {}).catch(() => undefined), { text: "first" })] });
    try {
      const agent: ScriptedAgent = t.agent;
      agent.queue(() => ({ text: "second" }));
      const session = await agent.startSession({ cwd: t.root });
      expect((await session.send("one")).text).toBe("first");
      expect((await session.send("two")).text).toBe("second");
      const last = await session.send("three");
      expect(last.status).toBe("completed");
      expect(last.text).toBe("ok");
      expect(agent.last?.prompts).toEqual(["one", "two", "three"]);
      await expect(agent.last!.tool("nope", {})).rejects.toThrow("The session has no tool nope.");
    } finally {
      await t.dispose();
    }
  });

  it("refuses review() in a session that is no review", async () => {
    const t = await testYami();
    try {
      t.agent.queue(review());
      const session = await t.agent.startSession({ cwd: t.root });
      expect(await session.send("go")).toMatchObject({ status: "failed", error: expect.stringMatching(/no review/) });
    } finally {
      await t.dispose();
    }
  });

  it("imports a .md file as its text with markdownText", () => {
    const plugin = markdownText();
    expect(plugin.transform("# Skill\n\"quoted\"", "/x/skill.md")).toBe(`export default ${JSON.stringify("# Skill\n\"quoted\"")};`);
    expect(plugin.transform("code", "/x/skill.ts")).toBeUndefined();
  });
});
