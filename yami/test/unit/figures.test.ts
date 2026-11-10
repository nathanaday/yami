import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runTool } from "../../src/agent/index.js";
import { link, readDocument } from "../../src/document/index.js";
import { runCheck, type WikiModule } from "../../src/index.js";
import { testYami, type FsVault, type TestYami } from "../../src/testing/index.js";
import { figureMarker, figureMarkers, fromBase64, pngProblem, svgProblem, type Wiki } from "../../src/wiki/index.js";
import { DEFAULT_FOLDERS } from "../../src/document/index.js";

const { figures: FIGURES, sources: SOURCES, topics: TOPICS } = DEFAULT_FOLDERS;

let t: TestYami;
let vault: FsVault;
let wiki: Wiki;
let module: WikiModule;
const note = (path: string, properties: Record<string, unknown>, body: string) => vault.write(path, `---\n${vault.stringifyProperties(properties)}---\n${body}`);
const tool = (name: string) => t.yami.tools().tools.find((tool) => tool.name === name)!;
const signal = new AbortController().signal;
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><rect x="10" y="10" width="200" height="100" fill="#3e63dd"/><text x="20" y="60" font-family="system-ui, sans-serif">Encoder</text></svg>';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]).toString("base64");
const MARKER = "%% figure: the encoder and the decoder, the latent vector between them; conveys the bottleneck · from: [[Sutton (source)]] p. 4, Figure 2 %%";

beforeEach(async () => {
  t = await testYami();
  ({ vault } = t);
  wiki = t.yami.wiki;
  module = t.yami.module("wiki") as WikiModule;
  await note(`${SOURCES}/Sutton (source).md`, { type: "source", description: "The textbook.", file: "[[x.pdf]]", status: "absorbed" }, "## Summary\n\nThe book.\n");
  await note(`${TOPICS}/Autoencoder.md`, { type: "topic", description: "A network that reproduces its input through a bottleneck.", sources: [link(`${SOURCES}/Sutton (source).md`)] }, `## Definition\n\nAn autoencoder learns a compressed code ([[Sutton (source)]], p. 4).\n\n${MARKER}\n\nSee [[Decoder]].\n`);
  await note(`${TOPICS}/Decoder.md`, { type: "topic", description: "The half that expands the code.", sources: [link(`${SOURCES}/Sutton (source).md`)] }, "The decoder expands the code ([[Sutton (source)]], p. 5). See [[Autoencoder]].\n");
  await wiki.refresh();
});
afterEach(() => t.dispose());

describe("figure markers", () => {
  it("parses a marker's text, what it shows, and where the source has it, and writes one", () => {
    expect(figureMarkers(`a\n${MARKER}\nb %% figure:  just a drawing  %% c`)).toEqual([
      { text: MARKER, shows: "the encoder and the decoder, the latent vector between them; conveys the bottleneck", from: "[[Sutton (source)]] p. 4, Figure 2" },
      { text: "%% figure:  just a drawing  %%", shows: "just a drawing" },
    ]);
    expect(figureMarkers("%% a plain comment %% and %%figure%%")).toEqual([]);
    expect(figureMarker("  the  pipeline ", "[[S]] slide 3")).toBe("%% figure: the pipeline · from: [[S]] slide 3 %%");
    expect(figureMarker("the pipeline")).toBe("%% figure: the pipeline %%");
  });

  it("is a lint warning on the topic, with each figure to make and the fix", async () => {
    const findings = (await wiki.lint()).filter((f) => f.check === "figure-missing");
    expect(findings).toEqual([
      {
        path: `${TOPICS}/Autoencoder.md`,
        check: "figure-missing",
        severity: "warning",
        message: 'has 1 figure to make: "the encoder and the decoder, the latent vector between them; conveys the bottleneck"',
        fix: "run a figures session on it (Wiki: new figures), which draws each figure and replaces the marker with its embed",
      },
    ]);
  });
});

describe("the figure files", () => {
  it("accepts a plain SVG and refuses a script, a handler, an outside reference, or a non-SVG", () => {
    expect(svgProblem(SVG)).toBeUndefined();
    expect(svgProblem(`<?xml version="1.0"?>\n${SVG}`)).toBeUndefined();
    expect(svgProblem('<svg xmlns="http://www.w3.org/2000/svg"><use href="#a"/><image href="data:image/png;base64,AAAA"/></svg>')).toBeUndefined();
    expect(svgProblem("<div>no</div>")).toBe("the SVG does not start with <svg");
    expect(svgProblem("<svg>")).toBe("the SVG does not end with </svg>");
    expect(svgProblem("<svg><script>alert(1)</script></svg>")).toBe("the SVG holds a <script>");
    expect(svgProblem('<svg><rect onclick="x()"/></svg>')).toBe("the SVG holds an event handler attribute");
    expect(svgProblem('<svg><image href="https://evil.example/x.png"/></svg>')).toBe("the SVG refers outside itself: https://evil.example/x.png");
    expect(svgProblem('<svg><style>@import url("x.css")</style></svg>')).toBe("the SVG's styles refer outside it");
    expect(svgProblem(`<svg>${"x".repeat(1_000_001)}</svg>`)).toBe("the SVG is over 1 MB");
    expect(svgProblem("<svg><foreignObject></foreignObject></svg>")).toBe("the SVG holds an element that embeds other content");
  });

  it("accepts PNG bytes and refuses other bytes, and decodes base64", () => {
    expect(pngProblem(fromBase64(PNG))).toBeUndefined();
    expect(pngProblem(new Uint8Array([1, 2, 3]))).toBe("the bytes are not a PNG");
    expect(pngProblem(new Uint8Array(4_000_001))).toBe("the PNG is over 4 MB");
    expect(fromBase64(`data:image/png;base64,${PNG}`)).toEqual(fromBase64(PNG));
    expect(() => fromBase64("not base64!")).toThrow("not base64");
  });

  it("is a tool that saves a figure under the topic's folder and returns the embed, and refuses what it must", async () => {
    const figure = tool("wiki_figure");
    expect(figure.readOnly).toBeFalsy();
    const saved = JSON.parse((await runTool(figure, { topic: "Autoencoder", name: "encoder-decoder", svg: SVG }, signal)).text);
    expect(saved).toEqual({ path: `${FIGURES}/Autoencoder/encoder-decoder.svg`, embed: `![[${FIGURES}/Autoencoder/encoder-decoder.svg]]` });
    expect(new TextDecoder().decode(await vault.readBinary(saved.path))).toBe(`${SVG}\n`);
    const png = JSON.parse((await runTool(figure, { topic: `${TOPICS}/Autoencoder.md`, name: "photo", png: PNG }, signal)).text);
    expect(png.path).toBe(`${FIGURES}/Autoencoder/photo.png`);
    expect(await runTool(figure, { topic: "Autoencoder", name: "encoder-decoder", svg: SVG }, signal)).toMatchObject({ isError: true, text: expect.stringContaining("give another name, or set replace") });
    expect((await runTool(figure, { topic: "Autoencoder", name: "encoder-decoder", svg: SVG, replace: true }, signal)).isError).toBe(false);
    expect(await runTool(figure, { topic: "Sutton (source)", name: "x", svg: SVG }, signal)).toMatchObject({ isError: true, text: "Sutton (source) is not a topic of the wiki." });
    expect(await runTool(figure, { topic: "Nowhere", name: "x", svg: SVG }, signal)).toMatchObject({ isError: true, text: "Nowhere is not a topic of the wiki." });
    expect(await runTool(figure, { topic: "Autoencoder", name: "x", svg: "<svg><script></script></svg>" }, signal)).toMatchObject({ isError: true, text: "The SVG is refused: the SVG holds a <script>." });
    expect(await runTool(figure, { topic: "Autoencoder", name: "x", png: "AAAA" }, signal)).toMatchObject({ isError: true, text: "The PNG is refused: the bytes are not a PNG." });
    expect(await runTool(figure, { topic: "Autoencoder", name: "x" }, signal)).toMatchObject({ isError: true, text: expect.stringContaining("svg text, or as png") });
    expect(await runTool(figure, { topic: "Autoencoder", name: "a/b", svg: SVG }, signal)).toMatchObject({ isError: true, text: expect.stringContaining("cannot name a file") });
    expect(await runTool(figure, { topic: "Autoencoder", name: "a.svg", svg: SVG }, signal)).toMatchObject({ isError: true, text: expect.stringContaining("without an extension") });
    // The figures folder is not knowledge: the index holds no note of it, and the embed is a file link, not a dead link.
    await wiki.refresh();
    expect(wiki.notes.some((n) => n.path.startsWith(FIGURES))).toBe(false);
  });
});

describe("the figures flow", () => {
  it("is read-only with a command, and its check follows the markers of its topics, or of every topic, through the standing changes", async () => {
    expect(module.figures.command).toBe(true);
    expect(module.figures.access).toBe("read-only");
    expect(module.figures.agents.map((a) => a.name)).toEqual(["illustrator"]);
    expect((await readDocument(vault, "internal/wiki/agents/illustrator/AGENT.md")).properties).toMatchObject({ name: "illustrator", access: "read-only" });
    const session = (await module.figures.create({ name: "Figures", exact: true })).path;
    const check = async (properties: Record<string, unknown>) => runCheck({ path: "p", properties: { check: "figures" }, body: "" }, { vault, wiki, path: session, properties }, module.checks);
    // Every topic with a marker, when the field is empty.
    expect(await check({ topics: [], changes: [] })).toMatchObject({ status: "unmet", detail: expect.stringContaining("figures still to make in Autoencoder (1)") });
    expect(await check({ topics: [link(`${TOPICS}/Decoder.md`)], changes: [] })).toMatchObject({ status: "met", detail: "no figure marker is left in 1 topic(s), in the wiki or in the standing changes" });
    expect(await check({ topics: ["[[Nowhere]]"], changes: [] })).toMatchObject({ status: "unmet", detail: "topics links Nowhere, which are not notes" });
    // A standing change that puts the figure in the marker's place meets it before the approval.
    const body = (await readDocument(vault, `${TOPICS}/Autoencoder.md`)).body.replace(MARKER, `![[${FIGURES}/Autoencoder/encoder-decoder.svg]]\n*Figure: the encoder narrows the input to a code that the decoder expands ([[Sutton (source)]], p. 4).*`);
    const proposal = await wiki.change({ title: "Figures for Autoencoder", session, writes: [{ op: "modify", path: `${TOPICS}/Autoencoder.md`, body, why: "the figure" }] });
    await wiki.refresh();
    const properties = (await readDocument(vault, session)).properties;
    expect(properties.changes).toEqual([link(proposal.path)]);
    expect(await check({ ...properties, topics: [] })).toMatchObject({ status: "met" });
    expect(await check({ ...properties, topics: [link(`${TOPICS}/Autoencoder.md`)] })).toMatchObject({ status: "met" });
    await wiki.approve(proposal.path);
    await wiki.refresh();
    expect(await check({ topics: [], changes: [] })).toMatchObject({ status: "met", detail: "no topic has a figure to make" });
    expect((await wiki.lint()).filter((f) => f.check === "figure-missing")).toEqual([]);
  });

  it("tells the extractor and the drafter about figures, and the ingest skill to list the markers", async () => {
    expect(await vault.read("internal/wiki/agents/extractor/AGENT.md")).toContain('"figures": [');
    const drafter = await vault.read("internal/wiki/agents/drafter/AGENT.md");
    expect(drafter).toContain("## Figures");
    expect(drafter).toContain("%% figure:");
    expect(await vault.read("internal/wiki/skills/ingest/SKILL.md")).toContain("the figure markers the drafters left");
    expect(await vault.read("internal/wiki/skills/figures/SKILL.md")).toContain("call `yami_agent` with the agent `illustrator`");
    expect(await vault.read("internal/wiki/skills/ingest/page-forms.md")).toContain("figure-missing");
    expect(t.yami.problems).toEqual([]);
  });
});
