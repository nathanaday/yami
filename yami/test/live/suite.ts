import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Agent, AgentEvent, AgentSession, PermissionDecision, PermissionRequest, SessionStart } from "../../src/agent/index.js";

const TIMEOUT = 180_000;

/**
 * Runs the same scenarios against a real harness. `writeRequest` must make the agent ask for approval.
 * `editRequest` must make the agent create note.txt with its file-editing tool, not a shell command.
 */
export function liveSuite(makeAgent: (cwd: string) => Agent, writeRequest: string, editRequest = writeRequest) {
  const harness = makeAgent(process.cwd()).harness;
  describe(`${harness} (live)`, () => {
    const sessions: AgentSession[] = [];
    afterEach(async () => {
      await Promise.all(sessions.splice(0).map((session) => session.close()));
    });

    async function start(decision: PermissionDecision = "allow", resume?: string, options: SessionStart<never> = {}) {
      const cwd = mkdtempSync(path.join(tmpdir(), `yami-${harness}-`));
      const requests: PermissionRequest[] = [];
      const events: AgentEvent[] = [];
      const session = await makeAgent(cwd).startSession({
        resume,
        onPermission: async (request) => {
          requests.push(request);
          return decision;
        },
        ...options,
      });
      sessions.push(session);
      session.on((event) => events.push(event));
      return { session, cwd, requests, events };
    }

    it("connects and reports the account", { timeout: TIMEOUT }, async () => {
      const info = await makeAgent(process.cwd()).connect();
      expect(info.harness).toBe(harness);
      expect(info.version).toMatch(/\d+\.\d+/);
      expect(info.account.login).toBeTruthy();
    });

    it("streams a reply", { timeout: TIMEOUT }, async () => {
      const { session, events } = await start();
      const result = await session.send("Reply with exactly the word: pineapple");
      expect(result.status).toBe("completed");
      expect(result.text.toLowerCase()).toContain("pineapple");
      const streamed = events.filter((event) => event.type === "text-delta").map((event) => event.text);
      expect(streamed.join("").toLowerCase()).toContain("pineapple");
      expect(result.usage?.inputTokens).toBeGreaterThan(0);
    });

    it("asks before writing and writes when allowed", { timeout: TIMEOUT }, async () => {
      const { session, cwd, requests } = await start("allow");
      const result = await session.send(writeRequest);
      expect(result.status).toBe("completed");
      expect(requests.length).toBeGreaterThan(0);
      expect(readFileSync(path.join(cwd, "note.txt"), "utf8").trim()).toBe("hello");
    });

    it("calls beforeFileChange before the file changes", { timeout: TIMEOUT }, async () => {
      const calls: { paths: string[]; existed: boolean }[] = [];
      let cwd = "";
      const started = await start("allow", undefined, {
        beforeFileChange: (paths) => {
          calls.push({ paths, existed: existsSync(path.join(cwd, "note.txt")) });
        },
      });
      cwd = started.cwd;
      const result = await started.session.send(editRequest);
      expect(result.status).toBe("completed");
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0]).toEqual({ paths: ["note.txt"], existed: false });
    });

    it("does not write when denied", { timeout: TIMEOUT }, async () => {
      const { session, cwd, requests } = await start("deny");
      const result = await session.send(`${writeRequest} If you are not allowed, stop and say so.`);
      expect(result.status).toBe("completed");
      expect(requests.length).toBeGreaterThan(0);
      expect(existsSync(path.join(cwd, "note.txt"))).toBe(false);
    });

    it("interrupts a turn and continues the session", { timeout: TIMEOUT }, async () => {
      const { session, events } = await start();
      const firstDelta = new Promise<void>((resolve) => session.on((event) => event.type === "text-delta" && resolve()));
      const turn = session.send("Count from 1 to 300, one number per line, with no other text.");
      await firstDelta;
      await session.interrupt();
      const result = await turn;
      expect(result.status).toBe("interrupted");
      expect(events.filter((event) => event.type === "turn-end")).toHaveLength(1);
      const next = await session.send("Reply with exactly the word: done");
      expect(next.status).toBe("completed");
      expect(next.text.toLowerCase()).toContain("done");
    });

    it("interrupts a turn right after send", { timeout: TIMEOUT }, async () => {
      const { session } = await start();
      const started = Date.now();
      const turn = session.send("Count from 1 to 300, one number per line, with no other text.");
      await session.interrupt();
      expect((await turn).status).toBe("interrupted");
      expect(Date.now() - started).toBeLessThan(15000);
      expect((await session.send("Reply with exactly the word: done")).status).toBe("completed");
    });

    it("stops a running command on interrupt", { timeout: TIMEOUT }, async () => {
      const { session, events } = await start("allow");
      const toolStarted = new Promise<void>((resolve) => session.on((event) => event.type === "tool-start" && resolve()));
      const turn = session.send("Run exactly this shell command and nothing else: sleep 45");
      await toolStarted;
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await session.interrupt();
      expect((await turn).status).toBe("interrupted");
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const { execSync } = await import("node:child_process");
      expect(execSync("pgrep -fl '^sleep 45$' || true").toString().trim()).toBe("");
      expect(events.filter((event) => event.type === "closed")).toHaveLength(0);
    });

    it("runs messages sent during a turn in order", { timeout: TIMEOUT }, async () => {
      const { session } = await start();
      const [first, second] = await Promise.all([
        session.send("Reply with exactly the word: alpha"),
        session.send("Reply with exactly the word: bravo"),
      ]);
      expect(first?.text.toLowerCase()).toContain("alpha");
      expect(second?.text.toLowerCase()).toContain("bravo");
    });

    it("follows instructions", { timeout: TIMEOUT }, async () => {
      const cwd = mkdtempSync(path.join(tmpdir(), `yami-${harness}-`));
      const session = await makeAgent(cwd).startSession({ instructions: "End every reply with the exact text [[yami]]." });
      sessions.push(session);
      const result = await session.send("Say hello in two words.");
      expect(result.text).toContain("[[yami]]");
    });

    it("resumes a session by id", { timeout: TIMEOUT }, async () => {
      const first = await start();
      await first.session.send('Remember the code word "zebra-42". Reply with exactly: OK');
      await first.session.close();
      const second = await start("allow", first.session.id);
      expect(second.session.id).toBe(first.session.id);
      const result = await second.session.send("What was the code word? Reply with only the code word.");
      expect(result.text).toContain("zebra-42");
    });
  });
}
