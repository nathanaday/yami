import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { Agent } from "./agent.js";
import type * as Codex from "./codex-protocol.js";
import { findExecutables, harnessEnv } from "./executable.js";
import { JsonRpcConnection } from "./jsonrpc.js";
import { contentText, Session } from "./session.js";
import type { AgentInfo, PermissionDecision, PermissionKind, Preferences, Usage } from "./types.js";

export interface CodexPreferences extends Preferences {
  /** Defaults to the Codex configuration. */
  webSearch?: "disabled" | "cached" | "live";
  /** Lets shell commands use the network without asking. Applies to `edit` access. Defaults to the Codex configuration. */
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
  /** Raw `key=value` TOML entries, each sent to `codex app-server` as `--config`. */
  config?: string[];
  preferences?: CodexPreferences;
}

const CLIENT = { name: "yami", version: "0.1.0" };

export class CodexAgent extends Agent<CodexPreferences> {
  readonly harness = "codex";
  readonly executable: string | undefined;

  constructor(private readonly options: CodexAgentOptions = {}) {
    super(options.preferences);
    this.executable = options.executable ?? findCodexExecutable();
  }

  async connect(): Promise<AgentInfo> {
    const executable = this.requireExecutable();
    const env = await this.env(executable);
    const version = await run(executable, ["--version"], env);
    const server = new AppServer(executable, this.serverArgs(), env, {
      notification: () => {},
      request: async (method) => {
        throw new Error(`Yami does not handle ${method}.`);
      },
    });
    try {
      await server.rpc.request("initialize", { clientInfo: CLIENT, capabilities: null });
      server.rpc.notify("initialized");
      const { account } = await server.rpc.request<Codex.Account>("account/read", { refreshToken: false });
      if (!account) throw new Error("Codex is not signed in. Run `codex login`.");
      return {
        harness: this.harness,
        version: version.output.replace(/^codex-cli\s+/, ""),
        account:
          account.type === "chatgpt" && "planType" in account
            ? { login: "ChatGPT", email: account.email ?? undefined, subscription: account.planType }
            : { login: account.type === "apiKey" ? "API key" : account.type },
      };
    } finally {
      server.stop();
    }
  }

  protected createSession(preferences: CodexPreferences): Session {
    const executable = this.requireExecutable();
    return new CodexSession(executable, this.serverArgs(), this.env(executable), threadParams(preferences));
  }

  private requireExecutable(): string {
    if (!this.executable) {
      throw new Error("Codex CLI not found. Install Codex, or set the `executable` option.");
    }
    return this.executable;
  }

  private async env(executable: string): Promise<Record<string, string>> {
    const env = await harnessEnv(this.options.env);
    const pathDir = join(dirname(dirname(executable)), "codex-path");
    if (existsSync(pathDir)) env.PATH = [pathDir, env.PATH].filter(Boolean).join(delimiter);
    return env;
  }

  private serverArgs(): string[] {
    return ["app-server", "--stdio", ...(this.options.config ?? []).flatMap((entry) => ["--config", entry])];
  }
}

/**
 * Approvals go to the user, not to an automatic reviewer that a user
 * configuration can select. Writes to `/tmp` and `$TMPDIR` need approval too.
 */
function threadParams(preferences: CodexPreferences): Record<string, unknown> {
  const config: Record<string, unknown> = {
    "sandbox_workspace_write.exclude_slash_tmp": true,
    "sandbox_workspace_write.exclude_tmpdir_env_var": true,
  };
  if (preferences.effort) config.model_reasoning_effort = preferences.effort;
  if (preferences.webSearch) config.web_search = preferences.webSearch;
  if (preferences.networkAccess !== undefined) config["sandbox_workspace_write.network_access"] = preferences.networkAccess;
  return {
    cwd: preferences.cwd ?? null,
    model: preferences.model ?? null,
    sandbox: preferences.access === "edit" ? "workspace-write" : "read-only",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    developerInstructions: preferences.instructions ?? null,
    config,
  };
}

/** One `codex app-server` process, with JSON-RPC on its stdio. */
class AppServer {
  readonly rpc: JsonRpcConnection;
  readonly exited: Promise<Error>;
  /** True after `stop()`, so that the exit is expected. */
  stopped = false;
  private readonly child: ChildProcess;
  private stderr = "";

  constructor(executable: string, args: string[], env: Record<string, string>, handlers: ConstructorParameters<typeof JsonRpcConnection>[1]) {
    this.child = spawn(executable, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    this.child.stdin!.on("error", () => {});
    this.child.stderr!.setEncoding("utf8").on("data", (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-4000);
    });
    this.rpc = new JsonRpcConnection((line) => this.child.stdin!.write(line), handlers);
    createInterface({ input: this.child.stdout! }).on("line", (line) => this.rpc.receive(line.replace(ESCAPES, "")));
    this.exited = new Promise<Error>((resolve) => {
      this.child.once("error", (error) => resolve(error));
      this.child.once("close", (code, signal) =>
        resolve(new Error(`Codex app-server exited (${signal ?? `code ${code}`}). ${lastLine(this.stderr)}`.trim())),
      );
    }).then((error) => {
      this.rpc.close(error);
      return error;
    });
  }

  /**
   * Closes stdin, so that the server can stop its commands and exit. SIGINT and
   * then SIGKILL follow if it does not exit.
   */
  stop(): void {
    this.stopped = true;
    const child = this.child;
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.stdin!.end();
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      return;
    }
    const interrupt = setTimeout(() => child.kill("SIGINT"), STOP_GRACE_MS);
    const kill = setTimeout(() => child.kill("SIGKILL"), STOP_GRACE_MS + KILL_GRACE_MS);
    child.once("close", () => {
      clearTimeout(interrupt);
      clearTimeout(kill);
    });
  }
}

interface TurnState {
  id?: string;
  started: number;
  text: string;
  errors: string[];
  usage: Usage;
  calls: Set<string>;
  items: Map<string, Codex.ThreadItem>;
  interruptRequested: boolean;
}

/**
 * Keeps one `codex app-server` process and one thread open for the session.
 * `turn/interrupt` ends a turn but leaves its commands running, and only a
 * server that stops also stops its commands. So an interrupt stops the server,
 * and the next turn resumes the thread on a new server.
 */
class CodexSession extends Session {
  private server: AppServer | undefined;
  /** The server and the thread ID, when the thread is ready. */
  private thread: Promise<{ server: AppServer; threadId: string }>;
  private current: TurnState | undefined;

  constructor(
    private readonly executable: string,
    private readonly args: string[],
    private readonly env: Promise<Record<string, string>>,
    private readonly params: Record<string, unknown>,
  ) {
    super();
    this.thread = this.open();
  }

  /** Starts a server, then starts the thread, or resumes it when `threadId` is set. */
  private open(threadId?: string): Promise<{ server: AppServer; threadId: string }> {
    const thread = (async () => {
      const env = await this.env;
      if (this.closed) throw new Error("The session is closed.");
      const server = new AppServer(this.executable, this.args, env, {
        notification: (method, params) => {
          if (server === this.server) this.notification(method, params as Record<string, unknown>);
        },
        request: (method, params) => this.request(method, params as Record<string, unknown>),
      });
      this.server = server;
      void server.exited.then((error) => {
        if (!server.stopped) this.finish(error);
      });
      await server.rpc.request("initialize", { clientInfo: CLIENT, capabilities: null });
      server.rpc.notify("initialized");
      if (threadId) {
        await server.rpc.request("thread/resume", { ...this.params, threadId });
        return { server, threadId };
      }
      const response = await server.rpc.request<Codex.ThreadStartResponse>("thread/start", this.params);
      this.ready({ sessionId: response.thread.id, model: response.model });
      return { server, threadId: response.thread.id };
    })();
    thread.catch((error: Error) => this.finish(error));
    return thread;
  }

  protected startTurn(prompt: string): void {
    const turn: TurnState = {
      started: Date.now(),
      text: "",
      errors: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      calls: new Set(),
      items: new Map(),
      interruptRequested: false,
    };
    this.current = turn;
    void (async () => {
      try {
        const { server, threadId } = await this.thread;
        const response = await server.rpc.request<Codex.TurnStartResponse>("turn/start", {
          threadId,
          input: [{ type: "text", text: prompt, text_elements: [] }],
        });
        turn.id = response.turn.id;
        if (turn.interruptRequested) await this.abort(turn);
      } catch (error) {
        turn.errors.push(error instanceof Error ? error.message : String(error));
        this.endCurrent("error");
      }
    })();
  }

  protected async stopTurn(): Promise<void> {
    const turn = this.current;
    if (!turn) return;
    turn.interruptRequested = true;
    if (turn.id) await this.abort(turn);
  }

  protected dispose(): void {
    const turn = this.current;
    if (turn?.id) void this.server?.rpc.request("turn/interrupt", { threadId: this.id, turnId: turn.id }).catch(() => {});
    this.server?.stop();
  }

  /** Interrupts the turn, stops the server and its commands, and opens a new server for the thread. */
  private async abort(turn: TurnState): Promise<void> {
    const { server, threadId } = await this.thread;
    try {
      await server.rpc.request("turn/interrupt", { threadId, turnId: turn.id });
    } catch {
      // The turn has already ended, or the server has stopped.
    }
    server.stop();
    this.endCurrent("error");
    if (!this.closed) this.thread = this.open(threadId);
  }

  private endCurrent(status: "success" | "error"): void {
    const turn = this.current;
    if (!turn) return;
    this.current = undefined;
    this.endTurn({
      status,
      text: turn.text,
      errors: turn.errors,
      usage: turn.usage,
      durationMs: Date.now() - turn.started,
    });
  }

  private notification(method: string, params: Record<string, unknown>): void {
    const turn = this.current;
    if (!turn || (params.threadId !== undefined && params.threadId !== this.id)) return;
    switch (method) {
      case "item/started": {
        const { item } = params as unknown as Codex.ItemNotification;
        turn.items.set(item.id, item);
        this.call(item, turn);
        return;
      }
      case "item/completed": {
        const { item } = params as unknown as Codex.ItemNotification;
        turn.items.set(item.id, item);
        this.complete(item, turn);
        return;
      }
      case "thread/tokenUsage/updated": {
        const { last } = (params as unknown as Codex.TokenUsageNotification).tokenUsage;
        turn.usage = {
          inputTokens: turn.usage.inputTokens + last.inputTokens,
          outputTokens: turn.usage.outputTokens + last.outputTokens,
        };
        return;
      }
      case "error": {
        const { error, willRetry } = params as unknown as Codex.ErrorNotification;
        if (!willRetry) turn.errors.push(error.message);
        return;
      }
      case "turn/completed": {
        const completed = (params as { turn: Codex.Turn }).turn;
        if (turn.id && completed.id !== turn.id) return;
        if (completed.error) turn.errors.push(completed.error.message);
        this.endCurrent(completed.status === "completed" && !completed.error ? "success" : "error");
        return;
      }
    }
  }

  /** Answers the requests that Codex sends to the client. */
  private async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case "item/commandExecution/requestApproval": {
        const request = params as unknown as Codex.CommandApprovalRequest;
        const network = request.networkApprovalContext;
        const decision = await this.askPermission({
          kind: network ? "network" : "command",
          tool: "shell",
          input: network ? { host: network.host, command: request.command } : { command: request.command, cwd: request.cwd },
          reason: request.reason ?? undefined,
          canAllowForSession: true,
        });
        return { decision: approvalDecision(decision) };
      }
      case "item/fileChange/requestApproval": {
        const request = params as unknown as Codex.FileChangeApprovalRequest;
        const item = this.current?.items.get(request.itemId);
        const decision = await this.askPermission({
          kind: "edit",
          tool: "apply_patch",
          input: { changes: item?.type === "fileChange" ? changeList(item) : [], grantRoot: request.grantRoot ?? undefined },
          reason: request.reason ?? undefined,
          canAllowForSession: true,
        });
        return { decision: approvalDecision(decision) };
      }
      case "item/permissions/requestApproval": {
        const { permissions, reason } = params as unknown as Codex.PermissionsApprovalRequest;
        const kind: PermissionKind = permissions.network?.enabled
          ? "network"
          : permissions.fileSystem?.write?.length
            ? "edit"
            : "read";
        const decision = await this.askPermission({
          kind,
          tool: "permissions",
          input: permissions,
          reason: reason ?? undefined,
          canAllowForSession: true,
        });
        if (decision === "deny") return { permissions: {}, scope: "turn" };
        const granted: Record<string, unknown> = {};
        if (permissions.network) granted.network = permissions.network;
        if (permissions.fileSystem) granted.fileSystem = permissions.fileSystem;
        return { permissions: granted, scope: decision === "allow-for-session" ? "session" : "turn" };
      }
      case "mcpServer/elicitation/request": {
        const request = params as unknown as Codex.ElicitationRequest;
        const needsAnswers = request.mode === "url" || (request.requestedSchema?.required?.length ?? 0) > 0;
        const decision = needsAnswers
          ? "deny"
          : await this.askPermission({
              kind: "mcp",
              tool: request.serverName,
              input: request.requestedSchema,
              reason: request.message,
              canAllowForSession: false,
            });
        return decision === "deny"
          ? { action: "decline", content: null, _meta: null }
          : { action: "accept", content: {}, _meta: null };
      }
      case "item/tool/requestUserInput":
        return { answers: {} };
      default:
        throw new Error(`Yami does not handle ${method}.`);
    }
  }

  private call(item: Codex.ThreadItem, turn: TurnState): void {
    const call = toolCall(item);
    if (!call || turn.calls.has(item.id)) return;
    turn.calls.add(item.id);
    this.emit({ type: "tool-call", id: item.id, ...call });
  }

  private complete(item: Codex.ThreadItem, turn: TurnState): void {
    if (item.type === "agentMessage") {
      turn.text = item.text;
      this.emit({ type: "text", text: item.text });
      return;
    }
    const result = toolResult(item);
    if (!result) return;
    this.call(item, turn);
    this.emit({ type: "tool-result", id: item.id, ...result });
  }
}

function approvalDecision(decision: PermissionDecision): string {
  return decision === "allow" ? "accept" : decision === "allow-for-session" ? "acceptForSession" : "decline";
}

function changeList(item: Extract<Codex.ThreadItem, { type: "fileChange" }>) {
  return item.changes.map((change) => ({ path: change.path, kind: change.kind.type }));
}

function toolCall(item: Codex.ThreadItem): { name: string; input: unknown } | undefined {
  switch (item.type) {
    case "commandExecution":
      return { name: "shell", input: { command: item.command } };
    case "fileChange":
      return { name: "apply_patch", input: { changes: changeList(item) } };
    case "mcpToolCall":
      return { name: `${item.server}.${item.tool}`, input: item.arguments };
    case "dynamicToolCall":
      return { name: item.namespace ? `${item.namespace}.${item.tool}` : item.tool, input: item.arguments };
    case "webSearch":
      return { name: "web_search", input: { query: item.query } };
    default:
      return undefined;
  }
}

function toolResult(item: Codex.ThreadItem): { isError: boolean; output: string } | undefined {
  switch (item.type) {
    case "commandExecution":
      return {
        isError: item.status === "failed" || item.status === "declined" || (item.exitCode ?? 0) !== 0,
        output: item.aggregatedOutput ?? "",
      };
    case "fileChange":
      return {
        isError: item.status === "failed" || item.status === "declined",
        output: changeList(item).map((change) => `${change.kind} ${change.path}`).join("\n"),
      };
    case "mcpToolCall":
      return { isError: item.status === "failed", output: item.error?.message ?? contentText(item.result?.content) };
    case "dynamicToolCall":
      return { isError: item.status === "failed" || item.success === false, output: contentText(item.contentItems) };
    case "webSearch":
      return { isError: false, output: "" };
    default:
      return undefined;
  }
}

/** Terminal control sequences: CSI, OSC, and two-byte escapes. */
const ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g;

const STOP_GRACE_MS = 2_000;
const KILL_GRACE_MS = 3_000;

function lastLine(text: string): string {
  return text.trim().split("\n").at(-1) ?? "";
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
