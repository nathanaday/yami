import { describe, expect, it } from "vitest";
import { availablePath, frontmatterEdit, isUnnamed, nameFrom, newConversation, noteName, renderTurn, summary, titleFrom, unnamed, userBlock } from "../../src/conversation/format.js";
import { TurnTranscript } from "../../src/conversation/transcript.js";

/** Applies ascending, non-overlapping ops to a text. */
function applyOps(text: string, ops: { from: number; to: number; insert: string }[]): string {
  let result = "";
  let position = 0;
  for (const op of ops) {
    result += text.slice(position, op.from) + op.insert;
    position = op.to;
  }
  return result + text.slice(position);
}

describe("conversation notes", () => {
  const note = newConversation({ agent: "claude", model: "opus", status: "active", created: "2026-10-05 14:02" });

  it("creates frontmatter that marks the note and styles it", () => {
    expect(note).toBe("---\ntype: conversation\nagent: claude\nmodel: opus\nstatus: active\ncreated: 2026-10-05 14:02\ncssclasses:\n  - yami-conversation\n---\n");
  });

  it("links the module session that the conversation runs", () => {
    expect(newConversation({ agent: "claude", status: "active", created: "now", module: "[[hello/cheerful|cheerful]]" })).toContain('\nmodule: "[[hello/cheerful|cheerful]]"\n');
  });

  it("changes, adds and removes frontmatter properties", () => {
    const set = (text: string, key: string, value?: string) => {
      const edit = frontmatterEdit(text, key, value);
      return edit ? applyOps(text, [edit]) : text;
    };
    expect(set(note, "status", "ended")).toContain("\nstatus: ended\n");
    expect(set(note, "session", "abc")).toContain("  - yami-conversation\nsession: abc\n---\n");
    expect(set(note, "model")).not.toContain("model:");
    expect(frontmatterEdit("no frontmatter", "a", "b")).toBeUndefined();
  });

  it("quotes user messages", () => {
    expect(userBlock("Hello\n\nSee [[Ideas]]")).toBe("> [!user]\n> Hello\n>\n> See [[Ideas]]");
  });

  it("names the note after the first message", () => {
    expect(titleFrom("Summarize [[Meetings/Standup|the standup]] and draft: follow-ups for the team please")).toBe("Summarize Meetings Standup and draft follow-ups for");
    expect(titleFrom("Reply with the word one.")).toBe("Reply with the word one");
    const date = new Date(2026, 9, 5, 14, 2);
    expect(nameFrom("Plan the week", date)).toBe("2026-10-05 Plan the week");
    expect(unnamed(date)).toBe("New conversation 2026-10-05 1402");
    expect(isUnnamed("New conversation 2026-10-05 1402 2")).toBe(true);
    expect(isUnnamed("2026-10-05 Plan the week")).toBe(false);
  });

  it("makes a given title safe as a note name", () => {
    expect(noteName(" Ingest: notes/today [draft] ")).toBe("Ingest notes today draft");
    expect(noteName(".hidden")).toBe("hidden");
    expect(noteName("///")).toBe("");
  });

  it("numbers a name that a file already has", () => {
    const taken = new Set(["Chats/Plan.md", "Chats/Plan 2.md"]);
    expect(availablePath("Chats/", "Plan", (path) => taken.has(path))).toBe("Chats/Plan 3.md");
    expect(availablePath("/", "Plan", (path) => taken.has(path))).toBe("Plan.md");
  });
});

describe("agent turns", () => {
  function run(events: Parameters<TurnTranscript["apply"]>[0][]) {
    const turn = new TurnTranscript();
    let now = 0;
    for (const event of events) turn.apply(event, (now += 1000));
    return turn;
  }

  it("groups thinking and tools in a collapsed callout before the text", () => {
    const turn = run([
      { type: "thinking-delta", text: "Plan it" },
      { type: "thinking-delta", text: " out." },
      { type: "tool-start", id: "1", tool: "Read", title: "Read Ideas.md", paths: ["Ideas.md"] },
      { type: "tool-end", id: "1", ok: true },
      { type: "tool-start", id: "2", tool: "Bash", title: "Bash ls", detail: "ls" },
      { type: "tool-end", id: "2", ok: true, output: "a.md\nb.md" },
      { type: "text-delta", text: "Here are " },
      { type: "text-delta", text: "the files." },
      { type: "message", text: "Here are the files." },
      { type: "turn-end", result: { status: "completed", text: "Here are the files." } },
    ]);
    expect(renderTurn(turn)).toBe(
      [
        "> [!activity]- Thought for 1s · Read a file · Ran a command",
        "> - **Thinking**",
        ">   Plan it out.",
        "> - Read [[Ideas]]",
        "> - `Bash ls`",
        ">   ```",
        ">   a.md",
        ">   b.md",
        ">   ```",
        "",
        "Here are the files.",
      ].join("\n"),
    );
  });

  it("only appends while the reply text streams", () => {
    const turn = new TurnTranscript();
    turn.apply({ type: "tool-start", id: "1", tool: "Read", title: "Read Ideas.md", paths: ["Ideas.md"] });
    turn.apply({ type: "tool-end", id: "1", ok: true });
    turn.apply({ type: "text-delta", text: "One" });
    const before = renderTurn(turn);
    turn.apply({ type: "text-delta", text: " two" });
    expect(renderTurn(turn).startsWith(before)).toBe(true);
  });

  it("shows the running step in the title, then a summary", () => {
    const turn = new TurnTranscript();
    turn.apply({ type: "tool-start", id: "1", tool: "Grep", title: "Grep todo" });
    expect(renderTurn(turn).split("\n")[0]).toBe("> [!activity]- Grep todo…");
    turn.apply({ type: "turn-end", result: { status: "interrupted", text: "" } });
    expect(renderTurn(turn)).toBe("> [!activity]- Searched files\n> - `Grep todo`\n\n*Stopped.*");
  });

  it("records the agent's questions with the user's answers", () => {
    const turn = run([
      { type: "tool-start", id: "1", tool: "AskUserQuestion", title: "Asked you questions", detail: "Which fruit?" },
      { type: "tool-end", id: "1", ok: true, output: "Which fruit? → Pear" },
      { type: "turn-end", result: { status: "completed", text: "" } },
    ]);
    expect(renderTurn(turn)).toBe("> [!activity]- Asked you questions\n> - Asked you questions\n>   - Which fruit? → Pear");
  });

  it("reports a failed turn", () => {
    const turn = run([{ type: "turn-end", result: { status: "failed", text: "", error: "Overloaded\nretry later" } }]);
    expect(renderTurn(turn)).toBe("> [!failure] The agent stopped with an error\n> Overloaded");
  });

  it("summarizes steps", () => {
    expect(summary([{ kind: "tool", id: "1", tool: "Edit", title: "Edit a.md", running: false }, { kind: "tool", id: "2", tool: "Edit", title: "Edit b.md", running: false }])).toBe("Edited 2 files");
  });
});
