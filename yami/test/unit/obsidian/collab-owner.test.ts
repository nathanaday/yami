import { createRequire } from "node:module";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", async () => {
  const { StateField } = await import("@codemirror/state");
  class Notice {
    static messages: string[] = [];
    constructor(message: string) {
      Notice.messages.push(message);
    }
  }
  class MarkdownView {
    setViewData() {}
  }
  return {
    MarkdownView,
    Notice,
    TFile: class {},
    normalizePath: (path: string) => path,
    editorInfoField: StateField.define<unknown>({ create: () => undefined, update: (value) => value }),
  };
});

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorInfoField, MarkdownView, Notice, type Plugin, type TFile } from "obsidian";
import * as Y from "yjs";
import { AgentPeer } from "../../../src/obsidian/collab/agent-peer.js";
import { bindingPlugin } from "../../../src/obsidian/collab/binding.js";
import { CollabHub, collabOwner, installCollab, uninstallCollab } from "../../../src/obsidian/collab/hub.js";
import type { SharedNote } from "../../../src/obsidian/collab/shared-note.js";
import { installDom } from "./dom.js";

/** A second copy of Yjs, as another plugin's bundle holds one. */
const Foreign = createRequire(import.meta.url)("yjs") as typeof Y;

const notices = () => (Notice as unknown as { messages: string[] }).messages;
const slots = () => globalThis as unknown as Record<string, unknown>;
const file = { path: "Note.md" } as TFile;

beforeAll(() => {
  installDom();
  // Yjs says so when a second copy loads. The copy is the point of these tests.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

function fakeApp(text = "how de we estimate") {
  const modify = vi.fn(async () => undefined);
  return { modify, app: { vault: { on: () => ({}), modify, adapter: { read: async () => text } }, workspace: { on: () => ({}), iterateAllLeaves: () => undefined } } };
}

/** A plugin as Obsidian's Component: it runs what was registered when it unloads, the last first. */
function fakePlugin(name: string) {
  const stops: (() => void)[] = [];
  const plugin = {
    manifest: { id: name.toLowerCase(), name },
    _loaded: true,
    register: (stop: () => void) => stops.push(stop),
    registerEvent: () => undefined,
    registerEditorExtension: () => undefined,
    unload() {
      plugin._loaded = false;
      while (stops.length) stops.pop()!();
    },
  };
  return plugin as typeof plugin & Plugin;
}

/** Writes to a note as a plugin with another copy of Yjs did: on its own fork, merged with its own `applyUpdate`. */
function foreignEdit(note: SharedNote, from: number, remove: number, insert: string) {
  const fork = new Foreign.Doc({ gc: false });
  Foreign.applyUpdate(fork, Y.encodeStateAsUpdate(note.doc));
  fork.on("update", (update: Uint8Array) => Foreign.applyUpdate(note.doc as never, update));
  const text = fork.getText("content");
  fork.transact(() => text.delete(from, remove));
  fork.transact(() => text.insert(from, insert));
}

const hubs: CollabHub[] = [];
afterEach(() => {
  for (const hub of hubs.splice(0)) uninstallCollab(hub);
  delete slots().__yamiCollab;
  delete slots().__yamiCollabHub;
  notices().length = 0;
});

describe("installCollab", () => {
  it("gives the hub to one plugin, and refuses the next while the first is loaded", () => {
    const duet = fakePlugin("Duet");
    const hub = installCollab(fakeApp().app as never, duet);
    hubs.push(hub!);
    expect(hub).toBeInstanceOf(CollabHub);
    expect(installCollab(fakeApp().app as never, fakePlugin("Other"))).toBeUndefined();
    expect(collabOwner()).toBe("Duet");
  });

  it("frees the window when the plugin unloads, before the plugin destroys the hub", () => {
    const old = fakePlugin("Duet");
    const first = installCollab(fakeApp().app as never, old)!;
    hubs.push(first);
    old.unload();
    expect(collabOwner()).toBeUndefined();
    const second = installCollab(fakeApp().app as never, fakePlugin("Duet"))!;
    hubs.push(second);
    expect(second).not.toBe(first);
    // The old plugin destroys its hub later, when its conversations closed: the new lock stays.
    uninstallCollab(first);
    expect(collabOwner()).toBe("Duet");
  });

  it("replaces the lock of a plugin that is no longer loaded", () => {
    const gone = fakePlugin("Gone");
    hubs.push(installCollab(fakeApp().app as never, gone)!);
    gone._loaded = false;
    const hub = installCollab(fakeApp().app as never, fakePlugin("Duet"));
    hubs.push(hub!);
    expect(hub).toBeInstanceOf(CollabHub);
    expect(collabOwner()).toBe("Duet");
  });

  it("refuses while a plugin on a Yami before 0.25 has its hub in the window", () => {
    slots().__yamiCollabHub = { acquire() {}, observe() {} };
    expect(installCollab(fakeApp().app as never, fakePlugin("Duet"))).toBeUndefined();
    expect(collabOwner()).toBe("a plugin built on an older Yami");
  });

  it("stops a plugin on a Yami before 0.25 that looks for the hub later", () => {
    hubs.push(installCollab(fakeApp().app as never, fakePlugin("Duet"))!);
    // What installCollab of the older library does: it takes whatever the window holds, and uses it as the hub.
    const found = slots().__yamiCollabHub as { observe(): void };
    expect(found).toBeTruthy();
    expect(() => found.observe()).toThrow(/Duet has live editing in this window/);
    expect(notices()).toHaveLength(1);
  });
});

describe("a document that another copy of Yjs wrote to", () => {
  it("counts characters that its text does not show", async () => {
    const hub = new CollabHub(fakeApp().app as never);
    const note = await hub.acquire(file, {});
    expect(note.sound).toBe(true);
    foreignEdit(note, 5, 1, "o");
    // The removal applied, and the insertion did not show.
    expect(note.content).toBe("how d we estimate");
    expect(note.text.length).toBe(18);
    expect(note.sound).toBe(false);
    hub.destroy();
  });

  it("stops being shared at the person's next edit, with the editor's text kept and nothing saved", async () => {
    const { app, modify } = fakeApp();
    const plugin = fakePlugin("Duet");
    const hub = installCollab(app as never, plugin)!;
    hubs.push(hub);
    const info = Object.assign(new MarkdownView({} as never), { file, editor: {} as { cm?: EditorView } });
    const view = new EditorView({ state: EditorState.create({ doc: "how de we estimate", extensions: [editorInfoField.init(() => info), bindingPlugin] }), parent: document.body.createDiv() });
    info.editor.cm = view;
    const note = await hub.acquire(file, {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    view.dispatch({ changes: { from: 0, insert: "So " } });
    expect(note.content).toBe("So how de we estimate");

    foreignEdit(note, 8, 1, "o");
    expect(view.state.doc.toString()).toBe("So how d we estimate");
    view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });
    expect(hub.get(file.path)).toBeUndefined();
    expect(view.state.doc.toString()).toBe("So how d we estimate!");
    expect(notices()).toEqual([expect.stringContaining("stopped live editing of Note.md")]);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(modify).not.toHaveBeenCalled();
    view.destroy();
  });

  it("refuses an agent of this copy in a note of another copy", () => {
    const doc = new Foreign.Doc();
    expect(() => new AgentPeer({ doc } as never, { name: "claude", color: "" }, () => false)).toThrow(/another plugin's copy of Yami/);
  });
});
