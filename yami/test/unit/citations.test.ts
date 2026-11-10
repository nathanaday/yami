import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { link } from "../../src/document/index.js";
import { FsVault } from "../../src/testing/index.js";
import { captureSource, citations, claimBefore, parseLocator, passage, resolveCitations, sourceExtent, visibleRanges, Wiki } from "../../src/wiki/index.js";
import { DEFAULT_FOLDERS } from "../../src/document/index.js";

const { sources: SOURCES, topics: TOPICS } = DEFAULT_FOLDERS;

let root = "";
let vault: FsVault;
const note = (path: string, properties: Record<string, unknown>, body: string) => vault.write(path, `---\n${vault.stringifyProperties(properties)}---\n${body}`);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "yami-citations-"));
  vault = new FsVault(root);
});
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

const BODY = `## Definition

Self-supervised learning trains on data with no labels ([[DINOv2 (source)]], p. 3). It needs no annotation ([[DINOv2 (source)]], p. 3; [[Survey]], slide 4).

- A list item with a claim ([[wiki/sources/DINOv2 (source)|DINOv2]], pp. 4-5).
- Prose with a link in parentheses (see [[Decoder]]) is not a citation ([[DINOv2 (source)]]).

\`\`\`
code ([[Not a citation]], p. 9)
\`\`\`

*Figure: the pipeline ([[DINOv2 (source)]], slide 2).*

## Notes

My own note ([[Mine]], p. 1).
`;

describe("citations", () => {
  it("parses each citation with its target, locator, claim, and range, outside code and the Notes section", () => {
    const found = citations(BODY);
    expect(found.map((c) => [c.target, c.locator, c.claim])).toEqual([
      ["DINOv2 (source)", "p. 3", "Self-supervised learning trains on data with no labels"],
      ["DINOv2 (source)", "p. 3", "It needs no annotation"],
      ["Survey", "slide 4", "It needs no annotation"],
      ["wiki/sources/DINOv2 (source)", "pp. 4-5", "A list item with a claim"],
      ["DINOv2 (source)", undefined, "Prose with a link in parentheses (see [[Decoder]]) is not a citation"],
      ["DINOv2 (source)", "slide 2", "the pipeline"],
    ]);
    const second = found[1]!;
    expect(BODY.slice(second.from, second.to)).toBe("([[DINOv2 (source)]], p. 3; [[Survey]], slide 4)");
    expect(found[2]).toMatchObject({ text: second.text, from: second.from, to: second.to });
    expect(citations("Nothing cited here. (Just an aside.)")).toEqual([]);
  });

  it("keeps the ranges outside fences and the Notes section", () => {
    const body = "a\n```\nb\n```\nc\n## Notes\nd\n## More\ne\n";
    expect(visibleRanges(body).map(({ from, to }) => body.slice(from, to))).toEqual(["a\n", "c\n", "## More\ne\n"]);
    expect(visibleRanges("")).toEqual([]);
  });

  it("takes the claim as the sentence before the citation", () => {
    expect(claimBefore("First. Second claim ", 20)).toBe("Second claim");
    expect(claimBefore("A method (a variant) works ", 27)).toBe("A method (a variant) works");
    expect(claimBefore("1. Numbered ", 12)).toBe("Numbered");
    expect(claimBefore("See p. 3 of it. Then this ", 26)).toBe("Then this");
  });

  it("reads locators of every form", () => {
    expect(parseLocator("p. 3")).toEqual({ text: "p. 3", kind: "page", from: 3, to: 3 });
    expect(parseLocator("pp. 4–5")).toEqual({ text: "pp. 4–5", kind: "page", from: 4, to: 5 });
    expect(parseLocator("pages 10-8")).toEqual({ text: "pages 10-8", kind: "page", from: 8, to: 10 });
    expect(parseLocator("slides 4-6")).toEqual({ text: "slides 4-6", kind: "slide", from: 4, to: 6 });
    expect(parseLocator("lines 12-40")).toEqual({ text: "lines 12-40", kind: "line", from: 12, to: 40 });
    expect(parseLocator("§ 2.1")).toEqual({ text: "§ 2.1", kind: "section", name: "2.1" });
    expect(parseLocator("section Methods")).toEqual({ text: "section Methods", kind: "section", name: "Methods" });
    expect(parseLocator("Figure 2")).toEqual({ text: "Figure 2", kind: "figure", name: "2" });
    expect(parseLocator("Table 1.")).toEqual({ text: "Table 1", kind: "table", name: "1" });
    expect(parseLocator("p. 4, Figure 2")).toEqual({ text: "p. 4, Figure 2", kind: "page", from: 4, to: 4 });
    expect(parseLocator("the abstract")).toEqual({ text: "the abstract", kind: "other" });
  });

  it("finds the passage of a text at a locator: lines, a slide, a section, a figure, and nothing for a page", () => {
    const text = ["# Deck", "## Slide 1 · Intro", "hello", "## Slide 2 · Method", "the method", "more", "## Slide 3", "end", "", "# 2.1 Results", "Figure 2 shows the loss.", "## 2.2 Other", "x"].join("\n");
    expect(passage(text, "lines 3-4")).toEqual({ from: 3, to: 4, text: "hello\n## Slide 2 · Method" });
    expect(passage(text, "lines 50-60")).toBeUndefined();
    expect(passage(text, "slide 2")).toEqual({ from: 4, to: 6, text: "## Slide 2 · Method\nthe method\nmore" });
    expect(passage(text, "slides 2-3")).toMatchObject({ from: 4, to: 13 });
    expect(passage(text, "slide 9")).toBeUndefined();
    expect(passage(text, "§ 2.1")).toEqual({ from: 10, to: 13, text: "# 2.1 Results\nFigure 2 shows the loss.\n## 2.2 Other\nx" });
    expect(passage(text, "Figure 2")).toMatchObject({ from: 11 });
    expect(passage(text, "p. 3")).toBeUndefined();
    expect(passage(text, "the abstract")).toBeUndefined();
  });
});

describe("citations against the sources' files", () => {
  it("resolves each citation to its source's file and range, and names the ones that lead nowhere", async () => {
    await vault.write("papers/notes.md", Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n"));
    await vault.write("papers/scan.pdf", "%PDF-1.4\n1 0 obj << /Type /Pages /Kids [] >> endobj\n" + "2 0 obj << /Type /Page /Parent 1 0 R >> endobj\n".repeat(12));
    const notes = await captureSource(vault, "papers/notes.md");
    const scan = await captureSource(vault, "papers/scan.pdf");
    await note(`${TOPICS}/Decoder.md`, { type: "topic", description: "The half that expands the code." }, "The decoder expands the code.\n");
    await note(
      `${TOPICS}/Autoencoder.md`,
      { type: "topic", description: "A network that reproduces its input.", sources: [link(notes), link(scan)] },
      [
        "An autoencoder learns a code ([[notes (source)]], lines 2-4).",
        "It is old ([[scan (source)]], p. 3).",
        "It is older than that ([[scan (source)]], p. 40).",
        "The copy ends sooner ([[notes (source)]], lines 90-95).",
        "A deck it is not ([[notes (source)]], slide 2).",
        "A topic is no source ([[Decoder]], p. 1), but a bare link is a cross-reference ([[Decoder]]).",
        "A dead link is lint's own ([[Gone]], p. 2).",
        "The abstract says so ([[scan (source)]], the abstract).",
      ].join(" "),
    );
    const wiki = new Wiki(vault);
    await wiki.refresh();
    const topic = wiki.note(`${TOPICS}/Autoencoder.md`)!;
    const resolved = await resolveCitations(vault, wiki, topic);
    expect(resolved.map((c) => [c.locator, c.source && c.source.replace(`${SOURCES}/`, ""), c.lines, c.pages, c.problem])).toEqual([
      ["lines 2-4", "notes (source).md", { from: 2, to: 4 }, undefined, undefined],
      ["p. 3", "scan (source).md", undefined, { from: 3, to: 3 }, undefined],
      ["p. 40", "scan (source).md", undefined, { from: 40, to: 40 }, "its copy has 12 pages"],
      ["lines 90-95", "notes (source).md", undefined, undefined, "its copy has 30 lines"],
      ["slide 2", "notes (source).md", undefined, undefined, "its copy has no slides"],
      ["p. 1", undefined, undefined, undefined, "[[Decoder]] is not a source"],
      [undefined, undefined, undefined, undefined, undefined],
      ["p. 2", undefined, undefined, undefined, "[[Gone]] is not a note"],
      ["the abstract", "scan (source).md", undefined, undefined, undefined],
    ]);
    expect(resolved[0]!.file).toMatch(/^internal\/wiki\/originals\/[0-9a-f]{16}\.md$/);
    expect(resolved[1]!.kind).toBe("pages");

    const extent = await sourceExtent(vault, wiki, notes);
    expect(extent).toMatchObject({ source: notes, kind: "lines", lines: 30 });
    expect(await sourceExtent(vault, wiki, scan)).toMatchObject({ kind: "pages", pages: 12 });
    // A frozen copy never changes, so its extent is read once.
    expect(await sourceExtent(vault, wiki, notes)).toBe(extent);

    const findings = (await wiki.lint()).filter((f) => f.check === "bad-citation");
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ path: `${TOPICS}/Autoencoder.md`, severity: "warning" });
    expect(findings[0]!.message).toBe(
      "has 4 citations that lead nowhere: ([[scan (source)]], p. 40): its copy has 12 pages; ([[notes (source)]], lines 90-95): its copy has 30 lines; ([[notes (source)]], slide 2): its copy has no slides; …",
    );
    expect(findings[0]!.fix).toContain("verify session");
    expect((await wiki.lint({ paths: [`${TOPICS}/Decoder.md`] })).filter((f) => f.check === "bad-citation")).toEqual([]);
  });

  it("follows a slide citation into a captured deck's text, and a section into its heading", async () => {
    const text = ["# Deck", "## Slide 1 · Intro", "hello", "## Slide 2 · Method", "the method", "## Slide 3", "end"].join("\n");
    await vault.write("decks/talk.md", text);
    const talk = await captureSource(vault, "decks/talk.md");
    await note(`${TOPICS}/Method.md`, { type: "topic", description: "The method.", sources: [link(talk)] }, "The method is simple ([[talk (source)]], slide 2). It ends ([[talk (source)]], slide 7). The intro ([[talk (source)]], § Intro).\n");
    const wiki = new Wiki(vault);
    await wiki.refresh();
    const resolved = await resolveCitations(vault, wiki, wiki.note(`${TOPICS}/Method.md`)!);
    expect(resolved.map((c) => [c.lines, c.problem])).toEqual([
      [{ from: 4, to: 5 }, undefined],
      [undefined, "its copy has 3 slides"],
      [{ from: 2, to: 3 }, undefined],
    ]);
    expect(await sourceExtent(vault, wiki, talk)).toMatchObject({ lines: 7, slides: 3 });
  });

  it("leaves a source whose file is not in the vault to the source note, with no finding on the topic", async () => {
    await note(`${SOURCES}/lost.md`, { type: "source", description: "A source whose file is gone.", file: "[[gone.pdf]]" }, "");
    await note(`${TOPICS}/T.md`, { type: "topic", description: "T.", sources: [link(`${SOURCES}/lost.md`)] }, "A claim ([[lost]], p. 2).\n");
    const wiki = new Wiki(vault);
    await wiki.refresh();
    expect((await resolveCitations(vault, wiki, wiki.note(`${TOPICS}/T.md`)!)).map((c) => [c.source, c.problem])).toEqual([[`${SOURCES}/lost.md`, undefined]]);
    expect((await wiki.lint()).filter((f) => f.check === "bad-citation")).toEqual([]);
  });
});
