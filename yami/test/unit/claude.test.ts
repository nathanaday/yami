import { chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { afterEach, describe, expect, it } from "vitest";
import { startClaudeSession } from "../../src/agent/claude.js";
import { type AgentEvent, type AgentSession, defineTool } from "../../src/agent/index.js";

const FAKE = fileURLToPath(new URL("../fixtures/fake-claude.mjs", import.meta.url));
chmodSync(FAKE, 0o755);

let session: AgentSession | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
});

const tools = {
  name: "note",
  description: "Edit the note.",
  tools: [
    defineTool({
      name: "append",
      description: "Appends text.",
      input: { lines: z.array(z.string()) },
      title: ({ lines }) => `Append ${lines.length} line(s)`,
      run: async ({ lines }) => `appended ${lines.length}`,
    }),
  ],
};

async function start() {
  const events: AgentEvent[] = [];
  session = await startClaudeSession({ cwd: process.cwd(), clientName: "test", executablePath: FAKE, settingSources: [], tools });
  session.on((event) => events.push(event));
  return { session, events };
}

describe("claude adapter", () => {
  it("streams a reply and resolves the turn", async () => {
    const { session } = await start();
    expect(await session.send("hi")).toMatchObject({ status: "completed", text: "echo: hi" });
  });

  it("titles an app tool call from its input", async () => {
    const { session, events } = await start();
    await session.send(`tool mcp__note__append {"lines":["a","b"]}`);
    expect(events).toContainEqual(expect.objectContaining({ type: "tool-start", tool: "mcp__note__append", title: "Append 2 line(s)" }));
  });

  it("survives an app tool call whose input the schema refuses, and titles it by the tool's name", async () => {
    const { session, events } = await start();
    const result = await session.send(`tool mcp__note__append {}`);
    expect(result).toMatchObject({ status: "completed" });
    expect(events).toContainEqual(expect.objectContaining({ type: "tool-start", tool: "mcp__note__append", title: "append" }));
    expect(session.closed).toBe(false);
    expect(await session.send("again")).toMatchObject({ status: "completed", text: "echo: again" });
  });

  it("fails the turn and closes when it cannot read a message, and the error says that Yami failed, and where", async () => {
    const { session, events } = await start();
    const result = await session.send("bad-result");
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/^Yami could not read a message of Claude Code: TypeError: .+ \(at ClaudeSession\.finishTurn \(claude\.ts:\d+:\d+\)\)$/);
    expect(session.closed).toBe(true);
    expect(events).toContainEqual({ type: "closed", error: result.error });
  });
});
