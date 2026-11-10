import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runTool } from "../../src/agent/index.js";
import { link, readDocument } from "../../src/document/index.js";
import { FsVault, testYami } from "../../src/testing/index.js";
import { captureSource, changedRuns, CONTEXT_LINES, deltaChunks, lineDelta, mapRange, movedCitations, Wiki } from "../../src/wiki/index.js";
import { DEFAULT_FOLDERS } from "../../src/document/index.js";

const { sources: SOURCES, topics: TOPICS } = DEFAULT_FOLDERS;

let root = "";
let vault: FsVault;
const note = (path: string, properties: Record<string, unknown>, body: string) => vault.write(path, `---\n${vault.stringifyProperties(properties)}---\n${body}`);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "yami-delta-"));
  vault = new FsVault(root);
});
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe("the line delta", () => {
  it("maps each old line to its new line, and lists the changed and removed runs", () => {
    const before = ["a", "b", "c", "d", "e"].join("\n");
    const after = ["a", "B", "c", "d", "x", "y", "e"].join("\n");
    const delta = lineDelta(before, after);
    expect(Array.from(delta.map)).toEqual([0, 1, 0, 3, 4, 7]);
    expect(delta.changed).toEqual([
      { from: 2, to: 2 },
      { from: 5, to: 6 },
    ]);
    expect(delta.removed).toEqual([{ from: 2, to: 2 }]);
    expect(mapRange(delta, { from: 3, to: 4 })).toEqual({ from: 3, to: 4 });
    expect(mapRange(delta, { from: 5, to: 5 })).toEqual({ from: 7, to: 7 });
    expect(mapRange(delta, { from: 1, to: 3 })).toBeUndefined();
    expect(mapRange(delta, { from: 4, to: 5 })).toBeUndefined();
    expect(lineDelta("same\ntext", "same\ntext")).toMatchObject({ changed: [], removed: [] });
    expect(lineDelta("gone", "")).toMatchObject({ changed: [], removed: [{ from: 1, to: 1 }] });
  });

  it("reads each changed run with its context, joining runs that touch", () => {
    const delta = { map: new Int32Array(0), changed: [{ from: 30, to: 31 }, { from: 60, to: 60 }, { from: 400, to: 410 }], removed: [] };
    expect(changedRuns(delta, 500)).toEqual([
      { from: 30 - CONTEXT_LINES, to: 60 + CONTEXT_LINES },
      { from: 400 - CONTEXT_LINES, to: 410 + CONTEXT_LINES },
    ]);
    expect(changedRuns({ ...delta, changed: [{ from: 3, to: 3 }, { from: 498, to: 500 }] }, 500)).toEqual([
      { from: 1, to: 23 },
      { from: 478, to: 500 },
    ]);
    expect(changedRuns({ ...delta, changed: [] }, 500)).toEqual([]);
  });
});

describe("a source that supersedes another", () => {
  const original = ["# Notes", "An autoencoder learns a compressed code.", "The decoder expands it.", "## Training", "It trains with no labels.", "It takes nine epochs.", "## End", "Done."].join("\n");
  const edited = ["# Notes", "An autoencoder learns a compressed code.", "The decoder expands it.", "## Training", "It trains with no labels.", "It takes twelve epochs.", "It needs one GPU.", "## End", "Done."].join("\n");

  it("captures the edited file as a new source that supersedes the old, and lint warns on the topics that cite the old one", async () => {
    await vault.write("papers/notes.md", original);
    const first = await captureSource(vault, "papers/notes.md");
    await note(`${TOPICS}/Autoencoder.md`, { type: "topic", description: "A network.", sources: [link(first)] }, "It learns a code ([[notes (source)]], lines 2-3). It takes nine epochs ([[notes (source)]], line 6). The end ([[notes (source)]], § End). A bare one ([[notes (source)]]).\n");
    await note(`${TOPICS}/Other.md`, { type: "topic", description: "Another." }, "Nothing cited. See [[Autoencoder]].\n");
    await vault.write("papers/notes.md", edited);
    const second = await captureSource(vault, "papers/notes.md");
    expect(second).toBe(`${SOURCES}/notes (source 2).md`);
    expect((await readDocument(vault, second)).properties.supersedes).toBe(link(first));
    expect((await readDocument(vault, first)).properties.supersedes).toBeUndefined();

    const wiki = new Wiki(vault);
    await wiki.refresh();
    const findings = (await wiki.lint()).filter((f) => f.check === "superseded-citation");
    expect(findings).toEqual([
      {
        path: `${TOPICS}/Autoencoder.md`,
        check: "superseded-citation",
        severity: "warning",
        message: "cites [[notes (source)]], which [[notes (source 2)]] supersedes: the file changed since",
        fix: "run the ingest session of the new source (Wiki: ingest this file creates one), which moves the citations to it and revisits the claims the edit changed",
      },
    ]);

    const delta = await deltaChunks(vault, wiki, second);
    expect(delta.supersedes).toBe(first);
    expect(delta.delta).toBe(true);
    expect(delta.kind).toBe("lines");
    expect(delta.chunks.map((c) => c.locator)).toEqual(["lines 1-9"]);
    expect(delta.removed).toEqual([{ from: 6, to: 6 }]);
    expect(delta.citations).toEqual([
      { topic: `${TOPICS}/Autoencoder.md`, text: "([[notes (source)]], lines 2-3)", locator: "lines 2-3", claim: "It learns a code", status: "kept", moved: "lines 2-3" },
      { topic: `${TOPICS}/Autoencoder.md`, text: "([[notes (source)]], line 6)", locator: "line 6", claim: "It takes nine epochs", status: "changed" },
      { topic: `${TOPICS}/Autoencoder.md`, text: "([[notes (source)]], § End)", locator: "§ End", claim: "The end", status: "unknown" },
      { topic: `${TOPICS}/Autoencoder.md`, text: "([[notes (source)]])", claim: "A bare one", status: "kept" },
    ]);
    // A source that supersedes nothing is chunked whole, with no delta.
    const whole = await deltaChunks(vault, wiki, first);
    expect(whole.supersedes).toBeUndefined();
    expect(whole.chunks.map((c) => c.locator)).toEqual(["lines 1-8"]);
    expect(movedCitations(wiki, first, undefined).map((c) => c.status)).toEqual(["unknown", "unknown", "unknown", "kept"]);
  });

  it("gives no chunk for a file that changed in nothing, moves a citation past an insertion, and has no delta for a PDF", async () => {
    const long = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n");
    await vault.write("papers/long.md", long);
    const first = await captureSource(vault, "papers/long.md");
    await note(`${TOPICS}/T.md`, { type: "topic", description: "T.", sources: [link(first)] }, "A claim ([[long (source)]], lines 90-92).\n");
    await vault.write("papers/long.md", `${long}\n`);
    const trailing = await captureSource(vault, "papers/long.md");
    const wiki = new Wiki(vault);
    await wiki.refresh();
    const same = await deltaChunks(vault, wiki, trailing);
    expect(same.delta).toBe(true);
    expect(same.chunks).toEqual([]);
    expect(same.citations).toEqual([{ topic: `${TOPICS}/T.md`, text: "([[long (source)]], lines 90-92)", locator: "lines 90-92", claim: "A claim", status: "kept", moved: "lines 90-92" }]);

    await vault.write("papers/long.md", `new first line\n${long}`);
    const shifted = await captureSource(vault, "papers/long.md");
    await wiki.refresh();
    const moved = await deltaChunks(vault, wiki, shifted);
    // The newest capture supersedes the latest one before it.
    expect(moved.supersedes).toBe(trailing);
    expect(moved.chunks.map((c) => c.locator)).toEqual([`lines 1-${1 + CONTEXT_LINES}`]);
    expect(moved.citations).toEqual([]);
    // The topic cites the first source, two captures back; its citation stands against the latest.
    expect(movedCitations(wiki, first, lineDelta(long, `new first line\n${long}`))[0]).toMatchObject({ status: "kept", moved: "lines 91-93" });

    await vault.write("papers/scan.pdf", "%PDF-1.4\n" + "2 0 obj << /Type /Page >> endobj\n".repeat(3));
    const pdf = await captureSource(vault, "papers/scan.pdf");
    await note(`${TOPICS}/P.md`, { type: "topic", description: "P.", sources: [link(pdf)] }, "A claim ([[scan (source)]], p. 2).\n");
    await vault.write("papers/scan.pdf", "%PDF-1.4\n" + "2 0 obj << /Type /Page >> endobj\n".repeat(4));
    const pdf2 = await captureSource(vault, "papers/scan.pdf");
    await wiki.refresh();
    const pages = await deltaChunks(vault, wiki, pdf2);
    expect(pages).toMatchObject({ supersedes: pdf, delta: false, kind: "pages" });
    expect(pages.chunks.map((c) => c.locator)).toEqual(["pages 1-4"]);
    expect(pages.citations).toEqual([{ topic: `${TOPICS}/P.md`, text: "([[scan (source)]], p. 2)", locator: "p. 2", claim: "A claim", status: "unknown" }]);
  });

  it("is what wiki_chunks returns, and the ingest skill, the drafter, and the page forms say what to do with it", async () => {
    const t = await testYami();
    try {
      await t.vault.write("papers/notes.md", original);
      await captureSource(t.vault, "papers/notes.md");
      await t.vault.write("papers/notes.md", edited);
      const second = await captureSource(t.vault, "papers/notes.md");
      const chunks = t.yami.tools().tools.find((tool) => tool.name === "wiki_chunks")!;
      const result = JSON.parse((await runTool(chunks, { source: second }, new AbortController().signal)).text);
      expect(result).toMatchObject({ delta: true, supersedes: `${SOURCES}/notes (source).md`, citations: [] });
      expect(await t.vault.read("internal/wiki/skills/ingest/SKILL.md")).toContain("A source that **supersedes** an earlier capture");
      expect(await t.vault.read("internal/wiki/agents/drafter/AGENT.md")).toContain("## A superseded source");
      expect(await t.vault.read("internal/wiki/skills/ingest/page-forms.md")).toContain("superseded-citation");
    } finally {
      t.dispose();
    }
  });
});
