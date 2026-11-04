import { type App, type Plugin, TFile } from "obsidian";
import { emptyProtected, followEdit, marksOf, protect, protectedRanges, readProtected, renameProtected, unprotect, writeProtected, type ProtectedMap, type ProtectedMark, type ProtectedRange } from "../../document/protected.js";
import type { TextOp } from "../../document/text-ops.js";
import type { Vault } from "../../document/vault.js";

/**
 * How the editor treats protected text: `block` drops a person's edit inside it, so it cannot change by
 * accident; `track` lets the edit through and moves the mark with it, so the person edits their own
 * protected text and the map stays right.
 */
export type ProtectedEditing = "block" | "track";

const SAVE_DELAY_MS = 300;

/**
 * The protected text map of the vault, in memory, with its saves. The editor extension, the guard, and the
 * commands read and change it here, so they agree, and each change reaches the listeners. The file is
 * `internal/yami/protected.json`; a file that does not parse is kept as it is, and every change is refused
 * with its reason until a person fixes it.
 */
export class ProtectedStore {
  #map: ProtectedMap = emptyProtected();
  #problem: string | undefined;
  #override: ProtectedEditing | undefined;
  #timer: number | undefined;
  #saving: Promise<void> = Promise.resolve();
  readonly #listeners = new Set<(path?: string) => void>();
  readonly #blockedListeners = new Set<(path: string) => void>();
  #blockedAt = 0;
  #loaded: Promise<void> | undefined;

  constructor(
    private readonly vault: Vault,
    /** The editing mode a host set, read at each use. */
    private readonly option: () => ProtectedEditing,
  ) {}

  /** Reads the map from the vault, once. Later calls give the same promise. */
  load(): Promise<void> {
    this.#loaded ??= readProtected(this.vault).then(
      (map) => {
        this.#map = map;
        this.#problem = undefined;
        this.notify();
      },
      (error: Error) => {
        this.#problem = error.message;
        console.error("Yami: the protected text map cannot be read", error);
      },
    );
    return this.#loaded;
  }

  /** Follows the vault's renames and removals, so a note's marks move with it and go with it. */
  install(plugin: Plugin, app: App): void {
    plugin.registerEvent(
      app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile && oldPath in this.#map.notes) this.set(renameProtected(this.#map, oldPath, file.path), file.path);
      }),
    );
    plugin.registerEvent(
      app.vault.on("delete", (file) => {
        if (file.path in this.#map.notes) this.set(unprotect(this.#map, file.path), file.path);
      }),
    );
    plugin.register(() => void this.flush());
  }

  /** Why the map cannot be used, when its file does not parse. */
  get problem(): string | undefined {
    return this.#problem;
  }

  get map(): ProtectedMap {
    return this.#map;
  }

  /** The marks of a note. */
  marks(path: string): ProtectedMark[] {
    return marksOf(this.#map, path);
  }

  /** Where the marks of a note sit in a text. */
  ranges(path: string, text: string): ProtectedRange[] {
    return protectedRanges(this.marks(path), text);
  }

  /** How the editor treats protected text now: the toggle's choice for this session, else the host's option. */
  get editing(): ProtectedEditing {
    return this.#override ?? this.option();
  }

  /** Switches between `block` and `track` for this session, and returns the new mode. */
  toggleEditing(): ProtectedEditing {
    this.#override = this.editing === "block" ? "track" : "block";
    this.notify();
    return this.#override;
  }

  /** Protects a text of a note. Returns whether the map changed. It throws for an empty text, a text the body does not hold, and a map that cannot be used. */
  protect(path: string, text: string, body?: string, note?: string): boolean {
    this.usable();
    const next = protect(this.#map, path, text, { body, note });
    if (next === this.#map) return false;
    this.set(next, path);
    return true;
  }

  /** Unprotects the marks of a note that a text touches, or all of them. Returns whether the map changed. */
  unprotect(path: string, text?: string): boolean {
    this.usable();
    const next = unprotect(this.#map, path, text);
    if (JSON.stringify(next) === JSON.stringify(this.#map)) return false;
    this.set(next, path);
    return true;
  }

  /** Moves the marks of a note with a person's edit, in `track` mode. */
  follow(path: string, before: string, ops: TextOp[]): void {
    if (this.#problem) return;
    const next = followEdit(this.#map, path, before, ops);
    if (next !== this.#map) this.set(next, path);
  }

  /** The editor dropped a person's edit of protected text in a note. The listeners hear it at most once a second, so a notice does not pile up while they type. */
  blocked(path: string): void {
    const now = Date.now();
    if (now - this.#blockedAt < 1000) return;
    this.#blockedAt = now;
    for (const listener of [...this.#blockedListeners]) listener(path);
  }

  /** Calls the listener when the editor drops an edit of protected text. Returns the function that stops it. */
  onBlocked(listener: (path: string) => void): () => void {
    this.#blockedListeners.add(listener);
    return () => this.#blockedListeners.delete(listener);
  }

  /** Calls the listener after a change to the map or the mode, with the note's path when one note changed. Returns the function that stops it. */
  onChange(listener: (path?: string) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Writes the map now, when a save waits. */
  flush(): Promise<void> {
    if (this.#timer !== undefined) {
      window.clearTimeout(this.#timer);
      this.#timer = undefined;
      this.save();
    }
    return this.#saving;
  }

  private usable(): void {
    if (this.#problem) throw new Error(`The protected text map cannot be used: ${this.#problem}`);
  }

  private set(map: ProtectedMap, path: string): void {
    this.#map = map;
    window.clearTimeout(this.#timer);
    this.#timer = window.setTimeout(() => {
      this.#timer = undefined;
      this.save();
    }, SAVE_DELAY_MS);
    this.notify(path);
  }

  private save(): void {
    const map = this.#map;
    this.#saving = this.#saving.then(() => writeProtected(this.vault, map)).catch((error) => console.error("Yami: could not save the protected text map", error));
  }

  private notify(path?: string): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(path);
      } catch (error) {
        console.error("Yami: a protected text listener threw", error);
      }
    }
  }
}
