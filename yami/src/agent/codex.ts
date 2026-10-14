import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { createInterface } from "node:readline";
import type { ThreadEvent, ThreadItem } from "@openai/codex-sdk";
import { Agent } from "./agent.js";
import { childEnv, findExecutables } from "./executable.js";
import { contentText, Session } from "./session.js";
import type { AgentInfo, Preferences, Usage } from "./types.js";

export interface CodexPreferences extends Preferences {
  /** Defaults to `disabled`. */
  webSearch?: "disabled" | "cached" | "live";
  /** Lets shell commands use the network. Applies only to `edit` access. Defaults to false. */
  networkAccess?: boolean;
}

export interface CodexAgentOptions {
  /**
   * Path to the native Codex CLI. Defaults to the first `codex` on `PATH` or in
   * a standard install folder. For an npm install, the agent uses the native
   * binary in the package, because the npm launcher needs Node on `PATH`.
   */
  executable?: string;
  /** Variables added to the CLI environment, for example `CODEX_HOME`. */
  env?: Record<string, string>;
  /**
   * Raw `key=value` TOML entries, each sent as `--config`. They come after the
   * settings of the agent, so they can change them.
   */
  config?: string[];
  preferences?: CodexPreferences;
}

/** Features that act outside the sandbox, or add tools from outside Codex. */
const DISABLED_FEATURES = [
  "apps",
  "plugins",
  "remote_plugin",
  "plugin_sharing",
  "browser_use",
  "browser_use_external",
  "computer_use",
  "in_app_browser",
  "image_generation",
  "multi_agent",
  "goals",
  "tool_suggest",
  "skill_mcp_dependency_install",
  "hooks",
  "workspace_dependencies",
];

export class CodexAgent extends Agent<CodexPreferences> {
  readonly harness = "codex";
  readonly executable: string | undefined;

  constructor(private readonly options: CodexAgentOptions = {}) {
    super(options.preferences);
    this.executable = options.executable ?? findCodexExecutable();
  }

  async connect(): Promise<AgentInfo> {
    const executable = this.requireExecutable();
    const env = this.env(executable);
    const version = await run(executable, ["--version"], env);
    const status = await run(executable, ["login", "status"], env);
    if (status.code !== 0) {
      throw new Error(`Codex is not signed in. Run \`codex login\`. Codex said: ${status.output}`);
    }
    return {
      harness: this.harness,
      version: version.output.replace(/^codex-cli\s+/, ""),
      account: { login: status.output.match(/using (.+)$/m)?.[1] ?? status.output },
    };
  }

  protected createSession(preferences: CodexPreferences): Session {
    const executable = this.requireExecutable();
    return new CodexSession(executable, this.args(preferences), this.env(executable), preferences.model);
  }

  private requireExecutable(): string {
    if (!this.executable) {
      throw new Error("Codex CLI not found. Install Codex, or set the `executable` option.");
    }
    return this.executable;
  }

  private env(executable: string): Record<string, string> {
    const env = childEnv(this.options.env);
    const pathDir = join(dirname(dirname(executable)), "codex-path");
    if (existsSync(pathDir)) env.PATH = [pathDir, env.PATH].filter(Boolean).join(delimiter);
    return env;
  }

  private args(preferences: CodexPreferences): string[] {
    const access = preferences.access ?? "read-only";
    const config = [
      `approval_policy="never"`,
      `web_search=${toml(preferences.webSearch ?? "disabled")}`,
      `sandbox_workspace_write.network_access=${preferences.networkAccess ?? false}`,
      "sandbox_workspace_write.exclude_slash_tmp=true",
      "sandbox_workspace_write.exclude_tmpdir_env_var=true",
      ...DISABLED_FEATURES.map((feature) => `features.${feature}=false`),
    ];
    if (preferences.effort) config.push(`model_reasoning_effort=${toml(preferences.effort)}`);
    if (preferences.instructions) config.push(`developer_instructions=${toml(preferences.instructions)}`);
    config.push(...(this.options.config ?? []));

    const args = [
      "exec",
      "--json",
      "--ignore-user-config",
      "--ignore-rules",
      "--skip-git-repo-check",
      "--sandbox",
      access === "edit" ? "workspace-write" : "read-only",
    ];
    if (preferences.cwd) args.push("--cd", preferences.cwd);
    if (preferences.model) args.push("--model", preferences.model);
    for (const entry of config) args.push("--config", entry);
    return args;
  }
}

interface TurnState {
  /** Codex numbers items again on each turn, so IDs get this prefix. */
  prefix: string;
  text: string;
  errors: string[];
  failed: boolean;
  usage: Usage;
  calls: Set<string>;
}

/** Runs one `codex exec` process for each turn and resumes the thread by ID. */
class CodexSession extends Session {
  private child: ChildProcess | undefined;
  private turns = 0;

  constructor(
    private readonly executable: string,
    private readonly args: string[],
    private readonly env: Record<string, string>,
    private readonly model: string | undefined,
  ) {
    super();
  }

  protected startTurn(prompt: string): void {
    void this.runTurn(prompt);
  }

  protected async stopTurn(): Promise<void> {
    this.child?.kill();
  }

  protected dispose(): void {
    this.child?.kill();
  }

  private async runTurn(prompt: string): Promise<void> {
    const started = Date.now();
    const turn: TurnState = {
      prefix: `turn${++this.turns}/`,
      text: "",
      errors: [],
      failed: false,
      usage: { inputTokens: 0, outputTokens: 0 },
      calls: new Set(),
    };
    try {
      const args = this.id ? [...this.args, "resume", this.id] : this.args;
      const child = spawn(this.executable, args, { env: this.env, stdio: ["pipe", "pipe", "pipe"] });
      this.child = child;
      const exited = new Promise<{ code: number | null; signal: string | null; error?: Error }>((resolve) => {
        child.once("error", (error) => resolve({ code: null, signal: null, error }));
        child.once("close", (code, signal) => resolve({ code, signal }));
      });
      let stderr = "";
      child.stderr!.setEncoding("utf8").on("data", (chunk: string) => {
        stderr = (stderr + chunk).slice(-4000);
      });
      child.stdin!.on("error", () => {});
      child.stdin!.end(prompt);

      for await (const line of createInterface({ input: child.stdout! })) {
        const event = parseEvent(line);
        if (event) this.handle(event, turn);
      }
      const { code, signal, error } = await exited;
      this.child = undefined;

      if (error) turn.errors.push(error.message);
      else if (signal) turn.errors.push(`Codex stopped on ${signal}.`);
      else if (code !== 0 && !turn.failed) turn.errors.push(stderr.trim() || `Codex exited with code ${code}.`);
      const ok = !turn.failed && !error && !signal && code === 0;
      this.endTurn({ status: ok ? "success" : "error", ...this.outcome(turn, started) });
    } catch (error) {
      turn.errors.push(error instanceof Error ? error.message : String(error));
      this.endTurn({ status: "error", ...this.outcome(turn, started) });
    }
  }

  private outcome(turn: TurnState, started: number) {
    return { text: turn.text, errors: turn.errors, usage: turn.usage, durationMs: Date.now() - started };
  }

  private handle(event: ThreadEvent, turn: TurnState): void {
    switch (event.type) {
      case "thread.started":
        this.ready({ sessionId: event.thread_id, model: this.model });
        return;
      case "item.started":
        this.call(event.item, turn);
        return;
      case "item.completed":
        this.complete(event.item, turn);
        return;
      case "turn.completed":
        turn.usage = { inputTokens: event.usage.input_tokens, outputTokens: event.usage.output_tokens };
        return;
      case "turn.failed":
        turn.failed = true;
        turn.errors.push(event.error.message);
        return;
      case "error":
        turn.failed = true;
        turn.errors.push(event.message);
        return;
    }
  }

  private call(item: ThreadItem, turn: TurnState): void {
    const call = toolCall(item);
    if (!call || turn.calls.has(item.id)) return;
    turn.calls.add(item.id);
    this.emit({ type: "tool-call", id: turn.prefix + item.id, ...call });
  }

  private complete(item: ThreadItem, turn: TurnState): void {
    if (item.type === "agent_message") {
      turn.text = item.text;
      this.emit({ type: "text", text: item.text });
      return;
    }
    if (item.type === "error") {
      turn.errors.push(item.message);
      return;
    }
    const result = toolResult(item);
    if (!result) return;
    this.call(item, turn);
    this.emit({ type: "tool-result", id: turn.prefix + item.id, ...result });
  }
}

function toolCall(item: ThreadItem): { name: string; input: unknown } | undefined {
  switch (item.type) {
    case "command_execution":
      return { name: "shell", input: { command: item.command } };
    case "file_change":
      return { name: "apply_patch", input: { changes: item.changes } };
    case "mcp_tool_call":
      return { name: `${item.server}.${item.tool}`, input: item.arguments };
    case "web_search":
      return { name: "web_search", input: { query: item.query } };
    default:
      return undefined;
  }
}

function toolResult(item: ThreadItem): { isError: boolean; output: string } | undefined {
  switch (item.type) {
    case "command_execution":
      return { isError: item.status === "failed" || (item.exit_code ?? 0) !== 0, output: item.aggregated_output };
    case "file_change":
      return {
        isError: item.status === "failed",
        output: item.changes.map((change) => `${change.kind} ${change.path}`).join("\n"),
      };
    case "mcp_tool_call":
      return {
        isError: item.status === "failed",
        output: item.error?.message ?? contentText(item.result?.content),
      };
    case "web_search":
      return { isError: false, output: "" };
    default:
      return undefined;
  }
}

function parseEvent(line: string): ThreadEvent | undefined {
  if (!line.trim()) return undefined;
  try {
    return JSON.parse(line) as ThreadEvent;
  } catch {
    return undefined;
  }
}

/** JSON string syntax is valid TOML basic string syntax. */
function toml(value: string): string {
  return JSON.stringify(value);
}

function run(file: string, args: string[], env: Record<string, string>): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, output: output.trim() }));
  });
}

const TARGETS: Record<string, { triple: string; pkg: string }> = {
  "darwin-arm64": { triple: "aarch64-apple-darwin", pkg: "codex-darwin-arm64" },
  "darwin-x64": { triple: "x86_64-apple-darwin", pkg: "codex-darwin-x64" },
  "linux-arm64": { triple: "aarch64-unknown-linux-musl", pkg: "codex-linux-arm64" },
  "linux-x64": { triple: "x86_64-unknown-linux-musl", pkg: "codex-linux-x64" },
  "win32-arm64": { triple: "aarch64-pc-windows-msvc", pkg: "codex-win32-arm64" },
  "win32-x64": { triple: "x86_64-pc-windows-msvc", pkg: "codex-win32-x64" },
};

/** Returns the native Codex binary. Follows an npm launcher into its package. */
export function findCodexExecutable(): string | undefined {
  for (const candidate of findExecutables("codex")) {
    const real = realpathSync(candidate);
    if (!real.endsWith(".js")) return real;
    const native = npmNativeBinary(dirname(dirname(real)));
    if (native) return native;
  }
  return undefined;
}

function npmNativeBinary(packageRoot: string): string | undefined {
  const target = TARGETS[`${process.platform}-${process.arch}`];
  if (!target) return undefined;
  const file = process.platform === "win32" ? "codex.exe" : "codex";
  const vendors = [
    join(packageRoot, "node_modules", "@openai", target.pkg, "vendor"),
    join(dirname(packageRoot), target.pkg, "vendor"),
    join(packageRoot, "vendor"),
  ];
  for (const vendor of vendors) {
    const binary = join(vendor, target.triple, "bin", file);
    if (existsSync(binary)) return binary;
  }
  return undefined;
}
