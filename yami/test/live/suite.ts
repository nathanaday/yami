import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Agent, AgentEvent, AgentSession, PermissionDecision, PermissionRequest, SessionStart } from "../../src/agent/index.js";
import { Yami, YamiModule } from "../../src/index.js";
import { FsVault } from "../../src/testing/index.js";

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

    /** A vault with one skill set, hello, whose greeting skill answers with a word no model would guess. */
    function skillVault() {
      const cwd = mkdtempSync(path.join(tmpdir(), `yami-${harness}-skills-`));
      const root = path.join(cwd, "internal", "hello");
      mkdirSync(path.join(root, "skills", "greeting"), { recursive: true });
      writeFileSync(
        path.join(root, "skills", "greeting", "SKILL.md"),
        "---\nname: greeting\ndescription: How to greet a person by name.\n---\n# Greeting\n\nReply with exactly one line: the word Salutations, a comma, the name you were given, and then the word PINEAPPLE. No other words.\n",
      );
      return { cwd, root };
    }

    async function startWithSkills(options: SessionStart<never> = {}) {
      const { cwd, root } = skillVault();
      const session = await makeAgent(cwd).startSession({ skills: [root], ...options });
      sessions.push(session);
      return session;
    }

    it("lists a skill set's skill as <set>:<skill> and invokes it with a slash", { timeout: TIMEOUT }, async () => {
      const session = await startWithSkills();
      expect((await session.commands()).map((command) => command.name)).toContain("hello:greeting");
      const result = await session.send("/hello:greeting Ada");
      expect(result.status).toBe("completed");
      expect(result.text).toContain("PINEAPPLE");
      expect(result.text).toContain("Ada");
    });

    it("passes a long, multi-line message after the command to the skill", { timeout: TIMEOUT }, async () => {
      const session = await startWithSkills();
      const result = await session.send("/hello:greeting You are running a session.\n\n## Session\n\nThe person to greet is Grace.\n\n## Notes\n\nNothing else.");
      expect(result.text).toContain("PINEAPPLE");
      expect(result.text).toContain("Grace");
    });

    it("uses a skill of a skill set when the message only asks for it", { timeout: TIMEOUT }, async () => {
      // No approval handler: Codex reads a skill it chose with a command, and the adapter allows that read itself.
      const session = await startWithSkills();
      const result = await session.send("Greet Linus, using your greeting skill from the hello skill set.");
      expect(result.text).toContain("PINEAPPLE");
    });

    it("invokes a skill in a read-only session", { timeout: TIMEOUT }, async () => {
      const session = await startWithSkills({ access: "read-only" });
      const result = await session.send("/hello:greeting Ada");
      expect(result.text).toContain("PINEAPPLE");
    });

    it("runs a read-only session's commands that only read or check, and writes nothing with a command or an edit tool", { timeout: TIMEOUT }, async () => {
      const cwd = mkdtempSync(path.join(tmpdir(), `yami-${harness}-read-only-`));
      writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ name: "probe", private: true, scripts: { test: "node --test" } }));
      writeFileSync(path.join(cwd, "sum.test.mjs"), 'import test from "node:test";\nimport assert from "node:assert";\ntest("sums", () => assert.equal(1 + 1, 2));\n');
      execSync('git init -q && git add . && git -c user.name=yami -c user.email=yami@example.com commit -qm "Add the sum test"', { cwd });
      const requests: PermissionRequest[] = [];
      const session = await makeAgent(cwd).startSession({ access: "read-only", onPermission: async (request) => (requests.push(request), "allow") });
      sessions.push(session);
      const outputs: string[] = [];
      session.on((event) => event.type === "tool-end" && outputs.push(event.output ?? ""));
      const result = await session.send(
        "Run these shell commands, one call each, exactly as written: `git log --oneline`, then `npm test`, then `printf x > written.txt`. Then create the file edited.txt with the text hello, with your file-editing tool. Report what each step gave.",
      );
      expect(result.status).toBe("completed");
      expect(outputs.join("\n")).toContain("Add the sum test");
      expect(outputs.join("\n")).toMatch(/pass 1/);
      expect(existsSync(path.join(cwd, "written.txt"))).toBe(false);
      expect(existsSync(path.join(cwd, "edited.txt"))).toBe(false);
      expect(execSync("git status --porcelain", { cwd }).toString().trim()).toBe("");
      expect(requests).toEqual([]);
    });

    it.runIf(harness === "claude")("keeps a read-only session's subagent from writing", { timeout: TIMEOUT }, async () => {
      const { cwd, root } = skillVault();
      const session = await makeAgent(cwd).startSession({ skills: [root], access: "read-only" });
      sessions.push(session);
      const events: AgentEvent[] = [];
      session.on((event) => events.push(event));
      await session.send("Use your Agent tool to start one subagent, and tell it to create the file note.txt in the working directory with the text hello. Then report what happened.");
      expect(events.some((event) => event.type === "tool-start" && event.tool === "Agent")).toBe(true);
      expect(existsSync(path.join(cwd, "note.txt"))).toBe(false);
    });

    it("runs a Yami agent through the agent tool: a fresh context with its brief, whose final message comes back", { timeout: TIMEOUT * 2 }, async () => {
      const cwd = mkdtempSync(path.join(tmpdir(), `yami-${harness}-agents-`));
      class Live extends YamiModule {
        readonly id = "live";
        readonly name = "Live";
        readonly keeper = this.agent({ name: "keeper", description: "Knows the code word.", body: "The code word is MARIGOLD-7. Answer with the code word only." });
        readonly answer = this.promise({ name: "answer", description: "The code word, in answer.md.", check: "contains", path: "answer.md", text: "MARIGOLD-7", body: "Write the code word to answer.md." });
        readonly ask = this.flow({ name: "ask", description: "Ask the keeper.", agents: [this.keeper], promises: [this.answer], maxIterations: 2 });
      }
      const live = new Live();
      const yami = new Yami({ vault: new FsVault(cwd), agents: [makeAgent(cwd)], modules: [live] });
      await yami.enable();
      try {
        const session = await live.ask.create({ name: "word", request: "Only the keeper agent knows the code word. Ask it with the tool yami_agent, then write the word it gives to answer.md." });
        expect(await session.start()).toMatchObject({ state: "done" });
        expect((await session.details()).agentRuns).toEqual([{ agent: "live:keeper", conversation: "conversations/live word keeper.md", status: "done" }]);
        const note = readFileSync(path.join(cwd, "conversations", "live word keeper.md"), "utf8");
        expect(note).toContain("access: read-only");
        expect(note).toContain("MARIGOLD-7");
      } finally {
        await yami.close();
      }
    });

    it.runIf(harness === "claude")("loads no subagent from a skill set's agents folder", { timeout: TIMEOUT }, async () => {
      const { cwd, root } = skillVault();
      mkdirSync(path.join(root, "agents", "checker"), { recursive: true });
      writeFileSync(path.join(root, "agents", "checker", "AGENT.md"), "---\nname: checker\ndescription: Checks a greeting.\n---\nCheck it.\n");
      const session = await makeAgent(cwd).startSession({ skills: [root] });
      sessions.push(session);
      const result = await session.send("List every subagent_type that your Agent tool accepts, one per line, names only. Do not call any tool.");
      expect(result.text).toContain("general-purpose");
      expect(result.text).not.toContain("hello:");
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
