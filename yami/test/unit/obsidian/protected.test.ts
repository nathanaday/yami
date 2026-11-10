import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", async () => {
  const { StateField } = await import("@codemirror/state");
  class Base {}
  class TFile {}
  return {
    MarkdownView: class {},
    Notice: class {},
    Modal: class { modalEl = { addClass() {} }; },
    SuggestModal: Base,
    FuzzySuggestModal: Base,
    Setting: Base,
    TFile,
    debounce: (fn: unknown) => fn,
    getIcon: () => ({}),
    editorInfoField: StateField.define<unknown>({ create: () => undefined, update: (value) => value }),
  };
});

import { EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorInfoField, MarkdownView, type Command, type TFile } from "obsidian";
import { DEFAULT_FOLDERS, readProtected } from "../../../src/document/index.js";
import { AgentPeer } from "../../../src/obsidian/collab/agent-peer.js";
import { bindingPlugin, setBindingHost, syncAnnotation } from "../../../src/obsidian/collab/binding.js";
import { CollabHub } from "../../../src/obsidian/collab/hub.js";
import { LOCAL_ORIGIN, SharedNote } from "../../../src/obsidian/collab/shared-note.js";
import { addProtectedCommands, PROTECTED_EDITABLE, PROTECTED_LOCKED } from "../../../src/obsidian/commands.js";
import { PROTECTED_BLOCK_CLASS, PROTECTED_CLASS, protectedExtension, protectedPostProcessor } from "../../../src/obsidian/protected/editor.js";
import { protectedGuard } from "../../../src/obsidian/protected/guard.js";
import { ProtectedStore, type ProtectedEditing } from "../../../src/obsidian/protected/store.js";
import type { ObsidianYami } from "../../../src/obsidian/yami.js";
import { FsVault } from "../../../src/testing/index.js";
import { applyOps, diffOps } from "../../../src/document/text-ops.js";
import { installDom } from "./dom.js";

const TEXT = "# Levain\n\nLevain is a starter.\n\nMy own words: I feed mine at dawn.\n\nSee Sourdough.\n";
const MINE = "My own words: I feed mine at dawn.";
const file = { path: "Levain.md" } as TFile;

let root: string;
let vault: FsVault;
let store: ProtectedStore;
let mode: ProtectedEditing = "block";
const views: EditorView[] = [];

beforeAll(installDom);
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "yami-protected-"));
  vault = new FsVault(root);
  mode = "block";
  store = new ProtectedStore(vault, () => mode);
  await store.load();
});
afterEach(async () => {
  vi.useRealTimers();
  for (const view of views.splice(0)) view.destroy();
  await rm(root, { recursive: true, force: true });
});

/** An editor over a note, with the binding (as every Obsidian editor has) and the protected extension. */
function editor(text = TEXT, shared?: SharedNote) {
  setBindingHost({ bindings: new Set(), get: (path) => (shared && path === file.path ? shared : undefined) });
  const info = Object.assign(new MarkdownView({} as never), { file, editor: {} as { cm?: EditorView } });
  const view = new EditorView({ state: EditorState.create({ doc: text, extensions: [editorInfoField.init(() => info), bindingPlugin, protectedExtension(store)] }), parent: document.body.createDiv() });
  info.editor.cm = view;
  views.push(view);
  const marked = () => [...view.dom.querySelectorAll(`.${PROTECTED_CLASS}`)].map((el) => el.textContent).join("");
  return { view, marked };
}

describe("the protected store", () => {
  it("protects and unprotects, saves, follows renames and removals, and toggles the mode", async () => {
    vi.useFakeTimers();
    const changes: (string | undefined)[] = [];
    store.onChange((path) => changes.push(path));
    expect(store.protect(file.path, MINE, TEXT)).toBe(true);
    expect(store.protect(file.path, MINE, TEXT)).toBe(false);
    expect(() => store.protect(file.path, "not in it", TEXT)).toThrow("does not hold the text");
    expect(store.marks(file.path).map((m) => m.text)).toEqual([MINE]);
    expect(store.ranges(file.path, TEXT)).toMatchObject([{ from: TEXT.indexOf(MINE), to: TEXT.indexOf(MINE) + MINE.length }]);
    await vi.advanceTimersByTimeAsync(400);
    await store.flush();
    expect((await readProtected(vault)).notes[file.path]).toHaveLength(1);
    expect(store.editing).toBe("block");
    expect(store.toggleEditing()).toBe("track");
    expect(store.editing).toBe("track");
    mode = "track";
    expect(store.toggleEditing()).toBe("block");
    expect(store.unprotect(file.path, "feed mine")).toBe(true);
    expect(store.unprotect(file.path)).toBe(false);
    await store.flush();
    expect((await readProtected(vault)).notes).toEqual({});
    expect(changes).toEqual([file.path, undefined, undefined, file.path]);
    vi.useRealTimers();
  });

  it("keeps a map that does not parse as it is, and refuses changes with the reason", async () => {
    await vault.write(DEFAULT_FOLDERS.protected, "{ broken");
    const broken = new ProtectedStore(vault, () => "block");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await broken.load();
    expect(broken.problem).toContain("does not parse");
    expect(() => broken.protect(file.path, MINE, TEXT)).toThrow("The protected text map cannot be used");
    expect(await vault.read(DEFAULT_FOLDERS.protected)).toBe("{ broken");
    error.mockRestore();
  });
});

describe("the protected extension", () => {
  it("marks the protected text, drops an edit inside it in block mode, and lets edits at its edges, elsewhere, and from the shared note through", () => {
    store.protect(file.path, MINE, TEXT);
    const { view, marked } = editor();
    expect(marked()).toBe(MINE);
    const at = TEXT.indexOf("dawn");
    const blocked: string[] = [];
    store.onBlocked((path) => blocked.push(path));
    view.dispatch({ changes: { from: at, to: at + 4, insert: "dusk" } });
    expect(view.state.doc.toString()).toBe(TEXT);
    expect(blocked).toEqual([file.path]);
    view.dispatch({ changes: { from: TEXT.indexOf(MINE), insert: "> " } });
    expect(view.state.doc.toString()).toContain(`> ${MINE}`);
    view.dispatch({ changes: { from: 0, insert: "Intro\n\n" } });
    expect(view.state.doc.toString().startsWith("Intro\n\n")).toBe(true);
    expect(marked()).toBe(MINE);
    // A change from the shared note is an agent's or the disk's: the guard handles those, not the filter.
    const inside = view.state.doc.toString().indexOf("dawn");
    view.dispatch({ changes: { from: inside, to: inside + 4, insert: "noon" }, annotations: [syncAnnotation.of(Symbol("peer")), Transaction.remote.of(true)] });
    expect(view.state.doc.toString()).toContain("I feed mine at noon");
    expect(marked()).toBe("");
    expect(store.marks(file.path).map((m) => m.text)).toEqual([MINE]);
  });

  it("follows the person's edit in track mode, so the mark takes the new text", async () => {
    mode = "track";
    store.protect(file.path, MINE, TEXT);
    const { view, marked } = editor();
    const at = TEXT.indexOf("dawn");
    view.dispatch({ changes: { from: at, to: at + 4, insert: "dusk" } });
    expect(view.state.doc.toString()).toContain("I feed mine at dusk");
    expect(store.marks(file.path).map((m) => m.text)).toEqual([MINE.replace("dawn", "dusk")]);
    expect(marked()).toBe(MINE.replace("dawn", "dusk"));
    // A change of the map redraws: unprotect, and the mark goes.
    store.unprotect(file.path);
    expect(marked()).toBe("");
  });

  it("marks a Reading view block that holds protected text", () => {
    store.protect(file.path, MINE, TEXT);
    const process = protectedPostProcessor(store);
    const lines = TEXT.split("\n");
    const section = (lineStart: number, lineEnd: number) => ({ sourcePath: file.path, getSectionInfo: () => ({ text: TEXT, lineStart, lineEnd }), addChild() {}, docId: "", frontmatter: {} });
    const yes = document.body.createDiv();
    process(yes, section(lines.indexOf(MINE), lines.indexOf(MINE)) as never);
    expect(yes.classList.contains(PROTECTED_BLOCK_CLASS)).toBe(true);
    const no = document.body.createDiv();
    process(no, section(0, 0) as never);
    expect(no.classList.contains(PROTECTED_BLOCK_CLASS)).toBe(false);
    const other = document.body.createDiv();
    process(other, { ...section(0, 10), sourcePath: "Other.md" } as never);
    expect(other.classList.contains(PROTECTED_BLOCK_CLASS)).toBe(false);
  });
});

describe("the protected guard", () => {
  it("puts a protected text back when an agent's edit changes it, keeps the agent's other edits, and leaves the person's typing alone", async () => {
    store.protect(file.path, MINE, TEXT);
    const hub = new CollabHub({ vault: { adapter: { read: async () => TEXT }, modify: async () => undefined } } as never);
    const notices: string[] = [];
    hub.observe(protectedGuard(store, (message) => notices.push(message)));
    const note = await hub.acquire(file, {});
    const peer = new AgentPeer(note, { name: "claude", color: "#d97757" }, () => false);
    await peer.edit(diffOps(note.content, TEXT.replace("Levain is a starter.", "Levain is a sourdough starter.").replace(MINE, "I feed it at dawn.")));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(note.content).toBe(TEXT.replace("Levain is a starter.", "Levain is a sourdough starter."));
    expect(notices).toEqual([`Yami kept the protected text in Levain that claude changed: "${MINE}".`]);
    // The person's own typing inside the mark is theirs: nothing is put back.
    const at = note.content.indexOf("dawn");
    note.applyOps([{ from: at, to: at + 4, insert: "dusk" }], LOCAL_ORIGIN);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(note.content).toContain("I feed mine at dusk");
    expect(notices).toHaveLength(1);
    // An agent's edit that keeps the text passes.
    await peer.edit(diffOps(note.content, `${note.content}\nMore from the agent.\n`));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(note.content).toContain("More from the agent.");
    expect(notices).toHaveLength(1);
    hub.destroy();
  });
});

describe("the protected commands", () => {
  it("protects and unprotects the selection, toggles the mode, and offers the menu item on a selection", async () => {
    const commands = new Map<string, Command>();
    const menus: { title: string; run: () => void }[] = [];
    let menuHandler: ((menu: unknown, editor: unknown, info: unknown) => void) | undefined;
    const host = {
      app: { workspace: { on: (_name: string, handler: typeof menuHandler) => ((menuHandler = handler), {}) } },
      plugin: { addCommand: (command: Command) => commands.set(command.id, command), registerEvent: () => undefined },
      protected: store,
    } as unknown as ObsidianYami;
    addProtectedCommands(host);
    expect([...commands.keys()]).toEqual(["yami-protect-selection", "yami-unprotect-selection", "yami-toggle-protected-editing"]);
    let selection = MINE;
    const editor = { getSelection: () => selection, getValue: () => TEXT };
    const ctx = { file };
    const check = (id: string, checking = true) => commands.get(id)!.editorCheckCallback!(checking, editor as never, ctx as never);
    expect(check("yami-unprotect-selection")).toBe(false);
    expect(check("yami-protect-selection")).toBe(true);
    check("yami-protect-selection", false);
    expect(store.marks(file.path).map((m) => m.text)).toEqual([MINE]);
    selection = "   ";
    expect(check("yami-protect-selection")).toBe(false);
    selection = "feed mine";
    expect(check("yami-unprotect-selection")).toBe(true);
    const menu = { addItem: (make: (item: unknown) => void) => make({ setTitle(title: string) { menus.push({ title, run: () => undefined }); return this; }, setIcon() { return this; }, onClick(run: () => void) { menus[menus.length - 1]!.run = run; return this; } }) };
    menuHandler!(menu, editor, ctx);
    expect(menus.map((m) => m.title)).toEqual(["Unprotect this text"]);
    menus[0]!.run();
    expect(store.marks(file.path)).toEqual([]);
    menuHandler!(menu, editor, ctx);
    expect(menus.at(-1)!.title).toBe("Protect this text");
    commands.get("yami-toggle-protected-editing")!.callback!();
    expect(store.editing).toBe("track");
    expect(PROTECTED_EDITABLE).toContain("editable");
    expect(PROTECTED_LOCKED).toContain("locked");
    // The commands never run with no file: an editor of a view with none has nothing to protect.
    expect(commands.get("yami-protect-selection")!.editorCheckCallback!(true, editor as never, { file: null } as never)).toBe(false);
  });
});
