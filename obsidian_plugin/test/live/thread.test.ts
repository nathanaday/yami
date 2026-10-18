/**
 * One thread, from stub to closed, with a real Claude Code: the threads skills, tools, reviewer and
 * validator agents through `yami_agent`, and the loop, on a scratch repository outside the vault. It takes some minutes and
 * costs a real run, so it runs only on request:
 *
 *   YAMI_LIVE_THREAD=1 npm run test:live
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Yami } from "yami";
import { ClaudeAgent } from "yami/agent/claude";
import { FileConversations } from "yami/conversation";
import { readDocument } from "yami/document";
import { FsVault } from "yami/testing";
import { Threads } from "../../src/modules/threads/index.js";
import { stub } from "../../src/modules/threads/ops.js";
import { parse, phase } from "../../src/modules/threads/thread.js";

describe.runIf(process.env.YAMI_LIVE_THREAD)("a thread with a real agent", () => {
  it("goes from stub to closed: spec, review, plan, commits, a fresh validator, close", { timeout: 1_800_000 }, async () => {
    const root = mkdtempSync(path.join(tmpdir(), "yami-thread-"));
    const repo = path.join(root, "calc");
    mkdirSync(repo);
    writeFileSync(path.join(repo, "calc.js"), "export function add(a, b) {\n  return a + b;\n}\n");
    writeFileSync(path.join(repo, "calc.test.js"), 'import { test } from "node:test";\nimport assert from "node:assert";\nimport { add } from "./calc.js";\n\ntest("add", () => assert.equal(add(2, 3), 5));\n');
    writeFileSync(path.join(repo, "package.json"), '{ "type": "module", "scripts": { "test": "node --test" } }\n');
    writeFileSync(path.join(repo, "CLAUDE.md"), "Run the tests with `npm test`. Keep each function small.\n");
    const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
    git("init", "-q");
    git("-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-q", "--allow-empty", "-m", "start");
    git("add", ".");
    git("-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-q", "-m", "add");

    const vault = new FsVault(path.join(root, "vault"));
    mkdirSync(vault.root);
    const threads = new Threads();
    const agent = new ClaudeAgent({ preferences: { effort: "low" } });
    // This test is the user: it allows each request, such as a commit in the scratch repository.
    const yami = new Yami({ vault, agents: [agent], modules: [threads], conversations: new FileConversations(vault, async () => "allow") });
    await yami.enable();
    await stub(vault, threads.thread, {
      title: "Divide",
      idea: "calc needs a divide(a, b) function that throws an error when b is zero.",
      description: "Add divide to calc.js, with tests.",
      context: `The repository is ${repo}. calc.js holds add; calc.test.js tests it with node --test (npm test).`,
      repositories: [repo],
    });

    const result = await yami.session("threads/Divide.md").start({ maxIterations: 4 });
    await yami.close();

    const t = parse(await readDocument(vault, "threads/Divide.md"));
    console.log(`state ${result.state} after ${result.iterations} iteration(s); phase ${phase(t)}; ${t.requirements.length} requirements, ${t.plan.length} tasks, ${t.rounds.length} rounds`);
    expect(result.state).toBe("done");
    expect(phase(t)).toBe("closed");
    expect(t.requirements.length).toBeGreaterThan(0);
    expect(t.plan.every((task) => task.state !== "open")).toBe(true);
    expect(t.rounds.at(-1)!.verdict).toBe("pass");
    expect(git("log", "--oneline").split("\n").length).toBeGreaterThan(2);
    expect(execFileSync("npm", ["test"], { cwd: repo, encoding: "utf8" })).toContain("pass");
    // The work was validated by the read-only agent of the module, through the agent tool, in a conversation of its own.
    const notes = await vault.list("conversations");
    const validations = notes.filter((note) => path.basename(note).startsWith("threads validator"));
    expect(validations.length).toBeGreaterThan(0);
    for (const note of validations) expect((await readDocument(vault, note)).properties).toMatchObject({ type: "conversation", module: "[[threads/Divide|Divide]]" });
  });
});
