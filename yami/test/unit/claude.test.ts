import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { afterEach, describe, expect, it } from "vitest";
import { startClaudeSession } from "../../src/agent/claude.js";
import { type AgentEvent, type AgentSession, defineTool, setAgents } from "../../src/agent/index.js";

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

  it("asks the host for a permission in an edit session", async () => {
    const asked: string[] = [];
    session = await startClaudeSession({ cwd: process.cwd(), clientName: "test", executablePath: FAKE, settingSources: [], onPermission: async (r) => (asked.push(r.tool), "allow") });
    expect((await session.send(`permit Bash {"command":"touch x"}`)).text).toBe("permission: allow");
    expect(asked).toEqual(["Bash"]);
  });

  it("runs a read-only session's commands in a sandbox that writes only its scratch folder, and removes the folder when the session closes", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "yami-read-only-vault-"));
    try {
      const asked: string[] = [];
      session = await startClaudeSession({
        cwd,
        clientName: "test",
        executablePath: FAKE,
        settingSources: [],
        access: "read-only",
        // The sandbox is the read-only limit, so options of the host do not lift it.
        sdkOptions: { tools: ["Read", "Write"], sandbox: { enabled: false } },
        onPermission: async (r) => (asked.push(r.tool), "allow"),
      });
      const { text } = await session.send("args");
      expect(text).toContain("--tools=Read,Glob,Grep,Bash,WebSearch,WebFetch,Agent ");
      const settings = JSON.parse(/--settings (\{.*\})(?= --|$)/.exec(text)?.[1] ?? "{}");
      const { filesystem, ...sandbox } = settings.sandbox;
      expect(sandbox).toEqual({ enabled: true, failIfUnavailable: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false });
      const [scratch] = filesystem.allowWrite;
      expect(scratch).toMatch(/^\/tmp\/yami-read-only-/);
      expect(existsSync(scratch)).toBe(true);
      // Each folder beside the path from the root to the scratch folder is denied by name, so no setting lets a command write there.
      const real = realpathSync(scratch);
      const beside = (folder: string) => readdirSync(folder).map((name) => join(folder, name));
      const tmp = realpathSync("/tmp");
      const open = new Set(["/dev", "/tmp", tmp, real, ...(tmp === "/private/tmp" ? ["/private"] : [])]);
      expect(filesystem.denyWrite).toEqual(expect.arrayContaining([cwd, homedir(), "/tmp/claude", "/private/tmp/claude"]));
      expect(filesystem.denyWrite).toEqual(expect.arrayContaining([...beside("/"), ...beside(tmp)].filter((path) => !open.has(path))));
      for (const path of open) expect(filesystem.denyWrite).not.toContain(path);
      // Claude Code puts its own temporary folder, and the commands' TMPDIR, in the scratch folder.
      expect(JSON.parse((await session.send("env CLAUDE_CODE_TMPDIR GOCACHE npm_config_cache")).text)).toEqual({
        CLAUDE_CODE_TMPDIR: scratch,
        GOCACHE: join(scratch, "go-build"),
        npm_config_cache: join(scratch, "npm"),
      });
      await session.close();
      expect(existsSync(scratch)).toBe(false);
      expect(asked).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("runs each command that Claude Code asks about in a read-only session's sandbox, and denies every other request, without asking", async () => {
    const asked: string[] = [];
    session = await startClaudeSession({ cwd: process.cwd(), clientName: "test", executablePath: FAKE, settingSources: [], access: "read-only", onPermission: async (r) => (asked.push(r.tool), "allow") });
    expect((await session.send(`permit Bash {"command":"GOCACHE=x go test ./...; echo $?"}`)).text).toBe("permission: allow");
    expect((await session.send(`permit-input Bash {"command":"for f in *; do wc -l $f; done","dangerouslyDisableSandbox":true}`)).text).toBe(
      'permission: allow {"command":"for f in *; do wc -l $f; done"}',
    );
    expect((await session.send(`permit Read {"file_path":"/etc/hosts"}`)).text).toBe(
      "permission: deny: This session is read-only, so it asks for nothing. Run only commands that read or check, such as git log or the tests.",
    );
    expect(asked).toEqual([]);
  });

  it("gives an edit session no scratch folder and no sandbox of its own", async () => {
    session = await startClaudeSession({ cwd: process.cwd(), clientName: "test", executablePath: FAKE, settingSources: [] });
    expect((await session.send("args")).text).not.toContain('"sandbox"');
    expect(JSON.parse((await session.send("env CLAUDE_CODE_TMPDIR GOCACHE")).text)).toEqual({ CLAUDE_CODE_TMPDIR: process.env.CLAUDE_CODE_TMPDIR, GOCACHE: process.env.GOCACHE });
  });

  it("denies a read-only session each command that the user's settings run outside the sandbox", async () => {
    const config = mkdtempSync(join(tmpdir(), "yami-claude-config-"));
    try {
      writeFileSync(join(config, "settings.json"), JSON.stringify({ sandbox: { excludedCommands: ["docker *", "make:*"] } }));
      const open = (access: "edit" | "read-only") =>
        startClaudeSession({ cwd: process.cwd(), clientName: "test", executablePath: FAKE, settingSources: ["user"], env: { CLAUDE_CONFIG_DIR: config }, access });
      session = await open("read-only");
      expect((await session.send("args")).text).toContain("--disallowedTools=Bash(docker *),Bash(make:*) ");
      // A rule may miss a form of the command, such as one after an assignment, so the session denies a request that names it.
      expect((await session.send(`permit Bash {"command":"FOO=1 docker ps"}`)).text).toBe(
        "permission: deny: The user's settings run this command outside the sandbox, so a read-only session does not run it.",
      );
      expect((await session.send(`permit Bash {"command":"cd x && /usr/bin/make test; echo $?"}`)).text).toContain("permission: deny: The user's settings");
      expect((await session.send(`permit Bash {"command":"FOO=1 makeup"}`)).text).toBe("permission: allow");
      await session.close();
      session = await open("edit");
      expect((await session.send("args")).text).not.toContain("--disallowedTools");
    } finally {
      rmSync(config, { recursive: true, force: true });
    }
  });

  it("lends a skill set's skills only: it denies each subagent that Claude Code would load from the set's agents folder", async () => {
    const root = mkdtempSync(join(tmpdir(), "yami-set-"));
    try {
      const set = join(root, "notes");
      mkdirSync(join(set, "agents/checker"), { recursive: true });
      mkdirSync(join(set, "skills/sum"), { recursive: true });
      writeFileSync(join(set, "agents/checker/AGENT.md"), "---\nname: checker\ndescription: Checks.\n---\nCheck.\n");
      writeFileSync(join(set, "agents/flat.md"), "No front matter.\n");
      writeFileSync(join(set, "skills/sum/SKILL.md"), "---\nname: sum\ndescription: Sums.\n---\nSum.\n");
      expect(setAgents([set, join(root, "none")])).toEqual(["notes:checker:checker", "notes:flat"]);
      session = await startClaudeSession({ cwd: process.cwd(), clientName: "test", executablePath: FAKE, settingSources: [], skills: [set] });
      const { text } = await session.send("args");
      expect(text).toContain("--disallowedTools=Agent(notes:checker:checker),Agent(notes:flat) ");
      expect(text).toContain(`--plugin-dir-no-mcp=${set} `);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
