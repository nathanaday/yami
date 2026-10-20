import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readDocument } from "../../src/document/index.js";
import { captureSource, officeText, sourceChunks, Wiki } from "../../src/wiki/index.js";
import { FsVault } from "../../src/testing/index.js";
import { deck, PNG, rel, rels, zip } from "../fixtures/office.js";


describe("officeText", () => {
  it("writes a deck's slides in order, each titled, with levels, math, pictures, a table, the notes, and the hidden slides", async () => {
    const { text, pictures } = await officeText(await deck(), "pptx", "Lecture 8", "internal/wiki/originals/abc");
    expect(text).toBe(
      [
        "# Lecture 8",
        "",
        "The text of the 2 slides of Lecture 8, with the pictures they show.",
        "",
        "## Slide 1 · Transition systems",
        "",
        "- Safety & liveness",
        "  - Invariants",
        "- State x_{0}",
        "- Chosen",
        "![[internal/wiki/originals/abc/image1.png]]",
        "(a picture in EMF form, not shown)",
        "| State | Next |",
        "| --- | --- |",
        "| off | on |",
        "",
        "Notes:",
        "",
        "- Say why it matters.",
        "",
        "## Slide 2 · A graph (hidden)",
        "",
        "(a drawing of 3 shapes and lines, which this text does not show)",
        "",
      ].join("\n"),
    );
    expect([...pictures.keys()]).toEqual(["image1.png"]);
    expect(pictures.get("image1.png")).toEqual(PNG);
  });

  it("writes a document's headings, paragraphs, list items, tables, and pictures", async () => {
    const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
    const body = `<w:document><w:body>
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${run("Model checking")}</w:p>
      <w:p>${run("Clarke, Emerson, ")}${run("and Sifakis.")}</w:p>
      <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr>${run("CTL")}</w:p>
      <w:tbl><w:tr><w:tc><w:p>${run("Tool")}</w:p></w:tc><w:tc><w:p>${run("Logic")}</w:p></w:tc></w:tr><w:tr><w:tc><w:p>${run("NuSMV")}</w:p></w:tc><w:tc><w:p>${run("CTL")}</w:p></w:tc></w:tr></w:tbl>
      <w:p><w:r><w:drawing><a:blip r:embed="rId5"/></w:drawing></w:r></w:p>
    </w:body></w:document>`;
    const data = await zip({ "[Content_Types].xml": "<Types/>", "word/document.xml": body, "word/_rels/document.xml.rels": rels(rel("rId5", "image", "media/kripke.png")), "word/media/kripke.png": PNG });
    const { text, pictures } = await officeText(data, "docx", "Notes", "x");
    expect(text).toBe(["# Notes", "", "## Model checking", "", "Clarke, Emerson, and Sifakis.", "", "- CTL", "", "| Tool | Logic |", "| --- | --- |", "| NuSMV | CTL |", "", "![[x/kripke.png]]", ""].join("\n"));
    expect([...pictures.keys()]).toEqual(["kripke.png"]);
  });

  it("refuses a file that is not a zip archive", async () => {
    await expect(officeText(new TextEncoder().encode("binary"), "pptx", "x", "x")).rejects.toThrow("not a zip archive");
  });
});

describe("a capture of an Office file", () => {
  let root = "";
  let vault: FsVault;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "yami-office-"));
    vault = new FsVault(root);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("writes the text and the pictures beside the copy, links and embeds the text, and chunks it as lines", async () => {
    await vault.writeBinary("slides/Lecture 8.pptx", await deck());
    const source = await captureSource(vault, "slides/Lecture 8.pptx");
    const { properties, body } = await readDocument(vault, source);
    const copy = String(properties.file).slice(2, -2);
    const text = String(properties.text).slice(2, -2);
    expect(copy).toMatch(/^internal\/wiki\/originals\/[0-9a-f]{16}\.pptx$/);
    expect(text).toBe(copy.replace(/\.pptx$/, ".md"));
    expect(body.startsWith(`![[${text}]]\n`)).toBe(true);
    expect(await vault.read(text)).toContain(`![[${text.slice(0, -3)}/image1.png]]`);
    expect(await vault.readBinary(`${text.slice(0, -3)}/image1.png`)).toEqual(PNG);
    const wiki = new Wiki(vault);
    await wiki.refresh();
    expect(await sourceChunks(vault, wiki, source)).toMatchObject({ file: text, kind: "lines", chunks: [{ locator: expect.stringMatching(/^lines 1-\d+$/) }] });
  });

  it("captures a damaged Office file with no text, as any other file", async () => {
    await vault.write("slides/broken.docx", "not a zip");
    const { properties, body } = await readDocument(vault, await captureSource(vault, "slides/broken.docx"));
    expect(properties.text).toBeUndefined();
    expect(body).toMatch(/^!\[\[internal\/wiki\/originals\/[0-9a-f]{16}\.docx\]\]/);
  });
});
