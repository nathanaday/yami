import type { App, TFile } from "obsidian";
import { frontmatterEdit } from "../../conversation/index.js";
import { normalizeNewlines } from "../../document/text-ops.js";
import { Presence } from "../agents.js";
import type { AgentIdentity } from "../collab/agent-peer.js";
import type { CollabHub, DiskWriter } from "../collab/hub.js";
import { LiveRegion } from "../collab/region.js";
import { LOCAL_ORIGIN, type SharedNote } from "../collab/shared-note.js";

/** How often a plain note writes an agent's reply to the file while it grows. */
const WRITE_MS = 250;

/** The agent of a turn as a writer of files: its name, and whether its tools may be changing a file now. */
export interface TurnWriter {
  name: string;
  writes(path: string): boolean;
}

/** The agent's output of one turn, at the end of the conversation note. */
export interface TurnOutput {
  /** Sets the text that the output should hold. */
  set(text: string): void;
  /** Resolves when the note holds the text. */
  settled(): Promise<void>;
  /** Readies the notes that the agent's tool is about to change. */
  prepare(paths: string[]): Promise<void>;
  /** Stops writing. The text stays as it is. */
  close(): void;
}

/** The conversation note, as its controller writes it. */
export interface ConversationNote {
  /** True between `acquire` and `release`. */
  readonly ready: boolean;
  /** Readies the note for writing, until `release`. */
  acquire(): Promise<void>;
  release(): void;
  /** The text of the note. */
  text(): Promise<string>;
  /** Adds text at the end, after a blank line. */
  append(text: string): void;
  /** Sets a property, or removes it. */
  setProperty(key: string, value: string | undefined): Promise<void>;
  /** Starts an agent's output before the last line break of the note. */
  beginTurn(writer: TurnWriter): TurnOutput;
  /** Shows what the agent does now, where the note shows the agent. */
  setStatus(status: string | undefined): void;
  /** Removes the agent from the notes that show it. */
  clearPresence(): void;
}

function separator(content: string): string {
  return content.endsWith("\n\n") || !content ? "" : content.endsWith("\n") ? "\n" : "\n\n";
}

function setFrontmatter(app: App, file: TFile, key: string, value: string | undefined): Promise<void> {
  return app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
    if (value === undefined) delete frontmatter[key];
    else frontmatter[key] = value;
  });
}

/**
 * A conversation note as a shared document of the hub: the reply plays as typing with the agent's cursor,
 * and the files that the agent's tools change merge into the notes that are open.
 */
export class SharedConversationNote implements ConversationNote {
  private note: SharedNote | undefined;
  private readonly presence: Presence;

  constructor(
    private readonly app: App,
    private readonly hub: CollabHub,
    private readonly file: TFile,
    identity: () => AgentIdentity,
    animate: () => boolean,
  ) {
    this.presence = new Presence(identity, animate);
  }

  get ready(): boolean {
    return this.note !== undefined;
  }

  async acquire(): Promise<void> {
    this.note ??= await this.hub.acquire(this.file, this);
  }

  release(): void {
    if (this.note) this.hub.release(this.note, this);
    this.note = undefined;
  }

  async text(): Promise<string> {
    return this.note?.content ?? "";
  }

  append(text: string): void {
    const note = this.note;
    if (!note) return;
    const content = note.content;
    note.applyOps([{ from: content.length, to: content.length, insert: separator(content) + text }], LOCAL_ORIGIN);
  }

  async setProperty(key: string, value: string | undefined): Promise<void> {
    const note = this.note;
    if (!note) return setFrontmatter(this.app, this.file, key, value);
    const edit = frontmatterEdit(note.content, key, value);
    if (edit) note.applyOps([edit], LOCAL_ORIGIN);
  }

  beginTurn(turn: TurnWriter): TurnOutput {
    const note = this.note!;
    const peer = this.presence.peer(note);
    peer.beginTurn();
    // The turn goes before the note's last line break, so text the user types at the very end stays out of it.
    const at = note.content.length - 1;
    const writer: DiskWriter = { name: turn.name, writes: turn.writes, peer: (target) => this.presence.peer(target) };
    const region = new LiveRegion(peer, at, at);
    const stopWriting = this.hub.addWriter(writer);
    peer.setCursor(note.relative(at, -1));
    return {
      set: (text) => region.set(text),
      settled: () => region.settled(),
      // Shares a note before the agent's tool changes it, so the change merges as the agent's edit.
      prepare: (paths) => this.hub.prepare(writer, paths),
      close: () => {
        region.close();
        stopWriting();
      },
    };
  }

  setStatus(status: string | undefined): void {
    this.presence.setStatus(status);
  }

  clearPresence(): void {
    this.presence.clear();
  }
}

/**
 * The text of a note with the reply at its end changed from `written` to `target`. The reply sits before
 * the last line break. When a person changed the text meanwhile, the reply is found where it now is, and
 * else `target` goes to the end, so no reply is lost.
 */
export function replaceReply(data: string, written: string, target: string): string {
  if (data.endsWith(`${written}\n`)) return `${data.slice(0, data.length - written.length - 1)}${target}\n`;
  const at = written ? data.lastIndexOf(written) : -1;
  if (at >= 0) return data.slice(0, at) + target + data.slice(at + written.length);
  return `${data}${separator(data)}${target}\n`;
}

/**
 * A conversation note as a file of the vault, for a plugin with no hub: each change is one write of the
 * vault, in order, and a reply reaches the file a few times a second while it grows. The note shows no
 * agent cursor, and an open editor takes each write as Obsidian takes any change of a file.
 */
export class PlainConversationNote implements ConversationNote {
  ready = false;
  private work: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly app: App,
    private readonly file: TFile,
  ) {}

  async acquire(): Promise<void> {
    this.ready = true;
  }

  release(): void {
    this.ready = false;
  }

  text(): Promise<string> {
    return this.queue(async () => normalizeNewlines(await this.app.vault.read(this.file)));
  }

  append(text: string): void {
    void this.change((data) => data + separator(data) + text);
  }

  setProperty(key: string, value: string | undefined): Promise<void> {
    return this.queue(() => setFrontmatter(this.app, this.file, key, value));
  }

  beginTurn(): TurnOutput {
    let target = "";
    let written = "";
    let timer: number | undefined;
    let last: Promise<void> = Promise.resolve();
    const write = () => {
      window.clearTimeout(timer);
      timer = undefined;
      if (target === written) return;
      const [from, to] = [written, target];
      written = to;
      last = this.change((data) => replaceReply(data, from, to));
    };
    return {
      set: (text) => {
        target = text;
        timer ??= window.setTimeout(write, WRITE_MS);
      },
      settled: () => {
        write();
        return last;
      },
      prepare: () => Promise.resolve(),
      close: () => {
        window.clearTimeout(timer);
        timer = undefined;
      },
    };
  }

  setStatus(): void {}

  clearPresence(): void {}

  /** Changes the file's text after the changes before it. An error goes to the console, and the next change still runs. */
  private change(change: (data: string) => string): Promise<void> {
    return this.queue(() => this.app.vault.process(this.file, change)).then(
      () => undefined,
      (error) => console.error(`Yami: could not write ${this.file.path}`, error),
    );
  }

  private queue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.work.then(work);
    this.work = result.catch(() => undefined);
    return result;
  }
}
