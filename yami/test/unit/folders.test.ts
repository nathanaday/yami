import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_FOLDERS, folderProblem, Folders, folderSettingsText, link, mapFolders, parseFolderSettings, protect, readDocument, readFolders, readProtected, writeProtected } from "../../src/document/index.js";
import { Yami, type WikiModule } from "../../src/index.js";
import { moveLinks } from "../../src/module/move.js";
import { FsVault } from "../../src/testing/index.js";
import { readBundle, selectDocuments, writeBundle } from "../../src/wiki/index.js";

const roots: string[] = [];
const yamis: Yami[] = [];

async function vaultWith(settings?: object): Promise<FsVault> {
  const root = await mkdtemp(join(tmpdir(), "yami-folders-"));
  roots.push(root);
  if (settings) await writeFile(join(root, ".yami.json"), JSON.stringify(settings));
  return new FsVault(root);
}

async function enabled(vault: FsVault): Promise<Yami> {
  const yami = new Yami({ vault, threads: false });
  yamis.push(yami);
  await yami.enable();
  return yami;
}

const note = (vault: FsVault, path: string, properties: Record<string, unknown>, body: string) => vault.write(path, `---\n${vault.stringifyProperties(properties)}---\n${body}`);

/** One source with a frozen copy, and one topic that cites it and embeds a figure. */
async function knowledge(vault: FsVault): Promise<void> {
  const f = vault.folders;
  await vault.writeBinary(`${f.originals}/abc.pdf`, new Uint8Array([1, 2, 3]));
  await vault.writeBinary(`${f.figures}/RL/loop.svg`, new TextEncoder().encode("<svg viewBox='0 0 1 1'/>"));
  await note(vault, `${f.sources}/Sutton (source).md`, { type: "source", description: "The RL book.", file: `[[${f.originals}/abc.pdf]]`, sha256: "abc", status: "absorbed" }, `![[${f.originals}/abc.pdf]]\n`);
  await note(vault, `${f.pages}/RL.md`, { type: "topic", description: "Learning by reward.", sources: [link(`${f.sources}/Sutton (source).md`)] }, `An agent learns from reward ([[Sutton (source)]], ch. 1).\n\n![[${f.figures}/RL/loop.svg]]\n`);
}

afterEach(async () => {
  for (const yami of yamis.splice(0)) await yami.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("the folder settings", () => {
  it("default to internal/ and wiki/, and give the wiki's folders under them", () => {
    expect(DEFAULT_FOLDERS.settings).toEqual({ internal: "internal", wiki: "wiki" });
    const f = new Folders({ internal: " system/yami/ ", wiki: "library//wiki" });
    expect(f.settings).toEqual({ internal: "system/yami", wiki: "library/wiki" });
    expect([f.pages, f.sources, f.wikiInternal, f.changes, f.originals, f.figures, f.protected]).toEqual([
      "library/wiki/pages",
      "library/wiki/sources",
      "system/yami/wiki",
      "system/yami/wiki/changes",
      "system/yami/wiki/originals",
      "system/yami/wiki/figures",
      "system/yami/yami/protected.json",
    ]);
    expect(f.inKnowledge("library/wiki/pages/RL.md")).toBe(true);
    expect(f.inKnowledge("wiki/pages/RL.md")).toBe(false);
  });

  it("refuse a hidden folder, an empty name, a character a name cannot take, and folders that overlap", () => {
    expect(folderProblem({ internal: ".internal", wiki: "wiki" })).toMatch(/Obsidian hides a folder/);
    expect(folderProblem({ internal: "internal", wiki: "notes/.wiki" })).toMatch(/Obsidian hides a folder/);
    expect(folderProblem({ internal: "internal", wiki: "../wiki" })).toMatch(/Obsidian hides a folder/);
    expect(folderProblem({ internal: " / ", wiki: "wiki" })).toMatch(/needs a name/);
    expect(folderProblem({ internal: "internal", wiki: "wiki#1" })).toMatch(/cannot hold "#"/);
    expect(folderProblem({ internal: "library", wiki: "library/wiki" })).toMatch(/must be apart/);
    expect(folderProblem({ internal: "library/internal", wiki: "library/wiki" })).toBeUndefined();
    expect(() => new Folders({ internal: ".internal" })).toThrow(/Obsidian hides/);
  });

  it("read from .yami.json, the defaults without one, and say what is wrong with a bad one", async () => {
    expect(readFolders(join(tmpdir(), "yami-no-such-vault"))).toBe(DEFAULT_FOLDERS);
    const vault = await vaultWith({ wiki: "library/wiki" });
    expect(vault.folders.settings).toEqual({ internal: "internal", wiki: "library/wiki" });
    expect(() => parseFolderSettings("{")).toThrow(/\.yami\.json does not parse/);
    expect(() => parseFolderSettings("[]")).toThrow(/must hold an object/);
    expect(() => parseFolderSettings('{ "wiki": 3 }')).toThrow(/wiki must be a folder path/);
    expect(() => parseFolderSettings('{ "internal": ".yami" }')).toThrow(/\.yami\.json: The internal folder cannot be \.yami/);
    expect(folderSettingsText({ internal: "internal", wiki: "library/wiki" })).toBe('{\n  "wiki": "library/wiki"\n}\n');
  });

  it("map the wiki's paths from one layout to another where a path starts, and nowhere else", () => {
    const to = new Folders({ internal: "system", wiki: "library/wiki" });
    const text = "[[wiki/pages/RL|RL]] ![[internal/wiki/originals/abc.pdf]] (wiki/sources/S.md) my/wiki/pages/x wikiwiki/pages/y";
    expect(mapFolders(text, DEFAULT_FOLDERS, to)).toBe("[[library/wiki/pages/RL|RL]] ![[system/wiki/originals/abc.pdf]] (library/wiki/sources/S.md) my/wiki/pages/x wikiwiki/pages/y");
    expect(mapFolders(text, DEFAULT_FOLDERS, DEFAULT_FOLDERS)).toBe(text);
  });
});

describe("a vault with folders of its own", () => {
  it("installs every document in its internal folder, names its wiki folders in the texts the agents read, and writes nothing at the root", async () => {
    const vault = await vaultWith({ internal: "system/yami", wiki: "library/wiki" });
    const yami = await enabled(vault);
    const files = await vault.files("");
    expect(files.filter((path) => !path.startsWith("system/yami/"))).toEqual([]);
    expect(files).toContain("system/yami/wiki/skills/ingest/SKILL.md");
    expect(files).toContain("system/yami/yami/skills/run/SKILL.md");
    expect(yami.problems).toEqual([]);
    const ingest = await vault.read("system/yami/wiki/skills/ingest/SKILL.md");
    expect(ingest).toContain("`library/wiki/pages/`");
    expect(ingest).toContain("`system/yami/wiki/skills/ingest/`");
    expect(ingest).toContain("`system/yami/wiki/agents/extractor/AGENT.md`");
    expect(ingest).not.toMatch(/(?<![/\w])(internal|wiki)\/(topics|wiki)/);
    expect(await vault.read("system/yami/wiki/skills/ingest/page-rules.md")).toContain("[[library/wiki/sources/DINOv2|DINOv2]]");
    const wiki = yami.module("wiki") as WikiModule;
    expect(wiki.layout.folder).toBe("library/wiki");
    expect(wiki.layout.sessions).toBe("system/yami/wiki/sessions");
    const change = yami.tools().tools.find((tool) => tool.name === "wiki_change")!;
    expect(change.description).toContain("library/wiki/pages/");
    expect(yami.agents).toEqual([]);
  });

  it("changes only notes of its own topics and sources, and keeps its changes and versions in its internal folder", async () => {
    const vault = await vaultWith({ internal: "system", wiki: "library/wiki" });
    const yami = await enabled(vault);
    await expect(yami.wiki.change({ title: "Old place", writes: [{ op: "create", path: "wiki/pages/RL.md", properties: { description: "d" }, body: "b" }] })).rejects.toThrow(/under library\/wiki\/pages\/ or library\/wiki\/sources\//);
    const proposed = await yami.wiki.change({ title: "New topic", writes: [{ op: "create", path: "library/wiki/pages/RL.md", properties: { description: "Learning by reward." }, body: "An agent learns.\n" }] });
    expect(proposed.path.startsWith("system/wiki/changes/")).toBe(true);
    await yami.wiki.approve(proposed.path);
    expect((await readDocument(vault, "library/wiki/pages/RL.md")).properties.type).toBe("topic");
    expect((await yami.wiki.versions()).map((v) => v.path)).toEqual(["system/wiki/snapshots/v1.md", "system/wiki/snapshots/v2.md"]);
  });

  it("writes a bundle in the default layout, and imports one into its own", async () => {
    const vault = await vaultWith({ internal: "system", wiki: "library/wiki" });
    const yami = await enabled(vault);
    await knowledge(vault);
    await yami.wiki.refresh();
    const out = join(roots[0]!, "..", `${roots[0]!.split("/").pop()}-bundle`);
    roots.push(out);
    const written = await writeBundle(yami.wiki, await selectDocuments(yami.wiki, ["RL"]), out);
    expect(written.originals).toEqual(["system/wiki/originals/abc.pdf"]);
    const source = await readFile(join(out, "wiki/sources/Sutton (source).md"), "utf8");
    expect(source).toContain("[[internal/wiki/originals/abc.pdf]]");
    expect(await readFile(join(out, "internal/wiki/originals/abc.pdf"))).toEqual(Buffer.from([1, 2, 3]));
    await expect(writeBundle(yami.wiki, await selectDocuments(yami.wiki, ["RL"]), "library/wiki/out")).rejects.toThrow(/in the knowledge base/);

    const other = await vaultWith({ internal: "meta", wiki: "kb" });
    const bundle = await readBundle(other, out);
    expect(bundle.originals.map((o) => o.path)).toEqual(["meta/wiki/originals/abc.pdf"]);
    const read = bundle.notes.find((n) => n.type === "source")!;
    expect(read.path).toBe("kb/sources/Sutton (source).md");
    expect(read.properties.file).toBe("[[meta/wiki/originals/abc.pdf]]");
  });
});

describe("moving the folders", () => {
  it("moves the internal folder and the wiki, with the records that name their paths, and a new Yami over the vault finds everything", async () => {
    const vault = await vaultWith();
    const yami = await enabled(vault);
    await knowledge(vault);
    const proposed = await yami.wiki.change({ title: "A note", writes: [{ op: "create", path: "wiki/pages/MDP.md", properties: { description: "States and actions." }, body: "An MDP has states.\n" }] });
    await yami.wiki.approve(proposed.path);
    await writeProtected(vault, protect(await readProtected(vault), "wiki/pages/RL.md", "An agent learns from reward", { since: "2026-11-09T12:00:00" }));

    const moved = await yami.moveFolders({ internal: "system", wiki: "library/wiki" });
    expect(moved.moved).toEqual([
      { from: "internal", to: "system" },
      { from: "wiki", to: "library/wiki" },
    ]);
    expect(JSON.parse(await vault.read(".yami.json"))).toEqual({ internal: "system", wiki: "library/wiki" });
    expect(await vault.exists("internal")).toBe(false);
    expect(await vault.exists("wiki")).toBe(false);
    const installed = JSON.parse(await vault.read("system/wiki/installed.json")) as Record<string, string>;
    expect(Object.keys(installed).every((path) => path.startsWith("system/wiki/"))).toBe(true);
    expect(Object.keys((await readProtected(vault, "system/yami/protected.json")).notes)).toEqual(["library/wiki/pages/RL.md"]);
    // The vault here does not update links as Obsidian does; the move does.
    const rl = await vault.read("library/wiki/pages/RL.md");
    expect(rl).toContain("![[system/wiki/figures/RL/loop.svg]]");
    expect(rl).toContain("[[Sutton (source)]]");
    expect((await readDocument(vault, "library/wiki/sources/Sutton (source).md")).properties.file).toBe("[[system/wiki/originals/abc.pdf]]");

    const again = new FsVault(vault.root);
    expect(again.folders.settings).toEqual({ internal: "system", wiki: "library/wiki" });
    const next = await enabled(again);
    expect(next.problems).toEqual([]);
    expect(await again.read("system/wiki/skills/ingest/SKILL.md")).toContain("`library/wiki/pages/`");
    const applied = await next.wiki.changeDetails(proposed.path.replace(/^internal\//, "system/"));
    expect(applied.writes.map((w) => w.path)).toEqual(["library/wiki/pages/MDP.md"]);
    expect((await next.wiki.versions()).map((v) => v.archive)).toEqual(["system/wiki/snapshots/v1.json.gz", "system/wiki/snapshots/v2.json.gz"]);
    // A version from before the move comes back at the new paths, with its links moved too.
    await next.wiki.restore(1);
    expect(await again.exists("library/wiki/pages/MDP.md")).toBe(false);
    expect(await again.read("library/wiki/pages/RL.md")).toContain("![[system/wiki/figures/RL/loop.svg]]");
    expect(await again.exists("wiki/pages/RL.md")).toBe(false);
  });

  it("moves the targets of wiki links and markdown links, and leaves prose and other links alone", () => {
    const move = (path: string) => (path.startsWith("wiki/") ? `my wiki/${path.slice(5)}` : path);
    expect(moveLinks("See [[wiki/pages/RL|RL]], ![[wiki/x.png]], [m](wiki/pages/A%20B.md), [[notes/wiki/y]], and wiki/pages/RL in prose.", move)).toBe(
      "See [[my wiki/pages/RL|RL]], ![[my wiki/x.png]], [m](my%20wiki/pages/A%20B.md), [[notes/wiki/y]], and wiki/pages/RL in prose.",
    );
  });

  it("refuses a move into the other folder or onto a path in use, and a wiki move while a plan waits", async () => {
    const vault = await vaultWith();
    const yami = await enabled(vault);
    await expect(yami.moveFolders({ wiki: ".wiki" })).rejects.toThrow(/Obsidian hides/);
    await expect(yami.moveFolders({ wiki: "internal/wiki" })).rejects.toThrow(/must be apart/);
    await expect(yami.moveFolders({ internal: "wiki/internal", wiki: "kb" })).rejects.toThrow(/overlaps wiki/);
    await vault.write("library/wiki/note.md", "mine\n");
    await expect(yami.moveFolders({ wiki: "library/wiki" })).rejects.toThrow(/something is there already/);
    await yami.wiki.change({ title: "Waits", writes: [{ op: "create", path: "wiki/pages/A.md", properties: { description: "d" }, body: "b\n" }] });
    await expect(yami.moveFolders({ wiki: "kb" })).rejects.toThrow(/waits for approval/);
    const internalOnly = await yami.moveFolders({ internal: "system" });
    expect(internalOnly.moved).toEqual([{ from: "internal", to: "system" }]);
    expect(await vault.exists(".yami.json")).toBe(true);
  });
});
