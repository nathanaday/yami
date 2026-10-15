import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import * as Y from "yjs";
import type { PresenceState, SharedNote } from "./shared-note.js";
import type { TextOp } from "./text-ops.js";

export interface AgentIdentity {
  name: string;
  color: string;
}

const MOVE_MS = 90;
const SELECT_MS = 160;
const FRAME_MS = 16;
/** Most frames that one edit's typing may take, about 1.3 seconds. */
const MAX_FRAMES = 80;

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/**
 * An agent's presence in one shared note. Its changes carry the peer as the Yjs transaction origin,
 * so editors can show them as the agent's and the user can undo them separately.
 *
 * Presence uses the Yjs awareness protocol. The peer keeps its own awareness instance and sends
 * its updates to the note, as a remote client does over a network.
 */
export class AgentPeer {
  private readonly local = new Y.Doc();
  private readonly awareness = new Awareness(this.local);
  private disposed = false;

  constructor(
    readonly note: SharedNote,
    readonly identity: AgentIdentity,
    private readonly animations: () => boolean,
  ) {
    this.awareness.on("update", ({ added, updated, removed }: Record<string, number[]>) => {
      const clients = [...added!, ...updated!, ...removed!];
      applyAwarenessUpdate(note.presence, encodeAwarenessUpdate(this.awareness, clients), this);
    });
    this.awareness.setLocalState({ name: identity.name, color: identity.color } satisfies PresenceState);
    note.agentUndo.addTrackedOrigin(this);
  }

  /** Transaction origin of this peer's edits. Editors highlight them, and the user can revert them. */
  get origin(): this {
    return this;
  }

  /** Transaction origin of text that the peer writes as its own output, such as a reply. */
  readonly writer: { peer: AgentPeer } = { peer: this };

  /** The peer that made a change with this transaction origin, as an edit or as its own output. */
  static of(origin: unknown): AgentPeer | undefined {
    if (origin instanceof AgentPeer) return origin;
    if (origin && typeof origin === "object" && "peer" in origin && origin.peer instanceof AgentPeer) return origin.peer;
    return undefined;
  }

  /** True when edits should play as typing: animations are on and the user can see the note. */
  get animate(): boolean {
    return this.animations() && this.note.visible;
  }

  setStatus(status: string | undefined): void {
    if (this.disposed) return;
    this.awareness.setLocalStateField("status", status);
  }

  setCursor(anchor: Y.RelativePosition, head: Y.RelativePosition = anchor): void {
    if (this.disposed) return;
    this.awareness.setLocalStateField("cursor", { anchor: Y.relativePositionToJSON(anchor) as unknown, head: Y.relativePositionToJSON(head) as unknown });
  }

  hideCursor(): void {
    if (this.disposed) return;
    this.awareness.setLocalStateField("cursor", undefined);
  }

  /** Starts a new undo step, so "revert" removes the changes of one turn. */
  beginTurn(): void {
    this.note.agentUndo.stopCapturing();
  }

  /**
   * Applies ops that the agent made against `base`, the version of the note that the agent read.
   * Changes that the user made since then stay, and the agent's ops land where the agent meant them.
   */
  edit(ops: TextOp[], base?: Y.Snapshot): Promise<void> {
    const fork = this.note.fork(base);
    return this.editFork(fork, ops).finally(() => fork.destroy());
  }

  /** Applies ascending ops to a fork of the note. Each change on the fork merges into the note at once. */
  async editFork(fork: Y.Doc, ops: TextOp[]): Promise<void> {
    const text = fork.getText("content");
    const forward = (update: Uint8Array) => Y.applyUpdate(this.note.doc, update, this);
    fork.on("update", forward);
    try {
      const total = ops.reduce((sum, op) => sum + op.insert.length, 0);
      const perFrame = Math.max(1, Math.ceil(total / Math.min(MAX_FRAMES, Math.max(12, total / 3))));
      let offset = 0;
      for (const [index, op] of ops.entries()) {
        if (!this.animate || this.disposed) {
          applyAll(fork, text, ops.slice(index), offset);
          const last = ops.at(-1)!;
          this.setCursor(Y.createRelativePositionFromTypeIndex(text, last.from + offsetAfter(ops, offset, index) + last.insert.length));
          return;
        }
        const from = op.from + offset;
        this.setCursor(Y.createRelativePositionFromTypeIndex(text, from));
        await sleep(MOVE_MS);
        if (op.to > op.from) {
          const length = op.to - op.from;
          this.setCursor(Y.createRelativePositionFromTypeIndex(text, from), Y.createRelativePositionFromTypeIndex(text, from + length));
          await sleep(SELECT_MS);
          fork.transact(() => text.delete(from, length));
          this.setCursor(Y.createRelativePositionFromTypeIndex(text, from));
        }
        for (let typed = 0; typed < op.insert.length; typed += perFrame) {
          const chunk = op.insert.slice(typed, typed + perFrame);
          fork.transact(() => text.insert(from + typed, chunk));
          this.setCursor(Y.createRelativePositionFromTypeIndex(text, from + typed + chunk.length));
          await sleep(FRAME_MS);
        }
        offset += op.insert.length - (op.to - op.from);
      }
    } finally {
      fork.off("update", forward);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    removeAwarenessStates(this.note.presence, [this.local.clientID], this);
    this.awareness.destroy();
    this.local.destroy();
    this.note.agentUndo.removeTrackedOrigin(this);
  }
}

/** Applies `ops` (in fork coordinates before `offset`) in one transaction, last op first. */
function applyAll(fork: Y.Doc, text: Y.Text, ops: TextOp[], offset: number): void {
  fork.transact(() => {
    for (const op of [...ops].reverse()) {
      if (op.to > op.from) text.delete(op.from + offset, op.to - op.from);
      if (op.insert) text.insert(op.from + offset, op.insert);
    }
  });
}

/** The offset of the last op after ops[start..] apply at `offset`. */
function offsetAfter(ops: TextOp[], offset: number, start: number): number {
  let shift = offset;
  for (const op of ops.slice(start, -1)) shift += op.insert.length - (op.to - op.from);
  return shift;
}
