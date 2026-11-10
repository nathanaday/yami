import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runTool } from "../../src/agent/index.js";
import { link, readDocument, sectionText } from "../../src/document/index.js";
import { runCheck, type WikiModule } from "../../src/index.js";
import { testYami, type FsVault, type TestYami } from "../../src/testing/index.js";
import { BUNDLE_README, isRepository, readBundle, repositoryParts, selectBundle, writeBundle, type Wiki } from "../../src/wiki/index.js";
import { DEFAULT_FOLDERS } from "../../src/document/index.js";

const { originals: ORIGINALS, sources: SOURCES, pages: TOPICS } = DEFAULT_FOLDERS;

let t: TestYami;
let vault: FsVault;
let wiki: Wiki;
let module: WikiModule;
const temp: string[] = [];

const note = (path: string, properties: Record<string, unknown>, body: string) => vault.write(path, `---\n${vault.stringifyProperties(properties)}---\n${body}`);
const tool = (name: string) => t.yami.tools().tools.find((tool) => tool.name === name)!;
const signal = new AbortController().signal;

/** Five linked topics around Reinforcement learning, one apart, and a source with a frozen copy and a text with a picture. */
async function fixture() {
  await vault.writeBinary(`${ORIGINALS}/abc123.pdf`, new Uint8Array([1, 2, 3]));
  await vault.write(`${ORIGINALS}/abc123.md`, "# Sutton\n\n![[abc123/image1.png]]\n");
  await vault.writeBinary(`${ORIGINALS}/abc123/image1.png`, new Uint8Array([9, 9]));
  await note(`${SOURCES}/Sutton (source).md`, { type: "source", description: "The RL textbook.", file: `[[${ORIGINALS}/abc123.pdf]]`, text: `[[${ORIGINALS}/abc123.md]]`, sha256: "abc", status: "absorbed" }, `![[${ORIGINALS}/abc123.md]]\n\n## Summary\n\nThe book.\n`);
  await note(`${TOPICS}/Reinforcement learning.md`, { type: "topic", description: "Learning by reward.", sources: [link(`${SOURCES}/Sutton (source).md`)], tags: ["ml/rl"] }, "An agent learns from reward ([[Sutton (source)]], ch. 1). See [[Q-learning]], [[Policy gradient]], and [[Markov decision process]].\n");
  await note(`${TOPICS}/Q-learning.md`, { type: "topic", description: "A value method.", sources: [link(`${SOURCES}/Sutton (source).md`)] }, "Q-learning learns action values ([[Sutton (source)]], ch. 6). It needs a [[Markov decision process]]. See [[Deep Q-network]].\n");
  await note(`${TOPICS}/Policy gradient.md`, { type: "topic", description: "Learning the policy directly." }, "The policy is a parameterized function. See [[Reinforcement learning]].\n");
  await note(`${TOPICS}/Markov decision process.md`, { type: "topic", description: "States, actions, rewards, transitions." }, "An MDP has states and actions.\n");
  await note(`${TOPICS}/Deep Q-network.md`, { type: "topic", description: "Q-learning with a neural network." }, "DQN approximates Q with a network. See [[Q-learning]].\n");
  await note(`${TOPICS}/Sourdough.md`, { type: "topic", description: "Bread from a wild starter." }, "A starter ferments.\n");
  await wiki.refresh();
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 4, 12));
  t = await testYami();
  ({ vault } = t);
  wiki = t.yami.wiki;
  module = t.yami.module("wiki") as WikiModule;
});
afterEach(async () => {
  vi.useRealTimers();
  await t.dispose();
  for (const folder of temp.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function tempFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "yami-bundle-test-"));
  temp.push(folder);
  return folder;
}

describe("selectBundle", () => {
  it("takes the topic alone for minimal, the best-connected neighbors first up to the cap, and always the sources the topics cite with their originals", async () => {
    await fixture();
    const minimal = await selectBundle(wiki, "Reinforcement learning", "minimal");
    expect(minimal).toEqual({
      topic: `${TOPICS}/Reinforcement learning.md`,
      size: "minimal",
      topics: [`${TOPICS}/Reinforcement learning.md`],
      sources: [`${SOURCES}/Sutton (source).md`],
      originals: [`${ORIGINALS}/abc123.md`, `${ORIGINALS}/abc123.pdf`, `${ORIGINALS}/abc123/image1.png`],
    });
    const small = await selectBundle(wiki, "[[Reinforcement learning]]", "small");
    // The three linked topics tie at first, so the first by name comes; then Q-learning connects to two of the chosen, so it comes before Policy gradient.
    expect(small.topics).toEqual([
      `${TOPICS}/Reinforcement learning.md`,
      `${TOPICS}/Markov decision process.md`,
      `${TOPICS}/Q-learning.md`,
      `${TOPICS}/Deep Q-network.md`,
      `${TOPICS}/Policy gradient.md`,
    ]);
    expect(small.topics).not.toContain(`${TOPICS}/Sourdough.md`);
    const two = await selectBundle(wiki, "Q-learning", "medium");
    expect(two.topics).toHaveLength(5);
    await expect(selectBundle(wiki, "Sutton (source)")).rejects.toThrow("is not a page of the wiki");
    await expect(selectBundle(wiki, "Nowhere")).rejects.toThrow("is not a page of the wiki");
    await expect(selectBundle(wiki, "Q-learning", "huge" as never)).rejects.toThrow('"huge" is not a size');
  });
});

describe("writeBundle and readBundle", () => {
  it("writes the notes in the wiki's layout with the bundle property, the originals, and a README, and the index skips them", async () => {
    await fixture();
    const selection = await selectBundle(wiki, "Reinforcement learning", "minimal");
    const written = await writeBundle(wiki, selection, "exports/RL");
    expect(written).toMatchObject({ folder: "exports/RL", name: "Reinforcement learning", readme: BUNDLE_README, topics: selection.topics, sources: selection.sources, originals: selection.originals });
    const files = await vault.files("exports/RL");
    expect(files).toEqual([
      "exports/RL/README.md",
      `exports/RL/${ORIGINALS}/abc123.md`,
      `exports/RL/${ORIGINALS}/abc123.pdf`,
      `exports/RL/${ORIGINALS}/abc123/image1.png`,
      `exports/RL/${TOPICS}/Reinforcement learning.md`,
      `exports/RL/${SOURCES}/Sutton (source).md`,
    ]);
    const topic = await readDocument(vault, `exports/RL/${TOPICS}/Reinforcement learning.md`);
    expect(topic.properties).toMatchObject({ type: "topic", description: "Learning by reward.", bundle: "Reinforcement learning" });
    expect(topic.body).toBe("An agent learns from reward ([[Sutton (source)]], ch. 1). See [[Q-learning]], [[Policy gradient]], and [[Markov decision process]].\n");
    const readme = await readDocument(vault, "exports/RL/README.md");
    expect(readme.properties).toEqual({ bundle: "Reinforcement learning", topic: link(`${TOPICS}/Reinforcement learning.md`), size: "minimal", exported: "2026-11-04T12:00:00", topics: 1, sources: 1 });
    expect(sectionText(readme.body, "Topics")).toBe(`- ${link(`${TOPICS}/Reinforcement learning.md`)} · Learning by reward.`);
    expect(sectionText(readme.body, "Originals")).toContain("3 files");
    await wiki.refresh();
    expect(wiki.notes.filter((n) => n.path.startsWith("exports/")).map((n) => n.path)).toEqual([]);
    expect((await wiki.lint()).filter((f) => f.check === "duplicate-name")).toEqual([]);
    await expect(writeBundle(wiki, selection, "wiki/bundles")).rejects.toThrow("is in the knowledge base");
    await expect(writeBundle(wiki, selection, "")).rejects.toThrow("Give the folder");
  });

  it("writes to an absolute path outside the vault, and reads the bundle back without the bundle property", async () => {
    await fixture();
    const folder = join(await tempFolder(), "RL bundle");
    const selection = await selectBundle(wiki, "Q-learning", "small");
    await writeBundle(wiki, selection, folder, { name: "Value methods", originals: false });
    const files = (await readdir(folder, { recursive: true, withFileTypes: true })).filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name).slice(folder.length + 1)).sort();
    expect(files).toEqual([
      "README.md",
      `${TOPICS}/Deep Q-network.md`,
      `${TOPICS}/Markov decision process.md`,
      `${TOPICS}/Policy gradient.md`,
      `${TOPICS}/Q-learning.md`,
      `${TOPICS}/Reinforcement learning.md`,
      `${SOURCES}/Sutton (source).md`,
    ]);
    expect(await readFile(join(folder, "README.md"), "utf8")).toContain("# Value methods");
    const bundle = await readBundle(vault, folder);
    expect(bundle.name).toBe("Value methods");
    expect(bundle.notes.map((n) => n.path).sort()).toEqual([`${SOURCES}/Sutton (source).md`, ...selection.topics].sort());
    expect(bundle.notes.every((n) => n.properties.bundle === undefined)).toBe(true);
    expect(bundle.originals).toEqual([]);
    expect(bundle.skipped).toEqual([]);
  });

  it("reads a folder of hand-made notes, skips what is not a topic or a source with the reason, and refuses an empty folder", async () => {
    await note("drop/Levain.md", { type: "topic", description: "A starter." }, "Levain is a starter.\n");
    await note("drop/deeper/Baking (source).md", { type: "source", description: "A book.", file: "[[x.pdf]]" }, "## Summary\n\nBread.\n");
    await note("drop/Diary.md", {}, "Not knowledge.\n");
    await note("drop/Session.md", { type: "session", module: "x" }, "");
    await vault.write("drop/Broken.md", "---\nbad: [unclosed\n---\ntext\n");
    await vault.write("drop/picture.png", "png");
    const bundle = await readBundle(vault, "drop/");
    expect(bundle.notes.map((n) => [n.path, n.type])).toEqual([
      [`${TOPICS}/Levain.md`, "topic"],
      [`${SOURCES}/Baking (source).md`, "source"],
    ]);
    expect(bundle.skipped).toEqual([
      { path: "Broken.md", reason: expect.stringContaining("its properties do not parse") },
      { path: "Diary.md", reason: "it has no type" },
      { path: "Session.md", reason: "its type is session, not a page's or a source's" },
    ]);
    expect(bundle.name).toBeUndefined();
    await vault.write("empty/only.txt", "x");
    await expect(readBundle(vault, "empty")).rejects.toThrow("No page or source under empty");
    await expect(readBundle(vault, "nowhere")).rejects.toThrow("No files under nowhere");
  });

  it("knows a repository address and its branch and folder", () => {
    expect(isRepository("https://github.com/nathanaday/yami")).toBe(true);
    expect(isRepository("git@github.com:nathanaday/yami.git")).toBe(true);
    expect(isRepository("exports/RL")).toBe(false);
    expect(isRepository("/Users/me/RL")).toBe(false);
    expect(repositoryParts("https://github.com/nathanaday/yami")).toEqual({ url: "https://github.com/nathanaday/yami", folder: "" });
    expect(repositoryParts("https://github.com/nathanaday/yami.git/")).toEqual({ url: "https://github.com/nathanaday/yami.git", folder: "" });
    expect(repositoryParts("https://github.com/nathanaday/yami/tree/main/exports/RL")).toEqual({ url: "https://github.com/nathanaday/yami", branch: "main", folder: "exports/RL" });
    expect(repositoryParts("https://github.com/nathanaday/yami/tree/preview")).toEqual({ url: "https://github.com/nathanaday/yami", branch: "preview", folder: "" });
  });
});

describe("exportBundle", () => {
  it("exports around a topic to exports/<name> by default, or the documents given, and is a tool", async () => {
    await fixture();
    const written = await module.exportBundle({ topic: "Policy gradient", size: "minimal" });
    expect(written.folder).toBe("exports/Policy gradient");
    expect(await vault.exists(`exports/Policy gradient/${TOPICS}/Policy gradient.md`)).toBe(true);
    const chosen = await module.exportBundle({ documents: ["Sourdough", `${TOPICS}/Deep Q-network.md`], name: "Odd pair", folder: "out/pair" });
    expect(chosen).toMatchObject({ name: "Odd pair", topics: [`${TOPICS}/Sourdough.md`, `${TOPICS}/Deep Q-network.md`], sources: [] });
    expect(await vault.exists(`out/pair/${TOPICS}/Sourdough.md`)).toBe(true);
    await expect(module.exportBundle({})).rejects.toThrow("Name a page to export around, or the documents to export.");
    await expect(module.exportBundle({ documents: ["Nowhere"] })).rejects.toThrow("is not a page or a source of the wiki");
    const exportTool = tool("wiki_export");
    expect(exportTool.readOnly).toBeFalsy();
    const result = JSON.parse((await runTool(exportTool, { topic: "Q-learning", size: "small", folder: "out/q" }, signal)).text);
    expect(result).toMatchObject({ folder: "out/q", name: "Q-learning", topics: expect.arrayContaining([`${TOPICS}/Q-learning.md`]) });
    expect(await runTool(exportTool, { topic: "Q-learning", size: "vast" }, signal)).toMatchObject({ isError: true });
  });
});

describe("importBundle", () => {
  it("imports a bundle into a vault that has none of it: the originals, a done session, and one change of creates that an approval applies", async () => {
    await fixture();
    const folder = join(await tempFolder(), "bundle");
    await writeBundle(wiki, await selectBundle(wiki, "Reinforcement learning", "small"), folder, { name: "RL" });
    // A fresh vault.
    const fresh = await testYami();
    try {
      const wikiModule = fresh.yami.module("wiki") as WikiModule;
      const result = await wikiModule.importBundle({ from: folder });
      expect(result.name).toBe("RL");
      expect(result.session).toBe("internal/wiki/sessions/Import RL 2026-11-04.md");
      expect(result.staged.map((s) => [s.target, s.status])).toEqual([
        [`${TOPICS}/Deep Q-network.md`, "new"],
        [`${TOPICS}/Markov decision process.md`, "new"],
        [`${TOPICS}/Policy gradient.md`, "new"],
        [`${TOPICS}/Q-learning.md`, "new"],
        [`${TOPICS}/Reinforcement learning.md`, "new"],
        [`${SOURCES}/Sutton (source).md`, "new"],
      ]);
      expect(result.dropped).toEqual([]);
      expect(result.change).toMatch(/^internal\/wiki\/changes\/.*Import RL\.md$/);
      expect(await fresh.vault.exists(`${ORIGINALS}/abc123.pdf`)).toBe(true);
      expect(await fresh.vault.exists(`${ORIGINALS}/abc123/image1.png`)).toBe(true);
      const session = await readDocument(fresh.vault, result.session);
      expect(session.properties).toMatchObject({ flow: "import", state: "done", from: folder, changes: [link(result.change!)] });
      expect(session.properties.staged).toHaveLength(6);
      expect(sectionText(session.body, "Import")).toContain(`→ \`${TOPICS}/Q-learning.md\` · **new** · new to this wiki`);
      expect(await fresh.vault.exists("internal/wiki/sessions/Import RL 2026-11-04/Q-learning.md")).toBe(true);
      await fresh.yami.wiki.refresh();
      expect(fresh.yami.wiki.notes.map((n) => n.path).filter((p) => p.startsWith("internal/wiki/sessions/"))).toEqual([]);
      // The promises hold before the approval, since the change is proposed.
      const check = (name: string) => runCheck({ path: "p", properties: { check: name }, body: "" }, { vault: fresh.vault, wiki: fresh.yami.wiki, path: result.session, properties: session.properties }, wikiModule.checks);
      expect(await check("imported")).toMatchObject({ status: "met", detail: "6 staged note(s) covered by the standing changes" });
      expect(await check("proposed")).toMatchObject({ status: "met" });
      await fresh.yami.wiki.approve(result.change!);
      const topic = await readDocument(fresh.vault, `${TOPICS}/Q-learning.md`);
      expect(topic.properties).toMatchObject({ type: "topic", description: "A value method.", created: "2026-11-04T12:00:00" });
      expect(topic.properties.bundle).toBeUndefined();
      expect(topic.body).toContain("Q-learning learns action values");
      // The bundle's topics are short, so their template finds sections to add, and nothing else.
      expect((await fresh.yami.wiki.lint({ paths: [`${TOPICS}/Q-learning.md`] })).map((f) => f.check)).toEqual(["missing-section"]);
    } finally {
      await fresh.dispose();
    }
  });

  it("stages a conflict and a near note for a run, drops a note the wiki holds already, and the imported check follows the plan", async () => {
    await fixture();
    const folder = join(await tempFolder(), "bundle");
    await writeBundle(wiki, await selectBundle(wiki, "Reinforcement learning", "small"), folder, { name: "RL" });
    // Change the wiki: Q-learning differs, Deep Q-network is known under another name, Policy gradient is as it was, and a new topic is near Markov decision process.
    const q = await readDocument(vault, `${TOPICS}/Q-learning.md`);
    await note(q.path, q.properties, `${q.body}\nIt converges with a decaying step size.\n`);
    await vault.remove(`${TOPICS}/Deep Q-network.md`);
    await note(`${TOPICS}/DQN.md`, { type: "topic", description: "Q-learning with a neural network.", aliases: ["Deep Q-network"] }, "DQN approximates Q with a network.\n");
    await vault.remove(`${TOPICS}/Markov decision process.md`);
    await note(`${TOPICS}/Markov decision processes.md`, { type: "topic", description: "States, actions, rewards, transitions." }, "An MDP has states and actions.\n");
    await wiki.refresh();
    const result = await module.importBundle({ from: folder, name: "Import RL again" });
    const by = Object.fromEntries(result.staged.map((s) => [s.target, s]));
    expect(by[`${TOPICS}/Q-learning.md`]).toMatchObject({ status: "conflict", with: [`${TOPICS}/Q-learning.md`], reason: expect.stringContaining("a note holds this path with another text") });
    expect(by[`${TOPICS}/Deep Q-network.md`]).toMatchObject({ status: "conflict", with: [`${TOPICS}/DQN.md`], reason: expect.stringContaining('holds the name "Deep Q-network"') });
    expect(by[`${TOPICS}/Markov decision process.md`]).toMatchObject({ status: "near", with: [`${TOPICS}/Markov decision processes.md`] });
    expect(result.dropped.map((d) => d.target).sort()).toEqual([`${TOPICS}/Policy gradient.md`, `${TOPICS}/Reinforcement learning.md`, `${SOURCES}/Sutton (source).md`]);
    expect(result.change).toBeUndefined();
    const session = await readDocument(vault, result.session);
    expect(session.properties).toMatchObject({ state: "open", changes: [] });
    expect(sectionText(session.body, "Import")).toContain("· dropped · the wiki holds it already, as it is");
    const context = { vault, wiki, path: result.session, properties: session.properties };
    const check = (name: string) => runCheck({ path: "p", properties: { check: name }, body: "" }, context, module.checks);
    expect(await check("imported")).toMatchObject({ status: "unmet", detail: "no change of the session is proposed or applied" });
    // A plan that merges one and names the others: an alias covers Deep Q-network, the notes cover the rest.
    const proposal = await wiki.change({
      title: "Import RL again",
      session: result.session,
      notes: "Left out Markov decision process: the wiki's Markov decision processes says the same.",
      writes: [{ op: "modify", path: `${TOPICS}/DQN.md`, properties: { aliases: ["Deep Q-network", "DQN"] }, why: "the same subject" }],
    });
    await wiki.refresh();
    const after = (await readDocument(vault, result.session)).properties;
    expect(await runCheck({ path: "p", properties: { check: "imported" }, body: "" }, { ...context, properties: after }, module.checks)).toMatchObject({
      status: "unmet",
      detail: "no standing change writes or names Q-learning; create or merge each, or name it in the plan's notes with why it is left out",
    });
    await wiki.reject(proposal.path, "incomplete");
    await wiki.change({
      title: "Import RL again",
      session: result.session,
      notes: "Left out Markov decision process: the wiki's Markov decision processes says the same.",
      writes: [
        { op: "modify", path: `${TOPICS}/DQN.md`, properties: { aliases: ["Deep Q-network", "DQN"] }, why: "the same subject" },
        { op: "modify", path: `${TOPICS}/Q-learning.md`, body: `${q.body}\nIt converges with a decaying step size ([[Sutton (source)]], ch. 6).\n`, why: "merged the bundle's Q-learning" },
      ],
    });
    await wiki.refresh();
    const final = (await readDocument(vault, result.session)).properties;
    expect(await runCheck({ path: "p", properties: { check: "imported" }, body: "" }, { ...context, properties: final }, module.checks)).toMatchObject({ status: "met" });
  });

  it("is a tool that starts the run when a merge is needed, and not when code proposed the change", async () => {
    await fixture();
    const prompts: string[] = [];
    t.agent.queue((prompt) => {
      prompts.push(prompt);
    });
    await note("drop/Levain.md", { type: "topic", description: "A starter." }, "Levain is a starter.\n");
    const importTool = tool("wiki_import");
    expect(importTool.readOnly).toBeFalsy();
    const direct = JSON.parse((await runTool(importTool, { from: "drop" }, signal)).text);
    expect(direct).toMatchObject({ run: "not needed", change: expect.stringContaining("Import drop"), staged: [expect.objectContaining({ status: "new" })] });
    await note("drop2/Sourdough.md", { type: "topic", description: "Bread, again." }, "Another text about sourdough.\n");
    const merged = JSON.parse((await runTool(importTool, { from: "drop2", name: "Merge sourdough" }, signal)).text);
    expect(merged).toMatchObject({ run: "started", session: "internal/wiki/sessions/Merge sourdough.md", staged: [expect.objectContaining({ status: "conflict" })] });
    await vi.waitFor(() => expect(prompts).toHaveLength(1));
    expect(prompts[0]).toContain("wiki:import");
    expect(await runTool(importTool, { from: "nowhere" }, signal)).toMatchObject({ isError: true, text: expect.stringContaining("No files under nowhere") });
  });

  it("installs the import skill and promise, and the flow with no command", async () => {
    expect(await vault.exists("internal/wiki/skills/import/SKILL.md")).toBe(true);
    expect(await vault.exists("internal/wiki/skills/export/SKILL.md")).toBe(true);
    expect(await vault.exists("internal/wiki/promises/bundle-imported/PROMISE.md")).toBe(true);
    expect(module.import.command).toBe(false);
    expect(module.import.access).toBe("read-only");
    expect(module.acts().map((a) => a.label)).toEqual(["New checkout", "New figures", "New verify"]);
    expect(t.yami.problems).toEqual([]);
  });
});
