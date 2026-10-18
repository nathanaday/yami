import { chmodSync, existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { afterEach, describe, expect, it } from "vitest";
import { startCodexSession, unwrapShell } from "../../src/agent/codex.js";
import { isSkillRead } from "../../src/agent/skills.js";
import { type AgentEvent, type AgentSession, defineTool, type PermissionDecision, type PermissionRequest } from "../../src/agent/index.js";

const FAKE = fileURLToPath(new URL("../fixtures/fake-codex.mjs", import.meta.url));
chmodSync(FAKE, 0o755);

let session: AgentSession | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
});

async function start(decision: PermissionDecision = "allow", resume?: string, skills?: string[]) {
  const requests: PermissionRequest[] = [];
  const events: AgentEvent[] = [];
  session = await startCodexSession({
    cwd: process.cwd(),
    clientName: "test",
    executablePath: FAKE,
    resume,
    skills,
    onPermission: async (request) => {
      requests.push(request);
      return decision;
    },
  });
  session.on((event) => events.push(event));
  return { session, requests, events };
}

describe("codex adapter", () => {
  it("streams a reply and resolves the turn", async () => {
    const { session, events } = await start();
    expect(session.id).toBe("thread-1");
    const result = await session.send("hello");
    expect(result).toMatchObject({ status: "completed", text: "Hello there" });
    expect(result.usage?.durationMs).toBeGreaterThanOrEqual(0);
    const deltas = events.filter((event) => event.type === "text-delta").map((event) => event.text);
    expect(deltas.join("")).toBe("Hello there");
    expect(events[0]).toEqual({ type: "turn-start", prompt: "hello" });
    expect(events.at(-1)).toEqual({ type: "turn-end", result });
  });

  it.each([
    ["allow", "accept"],
    ["allow-session", "acceptForSession"],
    ["deny", "decline"],
  ] as const)("maps %s to the command decision %s", async (decision, expected) => {
    const { session, requests, events } = await start(decision);
    const result = await session.send("command");
    expect(JSON.parse(result.text)).toEqual({ decision: expected });
    expect(requests[0]).toMatchObject({ tool: "command", kind: "command", title: "Run touch x" });
    expect(events).toContainEqual({ type: "tool-start", id: "cmd-1", tool: "commandExecution", title: "touch x", detail: "touch x" });
    expect(events).toContainEqual({ type: "tool-end", id: "cmd-1", ok: true, output: "done" });
  });

  it("shows file paths and diffs in a file change request", async () => {
    const { session, requests } = await start("allow");
    const result = await session.send("file");
    expect(JSON.parse(result.text)).toEqual({ decision: "accept" });
    expect(requests[0]).toMatchObject({ tool: "fileChange", kind: "edit", title: "Edit a.md", detail: "-old\n+new" });
  });

  it("calls beforeFileChange when a file change starts and again before it asks", async () => {
    const calls: string[] = [];
    session = await startCodexSession({
      cwd: process.cwd(),
      clientName: "test",
      executablePath: FAKE,
      beforeFileChange: async (paths) => {
        calls.push(`before ${paths.join(", ")}`);
      },
      onPermission: async (request) => {
        calls.push(`ask ${request.title}`);
        return "allow";
      },
    });
    await session.send("file");
    expect(calls).toEqual(["before a.md", "before a.md", "ask Edit a.md"]);
  });

  it("grants requested permissions only when allowed", async () => {
    const allowed = await start("allow-session");
    expect(JSON.parse((await allowed.session.send("permissions")).text)).toEqual({
      permissions: { network: { enabled: true } },
      scope: "session",
    });
    expect(allowed.requests[0]).toMatchObject({ kind: "network" });
    await allowed.session.close();
    const denied = await start("deny");
    expect(JSON.parse((await denied.session.send("permissions")).text)).toEqual({ permissions: {}, scope: "turn" });
  });

  it("passes instructions to the thread as developer instructions", async () => {
    session = await startCodexSession({ cwd: process.cwd(), clientName: "test", executablePath: FAKE, instructions: "Be brief." });
    expect((await session.send("instructions")).text).toBe("Be brief.");
  });

  it("denies requests when there is no permission handler", async () => {
    session = await startCodexSession({ cwd: process.cwd(), clientName: "test", executablePath: FAKE });
    expect(JSON.parse((await session.send("command")).text)).toEqual({ decision: "decline" });
  });

  it("answers unsupported server requests with an error", async () => {
    const { session } = await start();
    const error = JSON.parse((await session.send("unsupported")).text);
    expect(error.code).toBe(-32601);
  });

  it("reports a failed turn with the last error", async () => {
    const { session } = await start();
    expect(await session.send("fail")).toMatchObject({ status: "failed", text: "", error: "model overloaded" });
  });

  it("interrupts a running turn, restarts the server, and accepts the next message", async () => {
    const { session, events } = await start();
    const turn = session.send("wait");
    await new Promise((resolve) => setTimeout(resolve, 50));
    await session.interrupt();
    expect((await turn).status).toBe("interrupted");
    expect(session.closed).toBe(false);
    expect((await session.send("hello")).status).toBe("completed");
    expect(session.id).toBe("thread-1");
    expect(events.filter((event) => event.type === "closed")).toHaveLength(0);
  });

  it("interrupts a turn before turn/start returns", async () => {
    const { session } = await start();
    const turn = session.send("wait");
    await session.interrupt();
    expect((await turn).status).toBe("interrupted");
  });

  it("runs messages sent during a turn after it, in order", async () => {
    const { session } = await start();
    const results = await Promise.all([session.send("one"), session.send("two"), session.send("three")]);
    expect(results.map((result) => result.text)).toEqual(["echo: one", "echo: two", "echo: three"]);
  });

  it("removes a read-only session's scratch folder when the process crashes", async () => {
    session = await startCodexSession({ cwd: process.cwd(), clientName: "test", executablePath: FAKE, access: "read-only" });
    const { args } = JSON.parse((await session.send("setup")).text) as { args: string[] };
    const scratch = /"(\/tmp\/yami-read-only-[^"]+)"="write"/.exec(args.join("\n"))![1]!;
    expect((await session.send("crash")).status).toBe("failed");
    expect(existsSync(scratch)).toBe(false);
  });

  it("fails the turn and closes the session when the process crashes", async () => {
    const { session, events } = await start();
    const result = await session.send("crash");
    expect(result.status).toBe("failed");
    expect(result.error).toContain("exited with code 3");
    expect(result.error).toContain("fatal: something broke");
    expect(session.closed).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "turn-end" });
    expect(events).toContainEqual(expect.objectContaining({ type: "closed" }));
    await expect(session.send("hello")).rejects.toThrow("Session closed");
  });

  it("resumes a thread by id", async () => {
    const { session } = await start("allow", "thread-1");
    expect(session.id).toBe("thread-1");
  });

  it("rejects when the thread to resume does not exist", async () => {
    await expect(start("allow", "missing")).rejects.toThrow("no rollout found");
  });

  it("rejects when the executable does not exist", async () => {
    await expect(startCodexSession({ cwd: process.cwd(), clientName: "test", executablePath: "/nonexistent/codex" })).rejects.toThrow("ENOENT");
  });

  it("shows the inner command of a shell wrapper", () => {
    expect(unwrapShell(`/bin/zsh -lc 'ls -a'`)).toBe("ls -a");
    expect(unwrapShell(`/bin/bash -c "pwd && git status"`)).toBe("pwd && git status");
    expect(unwrapShell("ls -a")).toBe("ls -a");
  });

  it("runs app tools that the agent calls", async () => {
    const calls: unknown[] = [];
    const tools = {
      name: "note",
      description: "Edit the note.",
      tools: [
        defineTool({
          name: "append",
          description: "Appends text.",
          input: { text: z.string() },
          title: (input) => `Append ${input.text}`,
          run: async (input) => {
            calls.push(input);
            return `appended ${input.text}`;
          },
        }),
      ],
    };
    const events: AgentEvent[] = [];
    session = await startCodexSession({ cwd: process.cwd(), clientName: "test", executablePath: FAKE, tools });
    session.on((event) => events.push(event));
    const result = await session.send("tool");
    expect(calls).toEqual([{ text: "hi" }]);
    expect(JSON.parse(result.text)).toEqual({ contentItems: [{ type: "inputText", text: "appended hi" }], success: true });
    expect(events).toContainEqual(expect.objectContaining({ type: "tool-start", tool: "note.append", title: "Append hi" }));
    const setup = JSON.parse((await session.send("setup")).text);
    expect(setup.capabilities).toEqual({ experimentalApi: true, requestAttestation: false });
    expect(setup.dynamicTools[0]).toMatchObject({ type: "namespace", name: "note", tools: [{ name: "append" }] });
    expect(setup.dynamicTools[0].tools[0].inputSchema.properties.text).toEqual({ type: "string" });
  });

  it("titles an app tool call whose input the schema refuses by the tool's name", async () => {
    const tools = {
      name: "note",
      description: "Edit the note.",
      tools: [
        defineTool({
          name: "append",
          description: "Appends lines.",
          input: { lines: z.array(z.string()) },
          title: ({ lines }) => `Append ${lines.length} line(s)`,
          run: async ({ lines }) => `appended ${lines.length}`,
        }),
      ],
    };
    const events: AgentEvent[] = [];
    session = await startCodexSession({ cwd: process.cwd(), clientName: "test", executablePath: FAKE, tools });
    session.on((event) => events.push(event));
    const result = await session.send("tool-no-input");
    expect(result.status).toBe("completed");
    expect(JSON.parse(result.text)).toMatchObject({ success: false });
    expect(events).toContainEqual(expect.objectContaining({ type: "tool-start", tool: "note.append", title: "append" }));
  });

  it("reports an error result when an app tool throws", async () => {
    const tools = {
      name: "note",
      description: "Edit the note.",
      tools: [
        defineTool({
          name: "append",
          description: "",
          input: { text: z.string() },
          run: async () => {
            throw new Error("no note");
          },
        }),
      ],
    };
    session = await startCodexSession({ cwd: process.cwd(), clientName: "test", executablePath: FAKE, tools });
    expect(JSON.parse((await session.send("tool")).text)).toEqual({ contentItems: [{ type: "inputText", text: "no note" }], success: false });
  });

  it("runs read-only without approvals, in a profile that writes only its scratch folder, which goes when the session closes", async () => {
    // The host's config comes first, so a later entry of the adapter wins over it.
    const config = ['default_permissions=":workspace"'];
    session = await startCodexSession({ cwd: process.cwd(), clientName: "test", executablePath: FAKE, access: "read-only", config });
    const setup = JSON.parse((await session.send("setup")).text);
    expect(setup).toMatchObject({ permissions: "yami-read-only", approvalPolicy: "never", capabilities: { experimentalApi: true } });
    expect(setup.sandbox).toBeUndefined();
    const entries = (setup.args as string[]).filter((_, index, args) => args[index - 1] === "--config");
    const scratch = /"(\/tmp\/yami-read-only-[^"]+)"="write"/.exec(entries.join("\n"))?.[1];
    expect(scratch).toBeDefined();
    expect(existsSync(scratch!)).toBe(true);
    expect(entries).toEqual([
      'default_permissions=":workspace"',
      'default_permissions="yami-read-only"',
      `permissions.yami-read-only.filesystem={":root"="read", "${scratch}"="write"}`,
      `shell_environment_policy.set.TMPDIR="${scratch}"`,
      `shell_environment_policy.set.TMP="${scratch}"`,
      `shell_environment_policy.set.TEMP="${scratch}"`,
      `shell_environment_policy.set.XDG_CACHE_HOME="${scratch}/cache"`,
      `shell_environment_policy.set.GOCACHE="${scratch}/go-build"`,
      `shell_environment_policy.set.GOTMPDIR="${scratch}"`,
      `shell_environment_policy.set.npm_config_cache="${scratch}/npm"`,
      `shell_environment_policy.set.PYTHONPYCACHEPREFIX="${scratch}/pycache"`,
      `shell_environment_policy.set.CARGO_TARGET_DIR="${scratch}/cargo-target"`,
    ]);
    await session.close();
    expect(existsSync(scratch!)).toBe(false);
  });

  it("sends approvals to the user and asks before every command by default", async () => {
    session = await startCodexSession({ cwd: process.cwd(), clientName: "test", executablePath: FAKE });
    const setup = JSON.parse((await session.send("setup")).text);
    expect(setup).toMatchObject({ sandbox: "workspace-write", approvalPolicy: "untrusted" });
    expect(setup.permissions).toBeUndefined();
    expect(setup.args).toEqual(["app-server", "--stdio"]);
  });

  it("streams reasoning summaries as thinking", async () => {
    const { session, events } = await start();
    await session.send("reasoning");
    const deltas = events.filter((event) => event.type === "thinking-delta").map((event) => event.text);
    expect(deltas.join("")).toBe("Plan the reply\n\nCheck the note");
    expect(events).toContainEqual({ type: "thinking", text: "Plan the reply\n\nCheck the note" });
  });

  it("lists models with their effort levels", async () => {
    const { session } = await start();
    expect(await session.models()).toEqual([
      { id: "gpt-fast", name: "Fast", description: "Quick", efforts: ["low", "high"], defaultEffort: "low", isDefault: true },
    ]);
  });

  it("sends the configured model and effort with the next turn", async () => {
    const { session } = await start();
    await session.configure({ model: "gpt-fast", effort: "high" });
    expect(JSON.parse((await session.send("turn-settings")).text)).toEqual({ model: "gpt-fast", effort: "high" });
  });

  it("lists skills as commands and invokes one with a slash", async () => {
    const { session } = await start();
    expect(await session.commands()).toEqual([{ name: "summarize", description: "Summarize a note" }]);
    const input = JSON.parse((await session.send("/summarize Ideas.md")).text);
    expect(input).toEqual([
      { type: "skill", name: "summarize", path: "/skills/summarize/SKILL.md" },
      { type: "text", text: "Ideas.md", text_elements: [] },
    ]);
  });

  function helloSet() {
    const root = mkdtempSync(path.join(tmpdir(), "yami-skills-"));
    const hello = path.join(root, "internal", "hello");
    mkdirSync(path.join(hello, "skills", "greeting"), { recursive: true });
    writeFileSync(path.join(hello, "skills", "greeting", "SKILL.md"), '---\nname: greeting\ndescription: "How to greet by name."\n---\n# Greeting\n');
    return hello;
  }

  it("lists a skill set's skills in the instructions and as <set>:<skill> commands, and invokes one by that name", async () => {
    const hello = helloSet();
    const { session } = await start("allow", undefined, [hello]);
    const setup = JSON.parse((await session.send("setup")).text);
    expect(setup.extraRoots).toBeUndefined();
    expect((await session.send("instructions")).text).toContain(`- hello:greeting: How to greet by name. (${path.join(hello, "skills", "greeting", "SKILL.md")})`);
    expect(await session.commands()).toEqual([
      { name: "hello:greeting", description: "How to greet by name." },
      { name: "summarize", description: "Summarize a note" },
    ]);
    // The skill's instructions go in the turn, so the model needs no command to read them.
    const [input] = JSON.parse((await session.send("/hello:greeting Ada\nand Bob")).text);
    const folder = path.join(hello, "skills", "greeting");
    expect(input).toEqual({
      type: "text",
      text: `<skill name="hello:greeting" folder="${folder}">\nThe user invoked the skill hello:greeting. Follow its instructions. Paths in it are relative to its folder, ${folder}, unless they start at the working directory.\n\n# Greeting\n</skill>\n\nAda\nand Bob`,
      text_elements: [],
    });
    // An unknown command stays text.
    expect(JSON.parse((await session.send("/hello:nothing x")).text)).toEqual([{ type: "text", text: "/hello:nothing x", text_elements: [] }]);
  });

  it("allows a read of a skill-set file without asking, and asks for any other read", async () => {
    const hello = helloSet();
    const { session, requests } = await start("deny", undefined, [hello]);
    const skillFile = path.join(hello, "skills", "greeting", "SKILL.md");
    expect(JSON.parse((await session.send(`read-file ${skillFile}`)).text)).toEqual({ decision: "accept" });
    expect(requests).toEqual([]);
    expect(JSON.parse((await session.send("read-file /etc/hosts")).text)).toEqual({ decision: "decline" });
    expect(requests).toHaveLength(1);
  });

  it("closes cleanly while idle", async () => {
    const { session, events } = await start();
    await session.close();
    expect(session.closed).toBe(true);
    expect(events).toEqual([{ type: "closed", error: undefined }]);
  });
});

describe("isSkillRead", () => {
  const root = mkdtempSync(path.join(tmpdir(), "yami-read-"));
  const folder = path.join(root, "internal", "wiki", "skills");
  mkdirSync(path.join(folder, "ingest"), { recursive: true });
  writeFileSync(path.join(folder, "ingest", "SKILL.md"), "x");
  const file = path.join(folder, "ingest", "SKILL.md");
  const read = (command: string) => isSkillRead(command, [folder], root);

  it.each([
    `cat ${file}`,
    `sed -n '1,240p' ${file}`,
    `sed -n 5p "${file}"`,
    `head -n 40 ${file}`,
    `tail -20 ${file}`,
    `nl ${file}`,
    `ls -la ${path.join(folder, "ingest")}`,
    "cat internal/wiki/skills/ingest/SKILL.md",
    `cat ${file} internal/wiki/skills/ingest/SKILL.md`,
  ])("allows %s", (command) => {
    expect(read(command)).toBe(true);
  });

  it.each([
    `cat /etc/hosts`,
    `cat ${file} /etc/hosts`,
    `cat ${path.join(folder, "..", "..", "..", "secret.md")}`,
    `cat ${file}; rm -rf /`,
    `cat ${file} | sh`,
    `cat ${file} > out.md`,
    `cat $(echo ${file})`,
    `sed -i '' 's/a/b/' ${file}`,
    `sed -n '1w out' ${file}`,
    `sed '1,2p' ${file}`,
    `head -c 10 ${file}`,
    `rm ${file}`,
    `cat`,
    `cat "${file}$HOME"`,
    `cat ${path.join(folder, "*")}`,
    `cat '${file}`,
  ])("refuses %s", (command) => {
    expect(read(command)).toBe(false);
  });

  it("follows links, as /var and /private/var on macOS", () => {
    const link = path.join(root, "linked");
    symlinkSync(folder, link);
    expect(isSkillRead(`cat ${path.join(link, "ingest", "SKILL.md")}`, [folder], root)).toBe(true);
    expect(isSkillRead(`cat ${file}`, [link], root)).toBe(true);
  });
});
