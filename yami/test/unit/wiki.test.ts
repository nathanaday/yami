import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runTool } from "../../src/agent/index.js";
import { link, linkTarget, PropertiesError, readDocument } from "../../src/document/index.js";
import { runCheck, Yami, type WikiModule } from "../../src/index.js";
import { algorithms, bodyHash, captureSource, captureSources, chunk, countPages, hash, hashBytes, InvalidPlan, lineChunks, normalizeTag, SOURCES, sourceChunks, stem, tokens, TOPICS, Wiki, type Embedder } from "../../src/wiki/index.js";
import { FsVault } from "../../src/testing/index.js";

let root = "";
let vault: FsVault;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "yami-wiki-"));
  vault = new FsVault(root);
});
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

/** A Yami over the test vault, with the wiki module installed, and the wiki's ingest flow. */
async function enabled() {
  const yami = new Yami({ vault });
  await yami.enable();
  return { yami, ingest: (yami.module("wiki") as WikiModule).ingest };
}

const note = (path: string, properties: Record<string, unknown>, body: string) =>
  vault.write(path, `---\n${vault.stringifyProperties(properties)}---\n${body}`);

/** A small vault: two clusters of notes, linked within each cluster, and one bridge. */
async function fixture() {
  await note(`${TOPICS}/Codex harness.md`, { type: "topic", description: "How Yami runs Codex.", tags: ["yami/agent"], sources: [link(`${SOURCES}/codex-notes.md`)] }, "## What it is\n\nThe adapter runs app-server over stdio ([[codex-notes]]). See [[Interrupt]] and [[Claude harness]].\n");
  await note(`${TOPICS}/Claude harness.md`, { type: "topic", description: "How Yami runs Claude Code.", tags: ["yami/agent"], sources: [link(`${SOURCES}/codex-notes.md`)] }, "## What it is\n\nOne process for each session ([[codex-notes]]). It has a stall watchdog. See [[Interrupt]].\n");
  await note(`${TOPICS}/Interrupt.md`, { type: "topic", description: "Stopping a turn in either harness.", tags: ["yami/agent"], sources: [link(`${SOURCES}/codex-notes.md`)] }, "## Definition\n\nAn interrupt stops the current turn ([[codex-notes]]). Codex stops its server; see [[Codex harness]].\n");
  await note(`${SOURCES}/codex-notes.md`, { type: "source", description: "Notes on the Codex app-server protocol.", tags: ["yami/agent"], file: "[[attachments/codex.pdf]]", status: "absorbed" }, "![[attachments/codex.pdf]]\n\n## Summary\n\nThe protocol is JSON-RPC over stdio.\n");
  await note(`${TOPICS}/Sourdough.md`, { type: "topic", description: "Bread from a wild yeast starter.", tags: ["cooking/bread"], sources: [] }, "## Definition\n\nA starter of flour and water ferments. See [[Levain]].\n");
  await note(`${TOPICS}/Levain.md`, { type: "topic", description: "A sourdough starter, in the French usage.", tags: ["cooking/bread"], aliases: ["Starter"], sources: [] }, "## Definition\n\nLevain is the starter ([[Sourdough]]).\n");
  await note("journal/2026-10-14.md", {}, "Baked [[Sourdough]] today. Codex turns can be slow.\n");
  await note("conversations/old chat.md", { type: "conversation", agent: "claude" }, "> [!user]\n> codex codex codex interrupt interrupt\n");
  await vault.write("attachments/codex.pdf", "not really a pdf");
  const wiki = new Wiki(vault);
  await wiki.refresh();
  return wiki;
}

describe("tokens", () => {
  it("lowers, drops stop words and short words, and folds plurals", () => {
    expect(tokens("The Harnesses of Yami: adapters, 2 of them")).toEqual(["harness", "yami", "adapter"]);
    expect(stem("policies")).toBe("policy");
    expect(stem("class")).toBe("class");
    expect(stem("status")).toBe("status");
  });

  it("hashes the same text to the same key", () => {
    expect(hash("a chunk")).toBe(hash("a chunk"));
    expect(hash("a chunk")).not.toBe(hash("a chunk."));
  });
});

describe("chunk", () => {
  it("splits at headings and keeps the heading as the chunk's name", () => {
    const chunks = chunk("intro\n\n## One\n\nfirst\n\n## Two\n\nsecond", "Note");
    expect(chunks.map((c) => [c.heading, c.text, c.from, c.to])).toEqual([
      ["Note", "intro", 1, 2],
      ["One", "first", 4, 6],
      ["Two", "second", 8, 9],
    ]);
  });

  it("splits a long section at a blank line", () => {
    const para = "x".repeat(1500);
    const chunks = chunk(`## Long\n\n${para}\n\n${para}`, "Note");
    expect(chunks).toHaveLength(2);
    expect(chunks.every((c) => c.heading === "Long")).toBe(true);
  });
});

describe("Wiki index", () => {
  it("indexes every note except transcripts, resolves links by name and path, and keeps backlinks", async () => {
    const wiki = await fixture();
    expect(wiki.notes.map((n) => n.path)).not.toContain("conversations/old chat.md");
    expect(wiki.notes).toHaveLength(7);
    const codex = wiki.note(`${TOPICS}/Codex harness.md`)!;
    expect(codex.links.sort()).toEqual([`${SOURCES}/codex-notes.md`, `${TOPICS}/Claude harness.md`, `${TOPICS}/Interrupt.md`]);
    expect(wiki.note(`${TOPICS}/Interrupt.md`)!.backlinks.sort()).toEqual([`${TOPICS}/Claude harness.md`, `${TOPICS}/Codex harness.md`]);
    expect(wiki.note(`${TOPICS}/Sourdough.md`)!.backlinks).toContain("journal/2026-10-14.md");
    expect(wiki.resolve("[[Levain|the starter]]")).toBe(`${TOPICS}/Levain.md`);
    expect(wiki.resolve(`${TOPICS}/Levain`)).toBe(`${TOPICS}/Levain.md`);
    expect(wiki.resolve("Nothing")).toBeUndefined();
    expect(codex.unresolved).toEqual([]);
  });

  it("expands tags upward, so a note holds every tag above its own", async () => {
    const wiki = await fixture();
    expect(wiki.note(`${TOPICS}/Levain.md`)!.tags).toEqual(["cooking", "cooking/bread"]);
    expect((await wiki.search("starter", { tags: ["cooking"] })).map((h) => h.path)).toContain(`${TOPICS}/Levain.md`);
    expect(await wiki.search("starter", { tags: ["yami"] })).toEqual([]);
  });

  it("shares one refresh among concurrent queries, and reads again after a change during it", async () => {
    const wiki = await fixture();
    wiki.invalidate();
    // Each refresh lists the vault once.
    let refreshes = 0;
    const list = vault.list.bind(vault);
    vault.list = (folder: string) => {
      refreshes += 1;
      return list(folder);
    };
    await Promise.all([wiki.search("codex"), wiki.search("levain"), wiki.search("starter")]);
    expect(refreshes).toBe(1);

    refreshes = 0;
    wiki.invalidate();
    const first = wiki.ensure();
    await note(`${TOPICS}/Rye.md`, { type: "topic", description: "Rye bread." }, "Like [[Sourdough]].");
    wiki.invalidate();
    await first;
    expect(refreshes).toBe(2);
    expect(wiki.note(`${TOPICS}/Rye.md`)).toBeDefined();
  });

  it("refreshes to see new notes and marks communities", async () => {
    const wiki = await fixture();
    const agent = wiki.note(`${TOPICS}/Codex harness.md`)!.community;
    expect(agent).toBe(wiki.note(`${TOPICS}/Interrupt.md`)!.community);
    expect(agent).not.toBe(wiki.note(`${TOPICS}/Sourdough.md`)!.community);
    await note(`${TOPICS}/New.md`, { type: "topic", description: "New." }, "Links [[Levain]].");
    await wiki.refresh();
    expect(wiki.note(`${TOPICS}/New.md`)).toBeDefined();
    expect(wiki.note(`${TOPICS}/Levain.md`)!.backlinks).toContain(`${TOPICS}/New.md`);
  });
});

describe("algorithms", () => {
  it("bm25 ranks a title match first, with scores in [0, 1] and a snippet", async () => {
    const wiki = await fixture();
    const hits = await wiki.search("codex harness");
    expect(hits[0]).toMatchObject({ path: `${TOPICS}/Codex harness.md`, score: 1, why: "title match" });
    expect(hits[0]!.snippet).toContain("app-server");
    expect(hits.every((h) => h.score > 0 && h.score <= 1)).toBe(true);
    expect(hits.map((h) => h.path)).not.toContain(`${TOPICS}/Sourdough.md`);
  });

  it("ppr reaches a note with no matching text through links, and its Monte Carlo variant agrees", async () => {
    const wiki = await fixture();
    const power = await wiki.search("stall watchdog", { algorithm: "ppr" });
    const paths = power.map((h) => h.path);
    expect(paths[0]).toBe(`${TOPICS}/Claude harness.md`);
    expect(paths).toContain(`${TOPICS}/Interrupt.md`);
    expect(paths).not.toContain(`${TOPICS}/Sourdough.md`);
    expect(power.find((h) => h.path === `${TOPICS}/Interrupt.md`)!.why).toBe("reached by links from the seeds");
    const walks = await wiki.search("stall watchdog", { algorithm: "ppr", params: { walks: 20000 } });
    expect(walks[0]!.path).toBe(`${TOPICS}/Claude harness.md`);
    expect(walks.map((h) => h.path)).toContain(`${TOPICS}/Interrupt.md`);
  });

  it("ppr with seeds and no text returns the related notes", async () => {
    const wiki = await fixture();
    const hits = await wiki.search("", { seeds: ["Levain"], algorithm: "ppr" });
    // The seed's one neighbor gathers the most walk mass, as PageRank has it.
    expect(hits.map((h) => h.path)).toEqual([`${TOPICS}/Sourdough.md`, `${TOPICS}/Levain.md`, "journal/2026-10-14.md"]);
  });

  it("hop2 inherits a decayed score through two hops and says where from", async () => {
    const wiki = await fixture();
    const hits = await wiki.search("stall watchdog", { algorithm: "hop2" });
    const interrupt = hits.find((h) => h.path === `${TOPICS}/Interrupt.md`)!;
    expect(interrupt.why).toBe("linked from Claude harness");
    expect(hits[0]!.path).toBe(`${TOPICS}/Claude harness.md`);
    expect(hits.map((h) => h.path)).toContain(`${SOURCES}/codex-notes.md`);
    expect(hits.map((h) => h.path)).not.toContain(`${TOPICS}/Levain.md`);
  });

  it("louvain gives the whole community of the seeds a share", async () => {
    const wiki = await fixture();
    const hits = await wiki.search("stall watchdog", { algorithm: "louvain" });
    expect(hits[0]!.path).toBe(`${TOPICS}/Claude harness.md`);
    const codex = hits.find((h) => h.path === `${TOPICS}/Codex harness.md`)!;
    expect(codex.why).toBe("in the community of Claude harness");
    expect(hits.map((h) => h.path)).not.toContain(`${TOPICS}/Levain.md`);
  });

  it("hybrid without an embedder ranks chunks lexically and says so", async () => {
    const wiki = await fixture();
    const hits = await wiki.search("JSON-RPC stdio", { algorithm: "hybrid" });
    expect(hits[0]).toMatchObject({ path: `${SOURCES}/codex-notes.md`, score: 1 });
    expect(hits[0]!.why).toContain('chunk "Summary": lexical (no embedder)');
    expect(hits[0]!.snippet).toContain("JSON-RPC");
  });

  it("hybrid with an embedder finds a note with no shared words, and caches the vectors", async () => {
    const calls: string[][] = [];
    const embedder: Embedder = {
      id: "fake",
      async embed(texts) {
        calls.push(texts);
        // Bread and yeast point one way, everything else another.
        return texts.map((text) => Float32Array.from(/bread|yeast|starter|levain|flour|loaf/i.test(text) ? [1, 0] : [0, 1]));
      },
    };
    const wiki = new Wiki(vault, { embedder });
    await fixture();
    await wiki.refresh();
    const hits = await wiki.search("baking a loaf", { algorithm: "hybrid" });
    expect(hits.map((h) => h.path)).toContain(`${TOPICS}/Levain.md`);
    expect(hits.find((h) => h.path === `${TOPICS}/Levain.md`)!.why).toContain("semantic");
    const documentCalls = calls.filter((c) => c.length > 1).length;
    expect(documentCalls).toBe(1);
    expect(await vault.exists("internal/wiki/cache/embeddings.json")).toBe(true);
    const again = new Wiki(vault, { embedder });
    await again.search("baking a loaf", { algorithm: "hybrid" });
    expect(calls.filter((c) => c.length > 1).length).toBe(documentCalls);
  });

  it("names every algorithm in the registry and refuses an unknown one", async () => {
    const wiki = await fixture();
    expect(Object.keys(algorithms).sort()).toEqual(["bm25", "hop2", "hybrid", "louvain", "ppr"]);
    await expect(wiki.search("x", { algorithm: "magic" })).rejects.toThrow('No algorithm named "magic"');
  });

  it("filters by type and folder and respects the limit", async () => {
    const wiki = await fixture();
    expect((await wiki.search("codex", { types: ["source"] })).map((h) => h.path)).toEqual([`${SOURCES}/codex-notes.md`]);
    expect((await wiki.search("codex", { folder: "journal" })).map((h) => h.path)).toEqual(["journal/2026-10-14.md"]);
    expect(await wiki.search("codex", { limit: 1 })).toHaveLength(1);
  });
});

describe("match", () => {
  it("reports a hit by name or alias, a near note, and a new subject", async () => {
    const wiki = await fixture();
    const [hit, alias, near, fresh] = await wiki.match(["codex  Harness", "Starters", "Claude Code harness", "Quantum chromodynamics"]);
    expect(hit).toMatchObject({ match: "hit", path: `${TOPICS}/Codex harness.md` });
    expect(alias).toMatchObject({ match: "hit", path: `${TOPICS}/Levain.md` });
    expect(near!.match).toBe("near");
    expect(near!.neighbors[0]!.path).toBe(`${TOPICS}/Claude harness.md`);
    expect(fresh).toMatchObject({ match: "new", neighbors: [] });
  });
});

describe("lint", () => {
  it("finds dead links, missing descriptions, uncited sources, orphans, and duplicate names", async () => {
    const wiki = await fixture();
    await note(`${TOPICS}/Broken.md`, { type: "topic", description: "" }, "See [[Nowhere]] and [[Levain]].");
    await note(`${SOURCES}/unread.md`, { type: "source", description: "A paper nobody cites.", file: "[[x.pdf]]", status: "pending" }, "");
    await note("other/Levain.md", {}, "A note with the same name.");
    await wiki.refresh();
    const findings = await wiki.lint();
    const of = (path: string) => findings.filter((f) => f.path === path).map((f) => f.check).sort();
    expect(of(`${TOPICS}/Broken.md`)).toEqual(["dead-link", "no-description", "no-sources", "orphan"]);
    expect(of(`${SOURCES}/unread.md`)).toEqual(["uncited"]);
    // The link [[Levain]] now resolves to the shorter path, other/Levain.md, so the topic lost its backlink: what duplicate-name warns about.
    expect(of(`${TOPICS}/Levain.md`)).toEqual(["duplicate-name", "no-sources", "orphan"]);
    expect(of(`${TOPICS}/Codex harness.md`)).toEqual([]);
    expect(findings.find((f) => f.check === "dead-link")).toMatchObject({ severity: "error", message: "links [[Nowhere]], which is not a note" });
    expect(await wiki.lint({ paths: ["[[Broken]]"] })).toHaveLength(4);
    expect((await wiki.lint({ folder: SOURCES })).map((f) => f.path)).toEqual([`${SOURCES}/unread.md`]);
  });
});

describe("captureSource", () => {
  it("copies the file under its content hash, leaves it in place, and writes a source note with its own name", async () => {
    await vault.write("attachments/paper.pdf", "pdf bytes");
    await vault.write("Pattern Making/Sources/Darts.md", "# Darts\n\nA dart takes in fullness.\n");
    const pdf = await captureSource(vault, "attachments/paper.pdf");
    const md = await captureSource(vault, "Pattern Making/Sources/Darts.md");
    expect(pdf).toBe(`${SOURCES}/paper (source).md`);
    expect(md).toBe(`${SOURCES}/Darts (source).md`);

    const sha = await hashBytes(new TextEncoder().encode("pdf bytes"));
    const copy = `internal/wiki/originals/${sha.slice(0, 16)}.pdf`;
    expect(await vault.read(copy)).toBe("pdf bytes");
    expect(await vault.read("attachments/paper.pdf")).toBe("pdf bytes");
    const doc = await readDocument(vault, pdf);
    expect(doc.properties).toMatchObject({ type: "source", status: "pending", file: `[[${copy}]]`, from: "[[attachments/paper.pdf]]", sha256: sha });
    expect(doc.body.startsWith(`![[${copy}]]`)).toBe(true);
    expect((await readDocument(vault, md)).properties.from).toBe("[[Pattern Making/Sources/Darts|Darts]]");

    // The note and its source no longer share a name, so lint finds no duplicate, and a link by name is plain.
    const wiki = new Wiki(vault);
    await wiki.refresh();
    expect((await wiki.lint()).filter((f) => f.check === "duplicate-name")).toEqual([]);
    expect(wiki.resolve("Darts")).toBe("Pattern Making/Sources/Darts.md");
    expect(wiki.resolve("Darts (source)")).toBe(md);
    expect(wiki.notes.some((n) => n.path.startsWith("internal/wiki/originals/"))).toBe(false);
  });

  it("keeps what it captured when the file changes, and captures each content once", async () => {
    await vault.write("notes/idea.md", "First version.");
    const first = await captureSource(vault, "notes/idea.md");
    await vault.write("notes/copy of idea.md", "First version.");
    expect(await captureSource(vault, "notes/copy of idea.md")).toBe(first);

    await vault.write("notes/idea.md", "Second version.");
    const second = await captureSource(vault, "notes/idea.md");
    expect(second).toBe(`${SOURCES}/idea (source 2).md`);
    const copies = await vault.files("internal/wiki/originals");
    expect(copies).toHaveLength(2);
    const firstCopy = linkTarget(String((await readDocument(vault, first)).properties.file));
    expect(await vault.read(firstCopy)).toBe("First version.");
  });

  it("refuses a missing file and a file of the wiki itself", async () => {
    await expect(captureSource(vault, "missing.pdf")).rejects.toThrow("No file");
    await note(`${TOPICS}/Levain.md`, { type: "topic", description: "x" }, "x");
    await expect(captureSource(vault, `${TOPICS}/Levain.md`)).rejects.toThrow("part of the wiki itself");
  });
});

describe("checks", () => {
  it("property is met when every linked note has the value, and lint when their notes have no error", async () => {
    const wiki = await fixture();
    await note(`${SOURCES}/pending.md`, { type: "source", description: "Pending.", file: "[[x.pdf]]", status: "pending" }, "");
    await wiki.refresh();
    const context = (sources: string[]) => ({ vault, wiki, path: "s.md", properties: { sources: sources.map(link) } });
    const absorbed = { path: "p", properties: { check: "property", field: "sources", property: "status", value: "absorbed" }, body: "" };
    expect(await runCheck(absorbed, context([`${SOURCES}/codex-notes.md`]))).toMatchObject({ status: "met" });
    expect(await runCheck(absorbed, context([`${SOURCES}/codex-notes.md`, `${SOURCES}/pending.md`]))).toMatchObject({
      status: "unmet",
      detail: `status is not absorbed in ${SOURCES}/pending.md`,
    });
    expect(await runCheck(absorbed, context(["gone"]))).toMatchObject({ status: "unmet", detail: "sources links gone, which are not notes" });
    expect(await runCheck(absorbed, context([]))).toMatchObject({ status: "met" });

    const clean = { path: "p", properties: { check: "lint", field: "sources" }, body: "" };
    expect(await runCheck(clean, context([`${SOURCES}/codex-notes.md`]))).toMatchObject({ status: "met", detail: "lint found no error in 4 note(s)" });
    await note(`${TOPICS}/Interrupt.md`, { type: "topic", description: "" }, "Cites [[codex-notes]] and [[Nowhere]].");
    await wiki.refresh();
    const result = await runCheck(clean, context([`${SOURCES}/codex-notes.md`]));
    expect(result.status).toBe("unmet");
    expect(result.detail).toContain("2 lint error(s)");
    expect(await runCheck({ path: "p", properties: { check: "lint" }, body: "" }, context([]))).toMatchObject({ status: "review" });
  });
});

describe("the tag hierarchy", () => {
  /** Tags at three depths, written every way a person writes them, and a parent tag that no note holds itself. */
  async function tagged() {
    const notes: [string, unknown][] = [
      ["A", ["ml"]],
      ["B", ["ml/vision"]],
      ["C", ["ml/vision/detection", "Cooking"]],
      ["D", ["#ML/Vision"]],
      ["E", ["ml/nlp"]],
      ["F", "ml//nlp/ , art"],
      ["G", undefined],
      ["H", ["physics/quantum"]],
      ["I", ["ml", "ml/vision"]],
    ];
    for (const [name, tags] of notes) await note(`notes/${name}.md`, tags === undefined ? {} : { tags }, `${name}.\n`);
    const wiki = new Wiki(vault);
    await wiki.refresh();
    return wiki;
  }
  const at = (path: string) => `notes/${path}.md`;

  it("keeps the tags a note holds itself, in the index's form, beside the tags above them", async () => {
    const wiki = await tagged();
    expect(wiki.note(at("D"))).toMatchObject({ ownTags: ["ml/vision"], tags: ["ml", "ml/vision"] });
    expect(wiki.note(at("F"))!.ownTags).toEqual(["ml/nlp", "art"]);
    expect(wiki.note(at("G"))!.ownTags).toEqual([]);
    expect(normalizeTag("  #A//B/ ")).toBe("a/b");
    expect(normalizeTag("##x")).toBe("x");
    expect(normalizeTag("#")).toBe("");
  });

  it("shows the top: every tag with no /, most notes first, and how many notes hold any tag", async () => {
    const wiki = await tagged();
    expect(await wiki.tag()).toEqual({
      tag: "",
      count: 8,
      above: [],
      below: [
        { tag: "ml", count: 7 },
        { tag: "art", count: 1 },
        { tag: "cooking", count: 1 },
        { tag: "physics", count: 1 },
      ],
      notes: [],
    });
  });

  it("shows a tag: the tags above it, the tags one level below it, and the notes that hold it, by name", async () => {
    const wiki = await tagged();
    expect(await wiki.tag("ml")).toEqual({ tag: "ml", count: 7, above: [], below: [{ tag: "ml/vision", count: 4 }, { tag: "ml/nlp", count: 2 }], notes: [at("A"), at("I")] });
    expect(await wiki.tag("#ML/Vision")).toEqual({
      tag: "ml/vision",
      count: 4,
      above: [{ tag: "ml", count: 7 }],
      below: [{ tag: "ml/vision/detection", count: 1 }],
      notes: [at("B"), at("D"), at("I")],
    });
    expect(await wiki.tag("ml/vision/detection")).toMatchObject({ above: [{ tag: "ml", count: 7 }, { tag: "ml/vision", count: 4 }], below: [], notes: [at("C")] });
    // No note holds physics itself: it has a count, and its notes are under the tag below it.
    expect(await wiki.tag("physics")).toEqual({ tag: "physics", count: 1, above: [], below: [{ tag: "physics/quantum", count: 1 }], notes: [] });
    expect(await wiki.tag("nothing")).toBeUndefined();
  });

  it("gives a note's neighbors: its tags, the tags above them, and the tags one level below them, never its own twice", async () => {
    const wiki = await tagged();
    expect(await wiki.neighbors(at("C"))).toEqual({
      path: at("C"),
      tags: [{ tag: "cooking", count: 1 }, { tag: "ml/vision/detection", count: 1 }],
      above: [{ tag: "ml", count: 7 }, { tag: "ml/vision", count: 4 }],
      below: [],
    });
    expect(await wiki.neighbors("A")).toEqual({ path: at("A"), tags: [{ tag: "ml", count: 7 }], above: [], below: [{ tag: "ml/vision", count: 4 }, { tag: "ml/nlp", count: 2 }] });
    expect(await wiki.neighbors("[[I]]")).toEqual({
      path: at("I"),
      tags: [{ tag: "ml", count: 7 }, { tag: "ml/vision", count: 4 }],
      above: [],
      below: [{ tag: "ml/nlp", count: 2 }, { tag: "ml/vision/detection", count: 1 }],
    });
    expect(await wiki.neighbors(at("G"))).toEqual({ path: at("G"), tags: [], above: [], below: [] });
    expect(await wiki.neighbors("nowhere")).toBeUndefined();
  });

  it("follows the vault: a tag that a note gains or loses moves at the next refresh", async () => {
    const wiki = await tagged();
    await note(at("G"), { tags: ["ml/vision"] }, "G.\n");
    await vault.remove(at("C"));
    await wiki.refresh();
    expect(await wiki.tag("ml/vision")).toMatchObject({ count: 4, below: [], notes: [at("B"), at("D"), at("G"), at("I")] });
    expect(await wiki.tag("ml/vision/detection")).toBeUndefined();
  });

  it("is a tool for every agent: a note, a tag, or the top, with a tag's notes cut to the limit", async () => {
    await tagged();
    const { yami } = await enabled();
    const tool = yami.tools()!.tools.find((t) => t.name === "wiki_neighbors")!;
    const call = async (input: unknown) => runTool(tool, input, new AbortController().signal);
    expect(JSON.parse((await call({ note: "C" })).text)).toMatchObject({ path: at("C"), above: [{ tag: "ml" }, { tag: "ml/vision" }] });
    expect(JSON.parse((await call({ tag: "ml/vision", limit: 2 })).text)).toMatchObject({ tag: "ml/vision", notes: [at("B"), at("D")], more: 1 });
    expect(JSON.parse((await call({})).text).below[0]).toEqual({ tag: "ml", count: 7 });
    expect(await call({ note: "C", tag: "ml" })).toEqual({ text: "Give a note or a tag, not both.", isError: true });
    expect(await call({ tag: "nothing" })).toMatchObject({ isError: true, text: expect.stringContaining("No note holds the tag nothing") });
    expect(await call({ note: "nowhere" })).toMatchObject({ isError: true, text: "nowhere is not a note of the wiki." });
    expect(await call({ tag: "#/" })).toEqual({ text: '"#/" is not a tag. Leave tag out for the top tags.', isError: true });
  });
  it("shows a tag once when it is above one of a note's tags and below another", async () => {
    const wiki = await tagged();
    await note(at("J"), { tags: ["ml", "ml/vision/detection"] }, "J.\n");
    // A host marks the index stale on a change in the vault; the next read refreshes it.
    wiki.invalidate();
    const neighbors = (await wiki.neighbors(at("J")))!;
    expect(neighbors.tags.map((t) => t.tag)).toEqual(["ml", "ml/vision/detection"]);
    expect(neighbors.above.map((t) => t.tag)).toEqual(["ml/vision"]);
    expect(neighbors.below.map((t) => t.tag)).toEqual(["ml/nlp"]);
  });

  it("counts only the notes the index holds: no session, no conversation, and no copy", async () => {
    await tagged();
    await note("notes/Session.md", { type: "session", module: "x", tags: ["ml"] }, "S.\n");
    await note("notes/Copy.md", { copy_of: "[[notes/A]]", tags: ["ml"] }, "C.\n");
    await note("conversations/Chat.md", { tags: ["ml"] }, "Chat.\n");
    const wiki = new Wiki(vault, { exclude: ["conversations"] });
    expect(await wiki.tag("ml")).toMatchObject({ count: 7, notes: [at("A"), at("I")] });
    expect(wiki.holds("notes/A.md", { tags: ["ml"] })).toBe(true);
    expect(wiki.holds("notes/Session.md", { type: "session" })).toBe(false);
    expect(wiki.holds("notes/Copy.md", { copy_of: "[[notes/A]]" })).toBe(false);
    expect(wiki.holds("conversations/Chat.md")).toBe(false);
    expect(wiki.holds("internal/wiki/skills/ingest/SKILL.md")).toBe(false);
    expect(wiki.holds("notes/picture.png")).toBe(false);
  });

  it("lists every tag with its count, and filters a search by a tag in any of its forms", async () => {
    const wiki = await tagged();
    expect(wiki.tags().slice(0, 3)).toEqual([
      { tag: "ml", count: 7 },
      { tag: "ml/vision", count: 4 },
      { tag: "ml/nlp", count: 2 },
    ]);
    const paths = async (tags: string[]) => (await wiki.search("", { seeds: [], tags, limit: 50 })).map((h) => h.path).sort();
    expect(await paths(["#ML/Vision/"])).toEqual(await paths(["ml/vision"]));
  });
});

describe("a note whose properties do not parse", () => {
  it("stays in the index with its body and no properties, and lint names it as an error with a fix", async () => {
    const wiki = await fixture();
    await vault.write("tool/old.md", "---\ndescription: Fix a scroll stop: the editor counted as out of view.\n---\nThe scroll pinned at the edge indicator.\n");
    await wiki.refresh();
    expect(wiki.note("tool/old.md")).toMatchObject({ properties: {}, problem: expect.stringContaining("Nested mappings are not allowed") });
    expect((await wiki.search("scroll pinned edge indicator")).map((h) => h.path)).toContain("tool/old.md");
    const findings = await wiki.lint({ paths: ["tool/old.md"] });
    expect(findings).toEqual([
      expect.objectContaining({ path: "tool/old.md", check: "bad-properties", severity: "error", message: expect.stringMatching(/^its properties do not parse: Nested mappings/) }),
    ]);
    expect((await wiki.lint({ folder: "wiki/topics" })).some((f) => f.check === "bad-properties")).toBe(false);
  });

  it("names the note when a read of it fails", async () => {
    await vault.write("tool/old.md", "---\ntitle: a: b\n---\nBody.\n");
    const error = await readDocument(vault, "tool/old.md").catch((e: Error) => e);
    expect(error).toBeInstanceOf(PropertiesError);
    expect((error as PropertiesError).message).toMatch(/^The properties of tool\/old\.md do not parse: Nested mappings are not allowed in compact mappings at line 1, column 8:?$/);
    expect((error as PropertiesError).body).toBe("Body.\n");
    await vault.write("tool/list.md", "---\n- a\n- b\n---\nBody.\n");
    await expect(readDocument(vault, "tool/list.md")).rejects.toThrow("The properties of tool/list.md do not parse: the properties are not names with values");
  });
});

describe("the wiki module", () => {
  it("installs its documents and serves search, match, and lint as tools", async () => {
    await fixture();
    const { yami, ingest } = await enabled();
    for (const file of ["internal/wiki/skills/ingest/SKILL.md", "internal/wiki/skills/ingest/extractor.md", "internal/wiki/skills/ingest/drafter.md", "internal/wiki/skills/ingest/page-forms.md", "internal/wiki/promises/sources-absorbed/PROMISE.md"]) {
      expect(await vault.exists(file), file).toBe(true);
    }
    const { path } = await ingest.create({ name: "Ingest codex", exact: true, fields: { sources: [link(`${SOURCES}/codex-notes.md`)] } });
    expect((await readDocument(vault, path)).properties.sources).toEqual([link(`${SOURCES}/codex-notes.md`)]);
    const set = { tools: yami.tools().tools.filter((t) => t.name.startsWith("wiki_")) };
    expect(set.tools.map((t) => t.name)).toEqual(["wiki_search", "wiki_match", "wiki_lint", "wiki_tags", "wiki_neighbors", "wiki_chunks", "wiki_change"]);
    const signal = new AbortController().signal;
    const search = JSON.parse((await runTool(set.tools[0]!, { text: "codex harness", limit: 1 }, signal)).text);
    expect(search.hits[0].path).toBe(`${TOPICS}/Codex harness.md`);
    const match = JSON.parse((await runTool(set.tools[1]!, { names: ["Levain"] }, signal)).text);
    expect(match.matches[0].match).toBe("hit");
    const lint = JSON.parse((await runTool(set.tools[2]!, { folder: TOPICS }, signal)).text);
    expect(lint.findings.map((f: { check: string }) => f.check)).toContain("no-sources");
  });
});

describe("versions", () => {
  it("snapshots the knowledge base, knows when it is captured, and restores a version as a new one", async () => {
    const wiki = await fixture();
    expect((await wiki.captured()).captured).toBe(false);
    const v1 = await wiki.snapshot();
    expect(v1).toMatchObject({ version: 1, notes: 6, archive: "internal/wiki/snapshots/v1.json.gz" });
    expect(await vault.exists(v1.archive)).toBe(true);
    expect((await wiki.captured())).toMatchObject({ captured: true, latest: { version: 1 } });
    expect((await readDocument(vault, v1.path)).properties).toMatchObject({ type: "snapshot", module: "wiki", version: 1, hash: v1.hash });

    await note(`${TOPICS}/Levain.md`, { type: "topic", description: "A sourdough starter, in the French usage.", sources: [] }, "Edited by hand.\n");
    await note(`${TOPICS}/Rye.md`, { type: "topic", description: "Rye bread.", sources: [] }, "New since v1.\n");
    expect((await wiki.captured()).captured).toBe(false);
    const v2 = await wiki.snapshot();
    expect(v2.version).toBe(2);
    expect((await readDocument(vault, v2.path)).body).toContain("Since version 1: 1 added, 1 changed, 0 removed.");

    const v3 = await wiki.restore(1);
    expect(v3).toMatchObject({ version: 3, restored: 1, hash: v1.hash });
    expect(await vault.read(`${TOPICS}/Levain.md`)).toContain("Levain is the starter");
    expect(await vault.exists(`${TOPICS}/Rye.md`)).toBe(false);
    expect((await wiki.versions()).map((v) => v.version)).toEqual([1, 2, 3]);
    expect((await wiki.captured())).toMatchObject({ captured: true, latest: { version: 3 } });
    await expect(wiki.restore(9)).rejects.toThrow("no version 9");
  });

  it("snapshots an uncaptured state before a restore, so nothing is lost", async () => {
    const wiki = await fixture();
    await wiki.snapshot();
    await note(`${TOPICS}/Rye.md`, { type: "topic", description: "Rye bread.", sources: [] }, "Unsaved work.\n");
    const restored = await wiki.restore(1);
    expect(restored.version).toBe(3);
    const versions = await wiki.versions();
    expect(versions[1]).toMatchObject({ version: 2, notes: 7 });
    expect(await vault.exists(`${TOPICS}/Rye.md`)).toBe(false);
    await wiki.restore(2);
    expect(await vault.read(`${TOPICS}/Rye.md`)).toContain("Unsaved work");
  });
});

describe("change", () => {
  const session = async (wiki: Wiki) => {
    const { ingest } = await enabled();
    const { path } = await ingest.create({ name: "Ingest codex", exact: true, fields: { sources: [link(`${SOURCES}/codex-notes.md`)] } });
    await wiki.refresh();
    return path;
  };

  it("refuses an invalid plan, names each problem, and changes nothing", async () => {
    const wiki = await fixture();
    const plan = {
      title: "",
      writes: [
        { op: "create" as const, path: "notes/Outside.md", body: "x" },
        { op: "create" as const, path: `${TOPICS}/Levain.md`, properties: { description: "exists" }, body: "x" },
        { op: "create" as const, path: `${TOPICS}/Blank.md`, properties: { description: " " }, body: "x" },
        { op: "modify" as const, path: `${TOPICS}/Missing.md`, body: "x" },
        { op: "modify" as const, path: `${TOPICS}/Sourdough.md` },
        { op: "remove" as const, path: `${TOPICS}/Sourdough.md` },
        { op: "create" as const, path: `${TOPICS}/Bad status.md`, properties: { description: "ok", status: "weird" }, body: "x" },
      ],
    };
    const error = await wiki.change(plan).catch((e: Error) => e);
    expect(error).toBeInstanceOf(InvalidPlan);
    const problems = (error as InvalidPlan).problems;
    expect(problems).toEqual(
      expect.arrayContaining([
        "the plan needs a title",
        expect.stringContaining("write 1 (create notes/Outside.md): the path must be a note under"),
        "write 2 (create wiki/topics/Levain.md): the note exists; use modify",
        "write 3 (create wiki/topics/Blank.md): description is empty",
        "write 4 (modify wiki/topics/Missing.md): no note at this path",
        "write 5 (modify wiki/topics/Sourdough.md): a modify changes properties or the body",
        "write 6 (remove wiki/topics/Sourdough.md): the plan writes this note twice",
        "write 7 (create wiki/topics/Bad status.md): status must be one of draft, stable, contested, deprecated",
      ]),
    );
    expect(await wiki.versions()).toEqual([]);
    expect(await vault.list("internal/wiki/changes")).toEqual([]);
  });

  it("applies a plan as one step: snapshot, change document, writes, snapshot, and the link from the session", async () => {
    const wiki = await fixture();
    const sessionPath = await session(wiki);
    const result = await wiki.change({
      title: "Ingest the codex notes",
      notes: "Adds the protocol topic and closes the source.",
      session: sessionPath,
      writes: [
        {
          op: "create",
          path: `${TOPICS}/App-server protocol.md`,
          why: "the source explains it and no topic does",
          properties: { description: "The JSON-RPC protocol of codex app-server.", tags: ["yami/agent"], sources: [link(`${SOURCES}/codex-notes.md`)], kind: "concept" },
          body: "## Definition\n\nJSON-RPC over stdio ([[codex-notes]]). See [[Codex harness]] and [[Nowhere]].",
        },
        { op: "modify", path: `${SOURCES}/codex-notes.md`, why: "absorbed", properties: { status: "absorbed", authority: "primary", tags: null }, body: "![[attachments/codex.pdf]]\n\n## Summary\n\nDone." },
        { op: "remove", path: `${TOPICS}/Sourdough.md`, why: "off topic" },
      ],
    });
    expect(result).toMatchObject({ before: 1, after: 2, creates: 1, modifies: 1, removes: 1, warnings: ["wiki/topics/App-server protocol.md links [[Nowhere]], which is not a note"] });
    expect(result.path).toMatch(/^internal\/wiki\/changes\/\d{4}-\d{2}-\d{2} \d{4} Ingest the codex notes\.md$/);

    const created = await readDocument(vault, `${TOPICS}/App-server protocol.md`);
    expect(created.properties).toMatchObject({ type: "topic", status: "draft", kind: "concept", description: "The JSON-RPC protocol of codex app-server." });
    expect(created.properties.created).toBeDefined();
    const source = await readDocument(vault, `${SOURCES}/codex-notes.md`);
    expect(source.properties).toMatchObject({ status: "absorbed", authority: "primary", description: "Notes on the Codex app-server protocol." });
    expect(source.properties.tags).toBeUndefined();
    expect(source.body).toContain("Done.");
    expect(await vault.exists(`${TOPICS}/Sourdough.md`)).toBe(false);

    const change = await readDocument(vault, result.path);
    expect(change.properties).toMatchObject({ type: "change", module: "wiki", status: "applied", before: 1, after: 2, creates: 1, session: link(sessionPath) });
    expect(change.body).toContain("- **create** [[wiki/topics/App-server protocol|App-server protocol]] · the source explains it and no topic does");
    expect(change.body).toContain("- **remove** Sourdough · off topic");
    expect(change.body).toContain("### modify · codex-notes");
    expect(change.body).toContain("status: absorbed");
    expect(change.body).toContain("Adds the protocol topic");

    const versions = await wiki.versions();
    expect(versions.map((v) => [v.version, v.change])).toEqual([
      [1, undefined],
      [2, link(result.path)],
    ]);
    expect((await readDocument(vault, versions[1]!.path)).body).toContain("Since version 1: 1 added, 1 changed, 1 removed.");
    expect((await readDocument(vault, sessionPath)).properties.changes).toEqual([link(result.path)]);
    expect((await wiki.captured()).captured).toBe(true);

    // The checks of the module see the change through the session. The loop refreshes the wiki before the checks.
    await wiki.refresh();
    const context = { vault, wiki, session: "Ingest codex", path: sessionPath, properties: (await readDocument(vault, sessionPath)).properties };
    const applied = { path: "p", properties: { check: "property", field: "changes", property: "status", value: "applied", atLeast: 1 }, body: "" };
    expect(await runCheck(applied, context)).toMatchObject({ status: "met" });
    const absorbed = { path: "p", properties: { check: "property", field: "sources", property: "status", value: "absorbed" }, body: "" };
    expect(await runCheck(absorbed, context)).toMatchObject({ status: "met" });
  });

  it("reuses the latest snapshot when the wiki is captured, and puts the wiki back when a write fails", async () => {
    const wiki = await fixture();
    await wiki.snapshot();
    const remove = vault.remove.bind(vault);
    vault.remove = async (path: string) => {
      if (path.endsWith("Levain.md")) throw new Error("disk full");
      return remove(path);
    };
    const failing = wiki.change({
      title: "Bad change",
      writes: [
        { op: "create", path: `${TOPICS}/New.md`, properties: { description: "New." }, body: "x" },
        { op: "remove", path: `${TOPICS}/Levain.md` },
      ],
    });
    await expect(failing).rejects.toThrow("the wiki is back at version 1: disk full");
    expect(await vault.exists(`${TOPICS}/New.md`)).toBe(false);
    expect(await vault.exists(`${TOPICS}/Levain.md`)).toBe(true);
    expect((await wiki.versions()).map((v) => v.version)).toEqual([1]);
    const [changeDoc] = await vault.list("internal/wiki/changes");
    expect((await readDocument(vault, changeDoc!)).properties).toMatchObject({ status: "failed", error: "disk full", before: 1 });
    vault.remove = remove;

    const ok = await wiki.change({ title: "Good change", writes: [{ op: "create", path: `${TOPICS}/New.md`, properties: { description: "New." }, body: "x" }] });
    expect(ok).toMatchObject({ before: 1, after: 2 });
  });

  it("applies concurrent plans one after another, each with its own version", async () => {
    const wiki = await fixture();
    const plan = (name: string) => wiki.change({ title: name, writes: [{ op: "create", path: `${TOPICS}/${name}.md`, properties: { description: `${name}.` }, body: "x" }] });
    const [a, b, c] = await Promise.all([plan("A"), plan("B"), plan("C")]);
    expect([a.before, a.after, b.before, b.after, c.before, c.after]).toEqual([1, 2, 2, 3, 3, 4]);
    expect((await wiki.versions()).map((v) => v.version)).toEqual([1, 2, 3, 4]);
    expect((await vault.list("internal/wiki/changes")).length).toBe(3);
  });

  it("checks a plan against the wiki as the agent left it, not as the index remembers it", async () => {
    const wiki = await fixture();
    await note(`${TOPICS}/Fresh.md`, { type: "topic", description: "Written after the index." }, "x");
    const result = await wiki.change({ title: "Modify fresh", writes: [{ op: "modify", path: `${TOPICS}/Fresh.md`, body: "updated" }] });
    expect(result.modifies).toBe(1);
    expect(await vault.read(`${TOPICS}/Fresh.md`)).toContain("updated");
  });
});

describe("source chunks", () => {
  it("splits a text original at headings, a PDF by pages, and anything else whole, and finds a file by name", async () => {
    const wiki = await fixture();
    const lines: string[] = [];
    for (let section = 1; section <= 4; section++) {
      lines.push(`## Section ${section}`);
      for (let i = 0; i < 500; i++) lines.push(`line ${section}.${i}`);
      lines.push("");
    }
    await vault.write("papers/long.md", lines.join("\n"));
    await vault.write("papers/scan.pdf", "%PDF-1.4\n1 0 obj << /Type /Pages /Kids [] >> endobj\n" + "2 0 obj << /Type /Page /Parent 1 0 R >> endobj\n".repeat(45));
    await vault.write("papers/deck.pptx", "binary");
    const long = await captureSource(vault, "papers/long.md");
    const scan = await captureSource(vault, "papers/scan.pdf");
    const deck = await captureSource(vault, "papers/deck.pptx");
    await wiki.refresh();

    const text = await sourceChunks(vault, wiki, long);
    expect(text.kind).toBe("lines");
    // Workers read the frozen copy, not the file in papers/.
    expect(text.file).toMatch(/^internal\/wiki\/originals\/[0-9a-f]{16}\.md$/);
    expect(text.chunks.map((c) => [c.from, c.to])).toEqual([
      [1, 502],
      [503, 1004],
      [1005, 1506],
      [1507, 2008],
    ]);
    expect(text.chunks[0]!.locator).toBe("lines 1-502");
    expect(lines[502]).toBe("## Section 2");

    // A source can be named by its note, or by the file it was captured from.
    const pdf = await sourceChunks(vault, wiki, "[[scan.pdf]]");
    expect(pdf.source).toBe(scan);
    expect(pdf.chunks.map((c) => c.locator)).toEqual(["pages 1-20", "pages 21-40", "pages 41-45"]);
    expect((await sourceChunks(vault, wiki, "papers/scan.pdf")).source).toBe(scan);
    expect((await sourceChunks(vault, wiki, "[[scan (source)]]")).source).toBe(scan);
    await expect(sourceChunks(vault, wiki, "nothing.pdf")).rejects.toThrow("neither a source note nor a file");
    expect(countPages(new TextEncoder().encode("no pages here"))).toBe(0);

    expect((await sourceChunks(vault, wiki, deck)).chunks).toEqual([{ index: 1, count: 1, kind: "file", locator: "the whole file" }]);
    await expect(sourceChunks(vault, wiki, `${TOPICS}/Levain.md`)).rejects.toThrow("not a source note");
  });

  it("captures every file of a folder as a source", async () => {
    await vault.write("inbox/a.md", "A");
    await vault.write("inbox/deep/b.pdf", "B");
    await vault.write("inbox/.hidden/c.md", "C");
    await vault.write("inbox/same as a.md", "A");
    expect(await captureSources(vault, "inbox/")).toEqual([`${SOURCES}/a (source).md`, `${SOURCES}/b (source).md`]);
    await expect(captureSources(vault, "empty")).rejects.toThrow("No files");
  });

  it("packs lines into runs of at most 800, cut at a heading or a blank line", () => {
    const lines = Array.from({ length: 1700 }, (_, i) => (i === 700 ? "" : `l${i}`));
    const chunks = lineChunks(lines);
    expect(chunks.map((c) => [c.from, c.to])).toEqual([
      [1, 700],
      [702, 1501],
      [1502, 1700],
    ]);
    expect(lineChunks([""])).toEqual([{ index: 1, count: 1, kind: "lines", from: 1, to: 1, locator: "lines 1-1" }]);
  });
});

describe("the wiki module's layout", () => {
  it("keeps its sessions and ledger internal, with the versions and changes in the ledger", async () => {
    await fixture();
    const { ingest } = await enabled();
    expect(await vault.exists("internal/wiki/sessions.base")).toBe(true);
    expect(await vault.exists("wiki/sessions.base")).toBe(false);
    const ledger = await vault.read("internal/wiki/sessions.base");
    expect(ledger).toContain("name: Versions");
    expect(ledger).toContain("name: Changes");
    expect(ledger).toContain('module == "wiki"');
    const { path } = await ingest.create({ name: "Ingest x", exact: true });
    expect(path).toBe("internal/wiki/sessions/Ingest x.md");
    expect((await readDocument(vault, path)).properties.changes).toEqual([]);
  });
});

describe("what the index leaves out", () => {
  it("skips change and snapshot records and skill files, and the change check still finds the change", async () => {
    const wiki = await fixture();
    await enabled();
    const result = await wiki.change({ title: "One topic", writes: [{ op: "create", path: `${TOPICS}/Codex app-server.md`, properties: { description: "The app-server of codex." }, body: "x" }] });
    await wiki.refresh();
    const paths = wiki.notes.map((n) => n.path);
    expect(paths.some((p) => p.startsWith("internal/wiki/changes/") || p.startsWith("internal/wiki/snapshots/") || p.startsWith("internal/wiki/skills/"))).toBe(false);
    expect((await wiki.search("codex app-server")).map((h) => h.path)).not.toContain(result.path);
    const check = { path: "p", properties: { check: "property", field: "changes", property: "status", value: "applied", atLeast: 1 }, body: "" };
    expect(await runCheck(check, { vault, wiki, path: "s.md", properties: { changes: [link(result.path)] } })).toMatchObject({ status: "met" });
  });
});

describe("the forms of the modules", () => {
  it("are not knowledge: the index leaves out every form folder, and lint finds no duplicate name in them", async () => {
    const wiki = await fixture();
    for (const [folder, file] of [["agents", "AGENT"], ["flows", "FLOW"], ["policies", "POLICY"], ["promises", "PROMISE"], ["skills", "SKILL"]]) {
      for (const module of ["one", "two"]) await vault.write(`internal/${module}/${folder}/same/${file}.md`, "---\nname: same\ndescription: The same name.\n---\nBody.\n");
    }
    await vault.write("internal/one/articles/Guide.md", "An article is knowledge.\n");
    await wiki.refresh();
    expect(wiki.notes.map((n) => n.path).filter((p) => p.startsWith("internal/"))).toEqual(["internal/one/articles/Guide.md"]);
    expect(wiki.holds("internal/one/policies/same/POLICY.md")).toBe(false);
    expect((await wiki.lint()).filter((f) => f.check === "duplicate-name" && f.path.startsWith("internal/"))).toEqual([]);
  });
});

describe("links to notes the index leaves out", () => {
  it("are not dead and not edges, and a name resolves as Obsidian resolves it, over every note", async () => {
    const wiki = await fixture();
    await vault.write("internal/wiki/sessions/Ingest codex.md", "---\ntype: session\nmodule: wiki\n---\nx\n");
    await note(`${TOPICS}/Linked.md`, { type: "topic", description: "Links records." }, "From [[internal/wiki/sessions/Ingest codex|its session]], [[old chat]], and [[Nowhere at all]].\n");
    await wiki.refresh();
    const findings = (await wiki.lint({ paths: [`${TOPICS}/Linked.md`] })).filter((f) => f.check === "dead-link");
    expect(findings.map((f) => f.message)).toEqual(["links [[Nowhere at all]], which is not a note"]);
    expect(wiki.locate("internal/wiki/sessions/Ingest codex")).toBe("internal/wiki/sessions/Ingest codex.md");
    expect(wiki.resolve("internal/wiki/sessions/Ingest codex")).toBeUndefined();
    expect(wiki.locate("old chat")).toBe("conversations/old chat.md");
    expect(wiki.note(`${TOPICS}/Linked.md`)!.links).toEqual([]);

    // An excluded note with the same name and a shorter path is where Obsidian sends the link, so no edge goes elsewhere.
    await vault.write("x/Levain.md", "shorter path, excluded");
    const excluding = new Wiki(vault, { exclude: ["x"] });
    await excluding.refresh();
    expect(excluding.locate("Levain")).toBe("x/Levain.md");
    expect(excluding.resolve("Levain")).toBeUndefined();
    expect(excluding.note(`${TOPICS}/Sourdough.md`)!.links).not.toContain(`${TOPICS}/Levain.md`);
  });

  it("raise no warning in a change plan", async () => {
    const wiki = await fixture();
    await vault.write("internal/wiki/sessions/Ingest codex.md", "---\ntype: session\nmodule: wiki\n---\nx\n");
    const result = await wiki.change({
      title: "Link the session",
      writes: [{ op: "create", path: `${TOPICS}/Linked.md`, properties: { description: "Links." }, body: "From [[internal/wiki/sessions/Ingest codex]] and [[Nowhere]]." }],
    });
    expect(result.warnings).toEqual(["wiki/topics/Linked.md links [[Nowhere]], which is not a note"]);
  });
});

describe("copies, agent files, and base hashes", () => {
  it("leaves a copy and a module's agent files out of the index", async () => {
    const wiki = await fixture();
    await note("librarian/x/Levain (checkout).md", { copy_of: "[[wiki/topics/Levain|Levain]]" }, "Levain is the starter.\n");
    await vault.write("internal/threads/agents/validator.md", "---\nname: validator\n---\nValidate the starter.\n");
    await wiki.refresh();
    expect(wiki.notes.map((n) => n.path)).not.toContain("librarian/x/Levain (checkout).md");
    expect(wiki.notes.map((n) => n.path)).not.toContain("internal/threads/agents/validator.md");
    expect(wiki.locate("librarian/x/Levain (checkout)")).toBe("librarian/x/Levain (checkout).md");
  });

  it("refuses a modify whose base no longer matches the note, and takes one that does", async () => {
    const wiki = await fixture();
    const base = await bodyHash(wiki.note(`${TOPICS}/Levain.md`)!.body);
    await note(`${TOPICS}/Levain.md`, { type: "topic", description: "A sourdough starter, in the French usage.", aliases: ["Starter"], sources: [] }, "Changed by hand.\n");
    await expect(wiki.change({ title: "Stale", writes: [{ op: "modify", path: `${TOPICS}/Levain.md`, body: "Mine.", base }] })).rejects.toThrow("the note changed since its base was read");
    const fresh = await bodyHash("Changed by hand.\n");
    await expect(wiki.change({ title: "Stale remove", writes: [{ op: "remove", path: `${TOPICS}/Levain.md`, base }] })).rejects.toThrow("the note changed since its base was read");
    await expect(wiki.change({ title: "Fresh", writes: [{ op: "modify", path: `${TOPICS}/Levain.md`, body: "Mine.", base: fresh }] })).resolves.toMatchObject({ modifies: 1 });
  });
});

describe("wiki_change through the tool", () => {
  it("removes a property that the plan sets to null", async () => {
    await fixture();
    const { yami } = await enabled();
    const change = yami.tools()!.tools.find((t) => t.name === "wiki_change")!;
    const result = await runTool(change, { title: "Untag", writes: [{ op: "modify", path: `${TOPICS}/Levain.md`, properties: { tags: null } }] }, new AbortController().signal);
    expect(result.isError, result.text).toBe(false);
    expect((await readDocument(vault, `${TOPICS}/Levain.md`)).properties.tags).toBeUndefined();
  });
});
