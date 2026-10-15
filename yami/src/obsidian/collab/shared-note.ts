import type { TFile } from "obsidian";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import type { AgentPeer } from "./agent-peer.js";
import { type TextOp, diffOps } from "./text-ops.js";

/** Origin of changes that the host makes for the user, for example a message sent from the composer. */
export const LOCAL_ORIGIN = Symbol("yami-local");
/** Origin of changes that came from the file on disk without a known author. */
export const DISK_ORIGIN = Symbol("yami-disk");

export interface PresenceState {
  name: string;
  color: string;
  /** What the agent does now, for example "Reading Ideas.md". */
  status?: string;
  /** Relative positions, encoded with `Y.relativePositionToJSON`. */
  cursor?: { anchor: unknown; head: unknown };
}

/** A view of the note that renders it, such as a CodeMirror editor. */
export interface NoteView {
  /** True when a person can see the editor now. */
  readonly visible: boolean;
}

interface DiskState {
  text: string;
  /** The document state that matches `text`. Snapshots need `gc: false`. */
  snapshot: Y.Snapshot;
}

const EXPECTED_WRITES = 8;

/**
 * One note that the user and agents edit together. The Y.Doc is the source of truth while the note is shared.
 * The note remembers the document state that matches the file on disk. When another program, such as an
 * agent's own edit tool, changes the file, the note forks the document at that state, replays the change
 * on the fork as a peer, and merges the fork. Text that the user typed after the last save stays.
 */
export class SharedNote {
  readonly doc = new Y.Doc({ gc: false });
  readonly text = this.doc.getText("content");
  /** Presence of agents: name, color, status and cursor. The user has no presence state. */
  readonly presence = new Awareness(this.doc);
  readonly views = new Set<NoteView>();
  /** Agents' changes, one undo step per turn, so the user can revert what an agent did. */
  readonly agentUndo: Y.UndoManager;
  private disk: DiskState;
  private readonly expected = new Map<string, DiskState>();
  private diskWork: Promise<void> = Promise.resolve();
  private destroyed = false;

  constructor(
    public file: TFile,
    diskText: string,
    editorText: string,
    private readonly io: {
      read(file: TFile): Promise<string>;
      /** Chooses the peer that wrote an external change, or undefined for an unknown author. */
      author(note: SharedNote): AgentPeer | undefined;
    },
  ) {
    this.presence.setLocalState(null);
    this.doc.transact(() => this.text.insert(0, diskText), DISK_ORIGIN);
    this.disk = { text: diskText, snapshot: Y.snapshot(this.doc) };
    this.applyOps(diffOps(diskText, editorText), LOCAL_ORIGIN);
    // Peers call stopCapturing when a turn starts, so each turn becomes one undo step.
    this.agentUndo = new Y.UndoManager(this.text, { trackedOrigins: new Set(), captureTimeout: Number.MAX_SAFE_INTEGER });
  }

  get path(): string {
    return this.file.path;
  }

  get content(): string {
    return this.text.toJSON();
  }

  /** True when an editor shows the note and the user can see it. */
  get visible(): boolean {
    for (const view of this.views) if (view.visible) return true;
    return false;
  }

  relative(index: number, assoc = 0): Y.RelativePosition {
    return Y.createRelativePositionFromTypeIndex(this.text, index, assoc);
  }

  absolute(position: Y.RelativePosition): number | undefined {
    const absolute = Y.createAbsolutePositionFromRelativePosition(position, this.doc);
    return absolute && absolute.type === this.text ? absolute.index : undefined;
  }

  /** Applies ascending, non-overlapping ops in one transaction. */
  applyOps(ops: TextOp[], origin: unknown): void {
    if (!ops.length) return;
    this.doc.transact(() => {
      for (const op of [...ops].reverse()) {
        if (op.to > op.from) this.text.delete(op.from, op.to - op.from);
        if (op.insert) this.text.insert(op.from, op.insert);
      }
    }, origin);
  }

  /** Called before the host or Obsidian writes `text` to the file, so the write is not merged back as a change. */
  willWrite(text: string): void {
    if (text !== this.content) return;
    this.expected.set(text, { text, snapshot: Y.snapshot(this.doc) });
    while (this.expected.size > EXPECTED_WRITES) this.expected.delete(this.expected.keys().next().value!);
  }

  /** Reads the file and merges a change that another program made. Calls run one at a time. */
  checkDisk(): Promise<void> {
    this.diskWork = this.diskWork.then(() => this.mergeDisk()).catch((error) => console.error("Yami: could not merge a disk change", error));
    return this.diskWork;
  }

  /** Forks the document at the state that matches `base`. Edits on the fork merge into this note as concurrent edits. */
  fork(base: Y.Snapshot = Y.snapshot(this.doc)): Y.Doc {
    return Y.createDocFromSnapshot(this.doc, base, new Y.Doc({ gc: false }));
  }

  snapshot(): Y.Snapshot {
    return Y.snapshot(this.doc);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.agentUndo.destroy();
    this.presence.destroy();
    this.doc.destroy();
  }

  private async mergeDisk(): Promise<void> {
    if (this.destroyed) return;
    const text = await this.io.read(this.file);
    if (this.destroyed || text === this.disk.text) return;
    const expected = this.expected.get(text);
    if (expected) {
      this.disk = expected;
      return;
    }
    if (text === this.content) {
      this.disk = { text, snapshot: this.snapshot() };
      return;
    }
    const base = this.disk;
    const ops = diffOps(base.text, text);
    const author = this.io.author(this);
    const fork = this.fork(base.snapshot);
    if (fork.getText("content").toJSON() !== base.text) {
      // The snapshot no longer reproduces the base. Apply the change against the current text instead.
      fork.destroy();
      this.applyOps(diffOps(this.content, text), author?.origin ?? DISK_ORIGIN);
      this.disk = { text, snapshot: this.snapshot() };
      return;
    }
    if (author) {
      await author.editFork(fork, ops);
    } else {
      fork.on("update", (update: Uint8Array) => Y.applyUpdate(this.doc, update, DISK_ORIGIN));
      const forkText = fork.getText("content");
      fork.transact(() => {
        for (const op of [...ops].reverse()) {
          if (op.to > op.from) forkText.delete(op.from, op.to - op.from);
          if (op.insert) forkText.insert(op.from, op.insert);
        }
      });
    }
    this.disk = { text, snapshot: Y.snapshot(fork) };
    fork.destroy();
  }
}
