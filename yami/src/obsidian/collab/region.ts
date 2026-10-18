import type * as Y from "yjs";
import type { AgentPeer } from "./agent-peer.js";
import { diffOps, shiftOps } from "../../document/text-ops.js";

const TICK_MS = 24;
const STILL_MS = 140;

/**
 * A part of a shared note that an agent writes as its own output, such as a reply callout. Its changes
 * use the peer's writer origin, so they are not highlighted as edits and "undo the agent's changes"
 * leaves them alone.
 *
 * Callers set the text that the region should hold. The region changes the note toward it: appended
 * text is typed a few characters at a time, and other changes apply as small edits. The user can edit
 * the rest of the note during this.
 *
 * The start is anchored to the character before the region and the end to the character after it,
 * so text that the region inserts at either edge stays inside it.
 */
export class LiveRegion {
  private start: Y.RelativePosition;
  private end: Y.RelativePosition;
  private target: string;
  private timer: number | undefined;
  private waiters: (() => void)[] = [];
  private lost = false;

  constructor(
    private readonly peer: AgentPeer,
    from: number,
    to: number,
    /** Returns false when the region's text shows that the user removed it. The region then stops writing. */
    private readonly intact: (text: string) => boolean = () => true,
  ) {
    const { note } = peer;
    this.start = note.relative(from, -1);
    this.end = note.relative(to, 0);
    this.target = note.content.slice(from, to);
  }

  /** True after the user removed the region. */
  get gone(): boolean {
    return this.lost;
  }

  get range(): { from: number; to: number } | undefined {
    const from = this.peer.note.absolute(this.start);
    const to = this.peer.note.absolute(this.end);
    return from === undefined || to === undefined || to < from ? undefined : { from, to };
  }

  get text(): string {
    const range = this.range;
    return range ? this.peer.note.content.slice(range.from, range.to) : "";
  }

  set(target: string): void {
    this.target = target;
    this.schedule(0);
  }

  /** Writes the target now, without typing. Resolves when the note holds it. */
  flush(): Promise<void> {
    window.clearTimeout(this.timer);
    this.timer = undefined;
    this.step(true);
    return Promise.resolve();
  }

  /** Resolves when the note holds the target. */
  settled(): Promise<void> {
    if (this.lost || this.text === this.target) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  /** Stops writing. The text stays as it is. */
  close(): void {
    window.clearTimeout(this.timer);
    this.timer = undefined;
    this.release();
  }

  private schedule(delay: number): void {
    if (this.timer !== undefined || this.lost) return;
    this.timer = window.setTimeout(() => {
      this.timer = undefined;
      this.step(!this.peer.animate);
    }, delay);
  }

  private step(instant: boolean): void {
    const { note } = this.peer;
    const range = this.range;
    const actual = range ? note.content.slice(range.from, range.to) : "";
    if (!range || !this.intact(actual)) {
      this.lost = true;
      this.release();
      return;
    }
    if (actual === this.target) {
      this.release();
      return;
    }
    if (!instant && this.target.startsWith(actual)) {
      const backlog = this.target.length - actual.length;
      const chunk = this.target.slice(actual.length, actual.length + Math.max(2, Math.ceil(backlog / 6)));
      note.applyOps([{ from: range.to, to: range.to, insert: chunk }], this.peer.writer);
      this.peer.setCursor(note.relative(range.to + chunk.length, -1));
      this.schedule(TICK_MS);
      return;
    }
    const ops = diffOps(actual, this.target);
    note.applyOps(shiftOps(ops, range.from), this.peer.writer);
    const last = ops.at(-1)!;
    const shift = ops.reduce((sum, op) => sum + op.insert.length - (op.to - op.from), 0);
    const cursor = range.from + last.from + last.insert.length + shift - (last.insert.length - (last.to - last.from));
    this.peer.setCursor(note.relative(cursor, -1));
    if (!instant) this.schedule(STILL_MS);
    else this.release();
  }

  private release(): void {
    for (const resolve of this.waiters.splice(0)) resolve();
  }
}
