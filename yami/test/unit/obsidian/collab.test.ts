import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({}));

import type { TFile } from "obsidian";
import type { AgentEvent } from "../../../src/agent/index.js";
import { renderTurn, TurnTranscript, userBlock } from "../../../src/conversation/index.js";
import * as Y from "yjs";
import { AgentPeer } from "../../../src/obsidian/collab/agent-peer.js";
import { CollabHub, type NoteChange } from "../../../src/obsidian/collab/hub.js";
import { LiveRegion } from "../../../src/obsidian/collab/region.js";
import { LOCAL_ORIGIN, SharedNote } from "../../../src/obsidian/collab/shared-note.js";
import { applyOps, diffOps } from "../../../src/document/text-ops.js";

beforeAll(() => {
  (globalThis as { window?: unknown }).window = globalThis;
});

const file = { path: "Note.md" } as TFile;
const notes: SharedNote[] = [];

function shared(disk: string, editor = disk, read = async () => disk, author?: () => AgentPeer | undefined) {
  const note = new SharedNote(file, disk, editor, { read, author: () => author?.() });
  notes.push(note);
  return note;
}

afterEach(() => {
  for (const note of notes.splice(0)) note.destroy();
});

/** Types like a user: inserts text at an index. */
function type(note: SharedNote, index: number, text: string) {
  note.applyOps([{ from: index, to: index, insert: text }], LOCAL_ORIGIN);
}

describe("SharedNote", () => {
  it("starts from the editor text and keeps the disk text as the base", async () => {
    let disk = "Title\n\nBody";
    const note = shared(disk, "Title\n\nBody, typed but not saved", async () => disk);
    expect(note.content).toBe("Title\n\nBody, typed but not saved");
    // Another program changes the title on disk. The unsaved typing stays.
    disk = "New title\n\nBody";
    await note.checkDisk();
    expect(note.content).toBe("New title\n\nBody, typed but not saved");
  });

  it("merges an agent write with typing that happened after the last save", async () => {
    let disk = "# Plan\n\n- one\n- two\n";
    const note = shared(disk, disk, async () => disk);
    type(note, note.content.length, "- three\n");
    // The agent edited the file as it was on disk, without the new line.
    disk = "# Plan\n\n- one (done)\n- two\n";
    await note.checkDisk();
    expect(note.content).toBe("# Plan\n\n- one (done)\n- two\n- three\n");
  });

  it("ignores its own save when the file changes to the saved text", async () => {
    let disk = "a";
    const note = shared(disk, disk, async () => disk);
    type(note, 1, "b");
    note.willWrite("ab");
    type(note, 2, "c");
    disk = "ab";
    await note.checkDisk();
    expect(note.content).toBe("abc");
  });

  it("applies an agent write as the agent, so it can be undone", async () => {
    let disk = "Hello world";
    let peer: AgentPeer | undefined;
    const note = shared(disk, disk, async () => disk, () => peer);
    peer = new AgentPeer(note, { name: "Claude", color: "#d97757" }, () => false);
    type(note, 0, ">> ");
    disk = "Hello there world";
    await note.checkDisk();
    expect(note.content).toBe(">> Hello there world");
    note.agentUndo.undo();
    expect(note.content).toBe(">> Hello world");
  });
});

describe("the hub's feed of changes", () => {
  it("gives each change to a shared note as ops, with the agent that made it or none", async () => {
    const text = "The quick fox";
    const hub = new CollabHub({ vault: { adapter: { read: async () => text }, modify: async () => undefined } } as never);
    const changes: NoteChange[] = [];
    const stop = hub.observe({ changed: (change) => changes.push(change) });
    hub.observe({
      changed: () => {
        throw new Error("observer bug");
      },
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const holder = {};
    const note = await hub.acquire(file, holder);
    const peer = new AgentPeer(note, { name: "claude", color: "#d97757" }, () => false);
    await peer.edit(diffOps(note.content, "The slow fox"));
    type(note, note.content.length, "!");
    note.applyOps([{ from: 0, to: 0, insert: "> " }], peer.writer);
    expect(changes).toEqual([
      { note, path: "Note.md", ops: [{ from: 4, to: 9, insert: "slow" }], before: "The quick fox", agent: { name: "claude", color: "#d97757" } },
      { note, path: "Note.md", ops: [{ from: 12, to: 12, insert: "!" }], before: "The slow fox" },
      { note, path: "Note.md", ops: [{ from: 0, to: 0, insert: "> " }], before: "The slow fox!", agent: { name: "claude", color: "#d97757" } },
    ]);
    for (const change of changes.slice(0, -1)) expect(applyOps(change.before, change.ops)).toBe(changes[changes.indexOf(change) + 1]!.before);
    expect(error).toHaveBeenCalledTimes(3);
    error.mockRestore();
    stop();
    type(note, 0, "x");
    expect(changes).toHaveLength(3);
    hub.destroy();
  });

  it("gives each observer shared, then the changes, then the stop, also an observer that starts while a note is shared", async () => {
    vi.useFakeTimers();
    const hub = new CollabHub({ vault: { adapter: { read: async () => "a" }, modify: async () => undefined } } as never);
    const heard: string[] = [];
    const observer = (name: string) => ({
      shared: (note: SharedNote) => {
        heard.push(`${name} shared ${note.path}`);
        return () => heard.push(`${name} stop ${note.path}`);
      },
      changed: ({ before }: NoteChange) => void heard.push(`${name} changed ${before}`),
    });
    hub.observe(observer("first"));
    const holder = {};
    const note = await hub.acquire(file, holder);
    type(note, 1, "b");
    const stopLate = hub.observe(observer("late"));
    type(note, 2, "c");
    stopLate();
    type(note, 3, "d");
    hub.release(note, holder);
    vi.runAllTimers();
    type(note, 4, "e");
    expect(heard).toEqual(["first shared Note.md", "first changed a", "late shared Note.md", "first changed ab", "late changed ab", "late stop Note.md", "first changed abc", "first stop Note.md"]);
    hub.destroy();
    vi.useRealTimers();
  });
});

describe("AgentPeer", () => {
  it("applies edits against the version the agent read", async () => {
    const note = shared("alpha\nbeta\ngamma");
    const peer = new AgentPeer(note, { name: "Claude", color: "#d97757" }, () => false);
    const base = note.snapshot();
    type(note, 0, "intro\n");
    // The agent read the note before the user's line and replaces "beta" in that version.
    await peer.edit([{ from: 6, to: 10, insert: "BETA" }], base);
    expect(note.content).toBe("intro\nalpha\nBETA\ngamma");
  });

  it("keeps text the user types inside a range the agent rewrites", async () => {
    const note = shared("one two three");
    const peer = new AgentPeer(note, { name: "Claude", color: "#d97757" }, () => false);
    const base = note.snapshot();
    type(note, 7, " and a half");
    await peer.edit([{ from: 4, to: 13, insert: "TWO THREE" }], base);
    expect(note.content).toBe("one  and a halfTWO THREE");
  });

  it("types an edit when the note is visible, with the same result", async () => {
    const note = shared("The quick brown fox.");
    note.views.add({ visible: true });
    const peer = new AgentPeer(note, { name: "Claude", color: "#d97757" }, () => true);
    const edit = peer.edit(diffOps(note.content, "The slow brown fox jumps."));
    type(note, 0, "> ");
    await edit;
    expect(note.content).toBe("> The slow brown fox jumps.");
    const state = [...note.presence.getStates().values()].find(Boolean) as { cursor: { head: unknown } };
    expect(note.absolute(Y.createRelativePositionFromJSON(state.cursor.head))).toBe(note.content.indexOf(" jumps") + " jumps".length);
  });

  it("shows its cursor through presence", async () => {
    const note = shared("text");
    const peer = new AgentPeer(note, { name: "Codex", color: "#3b82f6" }, () => false);
    peer.setStatus("Reading Note.md");
    peer.setCursor(note.relative(2));
    const states = [...note.presence.getStates().values()];
    expect(states).toContainEqual(expect.objectContaining({ name: "Codex", status: "Reading Note.md", cursor: expect.anything() }));
    peer.dispose();
    expect([...note.presence.getStates().values()].filter(Boolean)).toEqual([]);
  });
});

describe("LiveRegion", () => {
  it("writes its text while the user types before and after it", async () => {
    const note = shared("@claude hi\n> [!agent]+ Claude\n\nafter");
    const peer = new AgentPeer(note, { name: "Claude", color: "#d97757" }, () => false);
    const region = new LiveRegion(peer, 11, 29, (text) => text.startsWith("> [!agent]"));
    type(note, 0, "top\n");
    region.set("> [!agent]+ Claude\n> Hello");
    await region.flush();
    type(note, note.content.length, "!");
    region.set("> [!agent]+ Claude\n> Hello there");
    await region.flush();
    expect(note.content).toBe("top\n@claude hi\n> [!agent]+ Claude\n> Hello there\n\nafter!");
  });

  it("stops when the user deletes it", async () => {
    const note = shared("x\n> [!agent]+ Claude\n\ny");
    const peer = new AgentPeer(note, { name: "Claude", color: "#d97757" }, () => false);
    const region = new LiveRegion(peer, 2, 20, (text) => text.startsWith("> [!agent]"));
    note.applyOps([{ from: 2, to: 21, insert: "" }], LOCAL_ORIGIN);
    region.set("> [!agent]+ Claude\n> late");
    await region.flush();
    expect(region.gone).toBe(true);
    expect(note.content).toBe("x\n\ny");
  });

  it("grows a region at the end of the note", async () => {
    const note = shared("# Chat\n");
    const peer = new AgentPeer(note, { name: "Claude", color: "#d97757" }, () => false);
    const region = new LiveRegion(peer, note.content.length, note.content.length);
    region.set("\nFirst");
    await region.flush();
    region.set("\nFirst part");
    await region.flush();
    expect(note.content).toBe("# Chat\n\nFirst part");
  });
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function turn(note: SharedNote, peer: AgentPeer, message: string, events: AgentEvent[]) {
  const content = note.content;
  const separator = content.endsWith("\n\n") || !content ? "" : content.endsWith("\n") ? "\n" : "\n\n";
  note.applyOps([{ from: content.length, to: content.length, insert: `${separator}${userBlock(message)}\n\n\n` }], LOCAL_ORIGIN);
  const at = note.content.length - 1;
  const region = new LiveRegion(peer, at, at);
  const transcript = new TurnTranscript();
  for (const event of events) {
    transcript.apply(event);
    const text = renderTurn(transcript);
    region.set(text ? `${text}\n` : "");
    await sleep(5);
  }
  await region.settled();
  region.close();
}

const stream = (text: string): AgentEvent[] => [...text.match(/.{1,7}/gs)!.map((part) => ({ type: "text-delta" as const, text: part })), { type: "message", text }];

describe("conversation turns in a shared note", () => {
  it.each([false, true])("writes consecutive turns in order (typing: %s)", async (typing) => {
    const note = new SharedNote({ path: "Chat.md" } as TFile, "---\ntype: conversation\n---\n", "---\ntype: conversation\n---\n", { read: async () => "", author: () => undefined });
    notes.push(note);
    if (typing) note.views.add({ visible: true });
    const peer = new AgentPeer(note, { name: "Claude", color: "#d97757" }, () => typing);
    const first = "The Meetings folder has one file.";
    await turn(note, peer, "What files?", [
      { type: "tool-start", id: "1", tool: "Bash", title: "Bash ls", detail: "ls" },
      { type: "tool-end", id: "1", ok: true, output: "a.md" },
      ...stream(first),
      { type: "turn-end", result: { status: "completed", text: first } },
    ]);
    const second = "Summary:\n\n- One\n- Two";
    await turn(note, peer, "Summarize it.", [
      { type: "thinking-delta", text: "" },
      { type: "tool-start", id: "2", tool: "Read", title: "Read Meetings/S.md", paths: ["Meetings/S.md"] },
      { type: "tool-end", id: "2", ok: true },
      { type: "thinking-delta", text: "" },
      ...stream(second),
      { type: "turn-end", result: { status: "completed", text: second } },
    ]);
    expect(note.content).toBe(
      [
        "---\ntype: conversation\n---\n",
        "> [!user]\n> What files?\n",
        "> [!activity]- Ran a command\n> - `Bash ls`\n>   ```\n>   a.md\n>   ```\n",
        `${first}\n`,
        "> [!user]\n> Summarize it.\n",
        "> [!activity]- Thought · Read a file\n> - Read [[Meetings/S]]\n",
        `${second}\n\n`,
      ].join("\n"),
    );
  });
});
