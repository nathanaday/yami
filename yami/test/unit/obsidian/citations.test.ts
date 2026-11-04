import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", async () => {
  const { StateField } = await import("@codemirror/state");
  class TFile {
    path = "";
  }
  return {
    MarkdownView: class {},
    Notice: class {},
    TFile,
    editorInfoField: StateField.define<unknown>({ create: () => undefined, update: (value) => value }),
  };
});

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { TFile } from "obsidian";
import { link } from "../../../src/document/index.js";
import { CITATION_ATTRIBUTE, CITATION_CLASS, CITATION_POPOVER_CLASS, citationExtension, citationPostProcessor, CitationPreview, wrapCitations } from "../../../src/obsidian/wiki/citations.js";
import { FsVault } from "../../../src/testing/index.js";
import { captureSource, SOURCES, TOPICS, Wiki } from "../../../src/wiki/index.js";
import { installDom } from "./dom.js";

let root: string;
let vault: FsVault;
let wiki: Wiki;
let preview: CitationPreview;
let opened: { file?: string; eState?: unknown; link?: string }[];
const views: EditorView[] = [];
const note = (path: string, properties: Record<string, unknown>, body: string) => vault.write(path, `---\n${vault.stringifyProperties(properties)}---\n${body}`);
const TEXT = ["# Notes", "An autoencoder learns a compressed code.", "The decoder expands it.", "## Training", "It trains with no labels."].join("\n");
const BODY = "An autoencoder learns a code ([[notes (source)]], lines 2-3). It is old ([[scan (source)]], p. 2). Beyond ([[notes (source)]], lines 40-41). See [[Decoder]] (not a citation). Both ([[notes (source)]], § Training; [[scan (source)]], p. 1).\n";

beforeAll(installDom);
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "yami-citation-preview-"));
  vault = new FsVault(root);
  await vault.write("papers/notes.md", TEXT);
  await vault.write("papers/scan.pdf", "%PDF-1.4\n" + "2 0 obj << /Type /Page >> endobj\n".repeat(3));
  const notes = await captureSource(vault, "papers/notes.md");
  const scan = await captureSource(vault, "papers/scan.pdf");
  await note(`${TOPICS}/Autoencoder.md`, { type: "topic", description: "A network.", sources: [link(notes), link(scan)] }, BODY);
  await note(`${TOPICS}/Decoder.md`, { type: "topic", description: "The other half." }, "Expands the code.\n");
  wiki = new Wiki(vault);
  await wiki.refresh();
  opened = [];
  const app = {
    vault: { getFileByPath: (path: string) => Object.assign(new TFile(), { path }) },
    workspace: {
      openLinkText: async (text: string) => void opened.push({ link: text }),
      getLeaf: () => ({ openFile: async (file: TFile, state?: { eState?: unknown }) => void opened.push({ file: file.path, eState: state?.eState }) }),
    },
  };
  preview = new CitationPreview(app as never, vault, wiki, 10);
});
afterEach(async () => {
  vi.useRealTimers();
  preview.hide();
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
  await rm(root, { recursive: true, force: true });
});

const parts = (element: Element) => JSON.parse(element.getAttribute(CITATION_ATTRIBUTE)!);

describe("the citation preview", () => {
  it("looks up where each part of a citation leads: the passage of a text, the page of a PDF, or the problem", async () => {
    const views = await preview.lookup([
      { target: "notes (source)", locator: "lines 2-3" },
      { target: "scan (source)", locator: "p. 2" },
      { target: "notes (source)", locator: "lines 40-41" },
      { target: "notes (source)" },
      { target: "Decoder", locator: "p. 1" },
      { target: "notes (source)", locator: "the abstract" },
    ]);
    expect(views.map((v) => [v.title, v.where, v.text, v.note])).toEqual([
      ["notes (source)", "lines 2-3", "An autoencoder learns a compressed code.\nThe decoder expands it.", undefined],
      ["scan (source)", "p. 2", undefined, "Page 2 of the PDF. Open it to read the page."],
      ["notes (source)", "lines 40-41", undefined, "This citation leads nowhere: its copy has 5 lines."],
      ["notes (source)", undefined, undefined, "The source, as a whole."],
      ["Decoder", "p. 1", undefined, "This citation leads nowhere: [[Decoder]] is not a source."],
      ["notes (source)", "the abstract", undefined, "The passage is not found in the copy. Open the source to look."],
    ]);
    expect(preview.isSource("notes (source)")).toBe(true);
    expect(preview.isSource("Decoder")).toBe(false);
    expect(preview.isSource("Nowhere")).toBe(false);
  });

  it("opens a text at the passage's line, a PDF at the page, and a source with no place as its note", async () => {
    await preview.open({ target: "notes (source)", locator: "lines 2-3" });
    expect(opened).toEqual([{ file: expect.stringMatching(/^internal\/wiki\/originals\/[0-9a-f]{16}\.md$/), eState: { line: 1 } }]);
    await preview.open({ target: "scan (source)", locator: "p. 2" });
    expect(opened[1]!.link).toMatch(/^internal\/wiki\/originals\/[0-9a-f]{16}\.pdf#page=2$/);
    await preview.open({ target: "notes (source)" });
    expect(opened[2]).toEqual({ file: expect.stringMatching(/\.md$/), eState: undefined });
    await preview.open({ target: "Nowhere", locator: "p. 1" });
    expect(opened).toHaveLength(3);
  });

  it("marks the citations of sources in the editor, with their parts, and follows the text", () => {
    const view = new EditorView({ state: EditorState.create({ doc: BODY, extensions: [citationExtension(preview)] }), parent: document.body.createDiv() });
    views.push(view);
    const marks = () => Array.from(view.dom.querySelectorAll(`.${CITATION_CLASS}`));
    expect(marks().map((m) => m.textContent)).toEqual(["([[notes (source)]], lines 2-3)", "([[scan (source)]], p. 2)", "([[notes (source)]], lines 40-41)", "([[notes (source)]], § Training; [[scan (source)]], p. 1)"]);
    expect(parts(marks()[0]!)).toEqual([{ target: "notes (source)", locator: "lines 2-3" }]);
    expect(parts(marks()[3]!)).toEqual([
      { target: "notes (source)", locator: "§ Training" },
      { target: "scan (source)", locator: "p. 1" },
    ]);
    view.dispatch({ changes: { from: BODY.length, insert: "More ([[notes (source)]], line 5). Not ([[Decoder]], p. 2)." } });
    expect(marks()).toHaveLength(5);
    expect(marks()[4]!.textContent).toBe("([[notes (source)]], line 5)");
  });

  it("wraps the citations of a rendered block, through the rendered links, and leaves prose alone", () => {
    const block = document.body.createDiv();
    block.innerHTML =
      '<p>A claim (<a class="internal-link" data-href="notes (source)" href="notes (source)">notes</a>, lines 2-3). Prose (see <a class="internal-link" data-href="Decoder">Decoder</a>). ' +
      'Both (<a class="internal-link" data-href="notes (source)">notes</a>, § Training; <a class="internal-link" data-href="scan (source)">scan</a>, p. 1). ' +
      'A topic (<a class="internal-link" data-href="Decoder">Decoder</a>, p. 9). Bare (<a class="internal-link" data-href="scan (source)">scan</a>).</p>';
    const spans = wrapCitations(block, (target) => preview.isSource(target));
    expect(spans.map((s) => s.textContent)).toEqual(["(notes, lines 2-3)", "(notes, § Training; scan, p. 1)", "(scan)"]);
    expect(parts(spans[0]!)).toEqual([{ target: "notes (source)", locator: "lines 2-3" }]);
    expect(parts(spans[1]!)).toEqual([
      { target: "notes (source)", locator: "§ Training" },
      { target: "scan (source)", locator: "p. 1" },
    ]);
    expect(parts(spans[2]!)).toEqual([{ target: "scan (source)" }]);
    expect(block.textContent).toBe("A claim (notes, lines 2-3). Prose (see Decoder). Both (notes, § Training; scan, p. 1). A topic (Decoder, p. 9). Bare (scan).");
    // A second pass wraps nothing twice.
    expect(wrapCitations(block, (target) => preview.isSource(target))).toEqual([]);
    const process = citationPostProcessor(preview);
    const other = document.body.createDiv();
    other.innerHTML = '<p>Again (<a class="internal-link" data-href="notes (source)">notes</a>, line 1).</p>';
    process(other, {} as never);
    expect(other.querySelectorAll(`.${CITATION_CLASS}`)).toHaveLength(1);
  });

  it("shows the popover when the pointer rests on a citation, opens the file from its title, and hides it when the pointer leaves", async () => {
    vi.useFakeTimers();
    const block = document.body.createDiv();
    block.innerHTML = '<p>A claim (<a class="internal-link" data-href="notes (source)">notes</a>, lines 2-3).</p>';
    const [span] = wrapCitations(block);
    const stop = preview.watch(block);
    span!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(preview.popover).toBeUndefined();
    await vi.advanceTimersByTimeAsync(20);
    // The files are read with real I/O, which the fake clock does not drive.
    await vi.waitFor(() => expect(preview.popover).toBeDefined());
    const popover = document.body.querySelector(`.${CITATION_POPOVER_CLASS}`) as HTMLElement;
    expect(popover).toBe(preview.popover);
    expect(popover.querySelector(".yami-citation-title")!.textContent).toBe("notes (source) · lines 2-3");
    expect(popover.querySelector(".yami-citation-text")!.textContent).toBe("An autoencoder learns a compressed code.\nThe decoder expands it.");
    (popover.querySelector(".yami-citation-title") as HTMLElement).click();
    expect(preview.popover).toBeUndefined();
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    expect(opened[0]).toMatchObject({ eState: { line: 1 } });
    // Hover again, then leave.
    span!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(20);
    await vi.waitFor(() => expect(preview.popover).toBeDefined());
    span!.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
    await vi.advanceTimersByTimeAsync(200);
    expect(preview.popover).toBeUndefined();
    stop();
  });
});
