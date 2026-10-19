import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", async () => {
  const { StateField } = await import("@codemirror/state");
  return { MarkdownView: class {}, editorInfoField: StateField.define<unknown>({ create: () => undefined, update: (value) => value }) };
});

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorInfoField, MarkdownView, type TFile } from "obsidian";
import * as Y from "yjs";
import { AgentPeer } from "../../../src/obsidian/collab/agent-peer.js";
import { bindingPlugin, setBindingHost } from "../../../src/obsidian/collab/binding.js";
import { presenceExtensions } from "../../../src/obsidian/collab/presence.js";
import { SharedNote } from "../../../src/obsidian/collab/shared-note.js";
import { installDom } from "./dom.js";

const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, x: left, y: top, right: left + width, bottom: top + height, toJSON: () => undefined }) as DOMRect;

/**
 * happy-dom has no layout. The scroller is a box of 600 × 400 at the origin, or the given box. Each other element,
 * such as the line of text, is 600 × 16 at the origin, and each text range is a caret at x 40.
 */
function layout(scroller = rect(0, 0, 600, 400)) {
  vi.spyOn(Range.prototype, "getClientRects").mockReturnValue([rect(40, 0, 0, 16)] as unknown as DOMRectList);
  vi.spyOn(Range.prototype, "getBoundingClientRect").mockReturnValue(rect(40, 0, 0, 16));
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return this.classList.contains("cm-scroller") ? scroller : rect(0, 0, 600, 16);
  });
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([rect(0, 0, 600, 16)] as unknown as DOMRectList);
}

const frames = () => new Promise((resolve) => setTimeout(resolve, 20));
const views: EditorView[] = [];

/** A shared note open in an editor with Yami's presence, as `installCollab` sets it up, and an agent in the note. */
async function editor(text: string) {
  const file = { path: "Note.md" } as TFile;
  const note = new SharedNote(file, text, text, { read: async () => text, author: () => undefined });
  setBindingHost({ bindings: new Set(), get: (path) => (path === file.path ? note : undefined) });
  const info = Object.assign(new MarkdownView({} as never), { file, editor: {} as { cm?: EditorView } });
  const parent = document.body.createDiv();
  const view = new EditorView({ state: EditorState.create({ doc: text, extensions: [editorInfoField.init(() => info), bindingPlugin, presenceExtensions] }), parent });
  info.editor.cm = view;
  views.push(view);
  await frames();
  const peer = new AgentPeer(note, { name: "claude", color: "#d97757" }, () => false);
  const at = (index: number) => Y.createRelativePositionFromTypeIndex(note.text, index);
  const one = (selector: string) => view.dom.querySelector<HTMLElement>(selector);
  return { note, peer, view, at, one };
}

beforeAll(installDom);

afterEach(() => {
  for (const view of views.splice(0)) {
    view.destroy();
    view.dom.parentElement?.remove();
  }
  vi.restoreAllMocks();
});

// The names of the README table "The agent's presence": a host's styles and tests use them, so a change is a break.
describe("presenceExtensions", () => {
  it("draws the agent's caret with its name flag and status, and its selection, in the agent's color", async () => {
    layout();
    const { peer, at, one } = await editor("Hello world");
    peer.setCursor(at(5));
    await frames();
    const caret = one(".yami-presence .yami-caret")!;
    expect(caret.style.getPropertyValue("--yami-agent")).toBe("#d97757");
    expect(caret.querySelector(".yami-caret-flag .yami-caret-name")!.textContent).toBe("claude");
    expect(caret.querySelector(".yami-caret-flag .yami-caret-status")!.textContent).toBe("");
    expect(one(".yami-agent-selection")).toBeNull();

    peer.setStatus("Reading Note.md");
    peer.setCursor(at(0), at(5));
    await frames();
    expect(one(".yami-caret-flag")!.textContent).toBe("claudeReading Note.md");
    const selection = one(".yami-agent-selection")!;
    expect(selection.style.getPropertyValue("--yami-agent")).toBe("#d97757");

    peer.dispose();
    await frames();
    expect(one(".yami-caret")).toBeNull();
    expect(one(".yami-agent-selection")).toBeNull();
  });

  it("marks the text that the agent just wrote, then fades the mark out", async () => {
    layout();
    const { note, peer, one } = await editor("Hello world");
    const now = Date.now();
    await peer.edit([{ from: 5, to: 5, insert: " there" }]);
    await frames();
    expect(note.content).toBe("Hello there world");
    const fresh = one(".cm-content .yami-fresh")!;
    expect(fresh.textContent).toBe(" there");
    expect(fresh.classList.contains("is-fading")).toBe(false);
    expect(fresh.style.getPropertyValue("--yami-agent")).toBe("#d97757");

    vi.spyOn(Date, "now").mockReturnValue(now + 1300);
    await vi.waitFor(() => expect(one(".yami-fresh.is-fading")).not.toBeNull());
    vi.spyOn(Date, "now").mockReturnValue(now + 2300);
    await vi.waitFor(() => expect(one(".yami-fresh")).toBeNull());
  });

  it("shows the edge pill when the agent works outside the visible part, and a click scrolls to it", async () => {
    layout(rect(0, 200, 600, 200));
    const { peer, at, one, view } = await editor("Hello world");
    peer.setStatus("Reading Note.md");
    peer.setCursor(at(5));
    await frames();
    const edge = one("button.yami-edge")!;
    await vi.waitFor(() => expect(edge.classList.contains("is-shown")).toBe(true));
    expect(edge.dataset.edge).toBe("top");
    expect(edge.textContent).toBe("claude · Reading Note.md ↑");
    expect(edge.style.getPropertyValue("--yami-agent")).toBe("#d97757");
    const scroll = vi.spyOn(view, "dispatch");
    edge.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(scroll).toHaveBeenCalledWith({ effects: expect.anything() });

    peer.dispose();
    await vi.waitFor(() => expect(edge.classList.contains("is-shown")).toBe(false));
  });
});
