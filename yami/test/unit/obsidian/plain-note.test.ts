import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({}));

import type { TFile } from "obsidian";
import { PlainConversationNote, replaceReply } from "../../../src/obsidian/conversation/note.js";

beforeAll(() => {
  Object.assign(globalThis, { window: globalThis });
});

describe("replaceReply", () => {
  it("puts the reply before the last line break, and grows it there", () => {
    const first = replaceReply("> [!user]\n> Hi\n\n\n", "", "Hello.\n");
    expect(first).toBe("> [!user]\n> Hi\n\nHello.\n\n");
    expect(replaceReply(first, "Hello.\n", "Hello. More.\n")).toBe("> [!user]\n> Hi\n\nHello. More.\n\n");
  });

  it("finds the reply where it is after a person typed below it", () => {
    expect(replaceReply("Head\n\nHello.\n\nMy note\n", "Hello.\n", "Hello. More.\n")).toBe("Head\n\nHello. More.\n\nMy note\n");
  });

  it("adds the reply at the end when a person changed the reply itself, so none is lost", () => {
    expect(replaceReply("Head\n\nHullo.\n\n", "Hello.\n", "Hello. More.\n")).toBe("Head\n\nHullo.\n\nHello. More.\n\n");
  });

  it("removes a reply that became empty", () => {
    expect(replaceReply("Head\n\nHello.\n\n", "Hello.\n", "")).toBe("Head\n\n\n");
  });
});

describe("PlainConversationNote", () => {
  const file = { path: "conversations/Chat.md" } as TFile;
  let text: string;
  let writes: number;
  let note: PlainConversationNote;

  beforeEach(() => {
    vi.useFakeTimers();
    text = "---\ntype: conversation\n---\n";
    writes = 0;
    const app = {
      vault: {
        read: async () => text,
        process: async (_file: TFile, change: (data: string) => string) => {
          // A write takes a moment, as a file does.
          await Promise.resolve();
          text = change(text);
          writes++;
          return text;
        },
      },
      fileManager: {
        processFrontMatter: async (_file: TFile, change: (properties: Record<string, unknown>) => void) => {
          const properties: Record<string, unknown> = { type: "conversation" };
          change(properties);
          text = text.replace(/^---\n[\s\S]*?\n---\n/, `---\n${Object.entries(properties).map(([key, value]) => `${key}: ${value}`).join("\n")}\n---\n`);
        },
      },
    };
    note = new PlainConversationNote(app as never, file);
  });

  afterEach(() => vi.useRealTimers());

  it("appends after a blank line, and reads the text after the writes before it", async () => {
    note.append("> [!user]\n> Hi\n\n\n");
    expect(await note.text()).toBe("---\ntype: conversation\n---\n\n> [!user]\n> Hi\n\n\n");
  });

  it("writes a growing reply a few times a second, and all of it when the turn settles", async () => {
    note.append("> [!user]\n> Hi\n\n\n");
    const output = note.beginTurn();
    for (const part of ["One", "One two", "One two three"]) output.set(`${part}\n`);
    await vi.advanceTimersByTimeAsync(300);
    expect(writes).toBe(2);
    expect(text).toMatch(/> Hi\n\nOne two three\n\n$/);
    output.set("One two three four\n");
    await output.settled();
    output.close();
    expect(writes).toBe(3);
    expect(text).toMatch(/> Hi\n\nOne two three four\n\n$/);
  });

  it("keeps a property change and the reply in the order they came", async () => {
    note.append("> [!user]\n> Hi\n\n\n");
    const output = note.beginTurn();
    output.set("Reply\n");
    const set = note.setProperty("session", "abc");
    await output.settled();
    await set;
    expect(text).toBe("---\ntype: conversation\nsession: abc\n---\n\n> [!user]\n> Hi\n\nReply\n\n");
  });

  it("goes on after a write that failed", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const app = { vault: { read: async () => text, process: vi.fn().mockRejectedValueOnce(new Error("gone")).mockImplementation(async (_f: TFile, change: (data: string) => string) => (text = change(text))) } };
    note = new PlainConversationNote(app as never, file);
    note.append("lost\n");
    note.append("kept\n");
    expect(await note.text()).toBe("---\ntype: conversation\n---\n\nkept\n");
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});
