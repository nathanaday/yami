import type { EditorView } from "@codemirror/view";
import { around } from "monkey-around";
import { type App, MarkdownView, normalizePath, type Plugin, TFile, type Vault } from "obsidian";
import { AgentPeer, type AgentIdentity } from "./agent-peer.js";
import { bindingPlugin, type BindingHost, EditorBinding, setBindingHost } from "./binding.js";
import { presenceExtensions } from "./presence.js";
import { DISK_ORIGIN, SharedNote } from "./shared-note.js";
import { deltaOps, normalizeNewlines, type TextOp } from "../../document/text-ops.js";

/** How long a note stays shared after its last holder lets go, so a quick follow-up keeps the same document. */
const LINGER_MS = 20_000;
/** Delay before the hub writes a shared note that no editor shows. */
const SAVE_DELAY_MS = 300;

/** An agent that may be writing files with its own tools, for example during a conversation turn. */
export interface DiskWriter {
  /** The agent's display name. */
  name: string;
  /** True when the writer may be changing the file now. */
  writes(path: string): boolean;
  /** The writer's peer in the note. */
  peer(note: SharedNote): AgentPeer;
}

/** One change to the text of a shared note. */
export interface NoteChange {
  /** The note, as `shared` got it. Its `content` is the text after the change. */
  note: SharedNote;
  /** The path of the note now. */
  path: string;
  /** The changes, in ascending order, on `before`. */
  ops: TextOp[];
  /** The text of the note before the change. */
  before: string;
  /** The agent that made the change: an edit, a write of its tools, or its own output such as a reply. None for the person's typing and for another program's write. */
  agent?: AgentIdentity;
}

/**
 * Follows the hub's notes, for example to record what agents wrote. Each member is optional. For each note,
 * an observer hears `shared` first, then `changed` for each change, then the function that `shared` gave.
 */
export interface HubObserver {
  /**
   * A note became shared, or was shared when the observer started. The returned function runs when the note
   * stops being shared, or when the observer stops.
   */
  shared?(note: SharedNote): () => void;
  /** A writer created a note with its own tools. `text` is the note's text at creation. */
  created?(file: TFile, text: string, writer: DiskWriter): void;
  /** The text of a shared note changed. It comes after `shared` of the note, and before the function that `shared` gave. */
  changed?(change: NoteChange): void;
}

/**
 * Owns the shared notes. A note is shared while an agent works with it. While any agent works with its own
 * file tools, every note open in an editor is shared too, so a change on disk merges with unsaved typing
 * instead of replacing it.
 *
 * The hub patches two Obsidian methods while it is installed:
 * - `MarkdownView.setViewData`: Obsidian reloads an open note when its file changes on disk. For a shared
 *   note the hub merges the change itself, so it skips that reload.
 * - `Vault.modify`: Obsidian saves an editor with it. The hub records what was written, so the save does
 *   not come back as an outside change.
 *
 * One Obsidian window has one hub. `installCollab` makes it, and a second plugin finds the first one.
 */
export class CollabHub implements BindingHost {
  readonly bindings = new Set<EditorBinding>();
  private readonly notes = new Map<string, SharedNote>();
  private readonly creating = new Map<string, Promise<SharedNote>>();
  private readonly holders = new Map<SharedNote, Set<object>>();
  private readonly lingering = new Map<SharedNote, number>();
  private readonly saves = new Map<SharedNote, number>();
  private readonly writers = new Set<DiskWriter>();
  private readonly following = { holder: "open-editors" };
  private follows = 0;
  private readonly restore: (() => void)[] = [];
  private readonly observers = new Set<HubObserver>();
  /** For each shared note, the function that each observer's `shared` gave. */
  private readonly detach = new Map<SharedNote, Map<HubObserver, () => void>>();

  constructor(private readonly app: App) {}

  /** Registers editor bindings, vault events and the two patches. Call from `Plugin.onload`. */
  install(plugin: Plugin): void {
    setBindingHost(this);
    plugin.registerEditorExtension([bindingPlugin, presenceExtensions] as never);
    plugin.registerEvent(this.app.vault.on("modify", (file) => void this.notes.get(file.path)?.checkDisk()));
    plugin.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        const note = this.notes.get(oldPath);
        if (!note || !(file instanceof TFile)) return;
        this.notes.delete(oldPath);
        note.file = file;
        this.notes.set(file.path, note);
      }),
    );
    plugin.registerEvent(this.app.vault.on("delete", (file) => this.notes.has(file.path) && this.dispose(this.notes.get(file.path)!)));
    plugin.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFile && file.extension === "md" && this.writers.size) void this.adopt(file);
      }),
    );
    plugin.registerEvent(this.app.workspace.on("layout-change", () => this.follows > 0 && void this.followOpenEditors()));

    const skipReload = (view: MarkdownView, data: string) => this.skipReload(view, data);
    this.restore.push(
      around(MarkdownView.prototype, {
        setViewData: (next) =>
          function (this: MarkdownView, data: string, clear: boolean) {
            if (!clear && skipReload(this, data)) return;
            return next.call(this, data, clear);
          },
      }),
    );

    const willWrite = (file: TFile, data: string) => this.notes.get(file.path)?.willWrite(normalizeNewlines(data));
    this.restore.push(
      around(this.app.vault, {
        modify: (next) =>
          function (this: Vault, file, data, options) {
            willWrite(file, data);
            return next.call(this, file, data, options);
          },
      }),
    );
  }

  get(path: string): SharedNote | undefined {
    return this.notes.get(path);
  }

  /** Shares a note and keeps it shared until `release` with the same holder. */
  async acquire(file: TFile, holder: object): Promise<SharedNote> {
    let note = this.notes.get(file.path);
    if (!note) {
      let creating = this.creating.get(file.path);
      if (!creating) {
        creating = this.create(file).finally(() => this.creating.delete(file.path));
        this.creating.set(file.path, creating);
      }
      note = await creating;
    }
    window.clearTimeout(this.lingering.get(note));
    this.lingering.delete(note);
    let holders = this.holders.get(note);
    if (!holders) this.holders.set(note, (holders = new Set()));
    holders.add(holder);
    return note;
  }

  release(note: SharedNote, holder: object): void {
    const holders = this.holders.get(note);
    if (!holders?.delete(holder) || holders.size) return;
    window.clearTimeout(this.lingering.get(note));
    this.lingering.set(
      note,
      window.setTimeout(() => this.dispose(note), LINGER_MS),
    );
  }

  /**
   * Follows the shared notes: each note that is or becomes shared, each note that a writer creates, and each
   * change to the text of a shared note, with the text before it and the agent that made it. Returns the
   * function that stops it, which also runs the function that `shared` gave for each note that is shared then.
   * An error in an observer goes to the console, and the other observers still hear the change.
   * @example
   * hub.observe({ changed: ({ note, ops, before, agent }) => agent && ledger.record(note, before, ops, agent.name) });
   */
  observe(observer: HubObserver): () => void {
    this.observers.add(observer);
    for (const note of this.detach.keys()) this.attach(note, observer);
    return () => {
      if (!this.observers.delete(observer)) return;
      for (const stops of this.detach.values()) {
        const stop = stops.get(observer);
        stops.delete(observer);
        this.run(() => stop?.());
      }
    };
  }

  /** Tells an observer that a note is shared, and keeps the function that it gives back. */
  private attach(note: SharedNote, observer: HubObserver): void {
    if (!observer.shared) return;
    this.run(() => {
      const stop = observer.shared!(note);
      if (typeof stop === "function") this.detach.get(note)?.set(observer, stop);
    });
  }

  /** Runs an observer's code, and sends its error to the console. */
  private run(call: () => void): void {
    try {
      call();
    } catch (error) {
      console.error("Yami: a hub observer failed", error);
    }
  }

  /** While a writer is registered, its disk changes play as its edits, and open notes are shared. */
  addWriter(writer: DiskWriter): () => void {
    this.writers.add(writer);
    this.follows++;
    void this.followOpenEditors();
    return () => {
      if (!this.writers.delete(writer)) return;
      // Changes on disk can arrive a moment after the tool finishes.
      window.setTimeout(() => {
        for (const [note, holders] of [...this.holders]) if (holders.has(writer)) this.release(note, writer);
        if (--this.follows === 0) for (const note of [...this.holders.keys()]) this.release(note, this.following);
      }, 1500);
    };
  }

  /**
   * Shares the notes that a writer is about to change, until the writer stops. Then a change on disk merges
   * as the writer's edit, also when no editor shows the note.
   */
  async prepare(writer: DiskWriter, paths: string[]): Promise<void> {
    if (!this.writers.has(writer)) return;
    for (const path of paths) {
      const file = this.app.vault.getFileByPath(normalizePath(path));
      if (file?.extension === "md") await this.acquire(file, writer);
    }
  }

  /** The editor binding that shows a note, if the note is open. */
  editorFor(file: TFile): EditorBinding | undefined {
    for (const binding of this.bindings) if (binding.file === file) return binding;
    return undefined;
  }

  destroy(): void {
    for (const note of [...this.notes.values()]) this.dispose(note);
    for (const restore of this.restore.splice(0)) restore();
  }

  private async create(file: TFile): Promise<SharedNote> {
    const disk = await this.read(file);
    // Read the editor after the file, so no keystroke falls between the read and the binding.
    const editorText = this.editorFor(file)?.view.state.doc.toString() ?? disk;
    const note = new SharedNote(file, disk, editorText, {
      read: (target) => this.read(target),
      author: (target) => this.author(target),
    });
    this.notes.set(file.path, note);
    this.detach.set(note, new Map());
    for (const observer of [...this.observers]) this.attach(note, observer);
    note.doc.on("update", (_update: Uint8Array, origin: unknown) => {
      if (origin !== DISK_ORIGIN) this.scheduleSave(note);
    });
    let text = note.content;
    note.text.observe((event, transaction) => {
      const before = text;
      text = note.content;
      this.changed(note, deltaOps(event.delta), before, transaction.origin);
    });
    for (const binding of this.bindings) if (binding.file === file) binding.refresh();
    return note;
  }

  private changed(note: SharedNote, ops: TextOp[], before: string, origin: unknown): void {
    // A note that stopped being shared can still change while its last save runs; no observer hears it.
    if (!ops.length || !this.detach.has(note)) return;
    const peer = AgentPeer.of(origin);
    const change: NoteChange = { note, path: note.path, ops, before, ...(peer && { agent: { name: peer.identity.name, color: peer.identity.color } }) };
    for (const observer of [...this.observers]) this.run(() => observer.changed?.(change));
  }

  /** Shares a note that a writer created, so its later changes merge as the writer's edits. */
  private async adopt(file: TFile): Promise<void> {
    const writer = [...this.writers].find((candidate) => candidate.writes(file.path));
    if (!writer || this.notes.has(file.path)) return;
    const text = await this.read(file);
    for (const observer of this.observers) observer.created?.(file, text, writer);
    if (this.writers.has(writer)) await this.acquire(file, writer);
  }

  private author(note: SharedNote): AgentPeer | undefined {
    const writers = [...this.writers];
    const writer = writers.find((candidate) => candidate.writes(note.path)) ?? (writers.length === 1 ? writers[0] : undefined);
    return writer?.peer(note);
  }

  /** Writes a note that no editor shows. An editor saves its own note. */
  private scheduleSave(note: SharedNote): void {
    if (note.views.size || this.saves.has(note)) return;
    this.saves.set(
      note,
      window.setTimeout(() => {
        this.saves.delete(note);
        void this.save(note);
      }, SAVE_DELAY_MS),
    );
  }

  private async save(note: SharedNote): Promise<void> {
    if (note.views.size) return;
    const text = note.content;
    if (text === (await this.read(note.file))) return;
    await this.app.vault.modify(note.file, text);
  }

  private skipReload(view: MarkdownView, data: string): boolean {
    const file = view.file;
    const note = file && this.notes.get(file.path);
    const cm = (view.editor as unknown as { cm?: EditorView }).cm;
    const binding = cm && EditorBinding.of(cm);
    if (!note || binding?.note !== note || normalizeNewlines(data) === note.content) return false;
    void note.checkDisk();
    return true;
  }

  private async followOpenEditors(): Promise<void> {
    const files = new Set<TFile>();
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof MarkdownView && leaf.view.file) files.add(leaf.view.file);
    });
    await Promise.all([...files].map((file) => this.acquire(file, this.following)));
  }

  private dispose(note: SharedNote): void {
    if (this.notes.get(note.path) === note) this.notes.delete(note.path);
    const stops = this.detach.get(note);
    this.detach.delete(note);
    for (const stop of stops?.values() ?? []) this.run(stop);
    window.clearTimeout(this.lingering.get(note));
    this.lingering.delete(note);
    this.holders.delete(note);
    for (const binding of this.bindings) if (binding.note === note) binding.refresh();
    const pending = this.saves.get(note);
    this.saves.delete(note);
    window.clearTimeout(pending);
    if (pending === undefined) note.destroy();
    else void this.save(note).finally(() => note.destroy());
  }

  private async read(file: TFile): Promise<string> {
    return normalizeNewlines(await this.app.vault.adapter.read(file.path));
  }
}

const HUB_KEY = "__yamiCollabHub";

/**
 * The one hub of this Obsidian window. The first plugin that calls this
 * installs the hub; later plugins get the same one. The installing plugin
 * must call `uninstallCollab` when it unloads.
 */
export function installCollab(app: App, plugin: Plugin): CollabHub {
  const shared = window as unknown as Record<string, CollabHub | undefined>;
  let hub = shared[HUB_KEY];
  if (!hub) {
    hub = new CollabHub(app);
    hub.install(plugin);
    shared[HUB_KEY] = hub;
  }
  return hub;
}

export function uninstallCollab(hub: CollabHub): void {
  const shared = window as unknown as Record<string, CollabHub | undefined>;
  if (shared[HUB_KEY] === hub) delete shared[HUB_KEY];
  hub.destroy();
}
