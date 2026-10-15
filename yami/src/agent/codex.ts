import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { z } from "zod";
import { Agent, type AgentPreferences, type SessionStart } from "./agent.js";
import { codexApprovalPolicy } from "./approval.js";
import type {
  AccountResponse,
  AgentMessageDelta,
  ApprovalDecision,
  CommandApprovalParams,
  DynamicToolCallParams,
  ElicitationParams,
  ErrorNotification,
  FileChangeApprovalParams,
  ItemNotification,
  Model,
  PermissionsApprovalParams,
  ReasoningDelta,
  Skill,
  ThreadItem,
  ThreadStartResponse,
  TokenUsageNotification,
  TurnNotification,
} from "./codex-protocol.js";
import { findExecutables, harnessEnv, pathDisplay } from "./executable.js";
import { RpcConnection, RpcError } from "./rpc.js";
import { type ActiveTurn, askPermission, BaseSession } from "./session.js";
import { isSkillRead, setSkills, skillList, skillTurn, slashCommand } from "./skills.js";
import {
  type AgentInfo,
  type AgentSession,
  type AgentTool,
  type CommandOption,
  type ModelOption,
  type PermissionDecision,
  runTool,
  type SessionOptions,
  type SessionSettings,
} from "./types.js";

export interface CodexSessionOptions extends SessionOptions {
  /** Defaults to the Codex configuration. */
  webSearch?: "disabled" | "cached" | "live";
  /** Lets shell commands use the network without asking. Defaults to the Codex configuration. */
  networkAccess?: boolean;
  /** Raw `key=value` TOML entries, each sent to `codex app-server` as `--config`. */
  config?: string[];
}

export interface CodexPreferences extends AgentPreferences {
  webSearch?: "disabled" | "cached" | "live";
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
  config?: string[];
  preferences?: CodexPreferences;
}

const CLIENT_VERSION = "0.1.0";
const STDERR_LIMIT = 4096;
/** After stdin closes, the server gets this long to exit before SIGINT, and as long again before SIGKILL. */
const STOP_GRACE_MS = 2000;

const DECISIONS: Record<PermissionDecision, ApprovalDecision> = {
  allow: "accept",
  "allow-session": "acceptForSession",
  deny: "decline",
};

export class CodexAgent extends Agent<CodexPreferences> {
  readonly harness = "codex";

  constructor(private readonly options: CodexAgentOptions = {}) {
    super(options.preferences);
  }

  async connect(): Promise<AgentInfo> {
    const env = await harnessEnv(this.options.env);
    const executable = this.options.executable ?? findCodexExecutable(env);
    const version = await run(executable, ["--version"], env);
    const server = new AppServer(executable, serverArgs(this.options.config), this.preferences.cwd ?? process.cwd(), env, {
      onNotification: () => {},
      onRequest: async (method) => {
        throw new RpcError(-32601, `yami does not support ${method}`);
      },
    });
    try {
      await server.rpc.request("initialize", { clientInfo: { name: "yami", title: "yami", version: CLIENT_VERSION }, capabilities: null });
      server.rpc.notify("initialized");
      const { account } = await server.rpc.request<AccountResponse>("account/read", { refreshToken: false });
      if (!account) throw new Error("Codex is not signed in. Run `codex login`.");
      return {
        harness: this.harness,
        version: version.replace(/^codex-cli\s+/, ""),
        account:
          account.type === "chatgpt" && "planType" in account
            ? { login: "ChatGPT", email: account.email ?? undefined, subscription: account.planType }
            : { login: account.type === "apiKey" ? "API key" : account.type },
      };
    } finally {
      await server.stop();
    }
  }

  protected createSession(options: CodexPreferences & SessionStart<CodexPreferences>): Promise<AgentSession> {
    return startCodexSession({
      ...this.sessionOptions(options),
      executablePath: this.options.executable,
      env: this.options.env,
      config: this.options.config,
      webSearch: options.webSearch,
      networkAccess: options.networkAccess,
    });
  }
}

function serverArgs(config: string[] = []): string[] {
  return ["app-server", "--stdio", ...config.flatMap((entry) => ["--config", entry])];
}

export async function startCodexSession(options: CodexSessionOptions): Promise<CodexSession> {
  const env = await harnessEnv(options.env);
  const executable = options.executablePath ?? findCodexExecutable(env);
  const session = new CodexSession(options, env, executable);
  try {
    await session.start();
  } catch (error) {
    await session.close();
    throw error;
  }
  return session;
}

/** One `codex app-server` process with JSON-RPC on its stdio. */
class AppServer {
  readonly rpc: RpcConnection;
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null; error?: Error }>;
  /** True once `stop` runs, so that the exit is expected. */
  stopping = false;
  private readonly child: ChildProcess;
  private stderr = "";

  constructor(executable: string, args: string[], cwd: string, env: Record<string, string>, handlers: ConstructorParameters<typeof RpcConnection>[2]) {
    const child = spawn(executable, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;
    child.stdin!.on("error", () => {});
    child.stderr!.setEncoding("utf8").on("data", (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-STDERR_LIMIT);
    });
    this.rpc = new RpcConnection(child.stdout!, child.stdin!, handlers);
    this.exited = new Promise((resolve) => {
      child.once("error", (error) => resolve({ code: null, signal: null, error }));
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
  }

  /** The last lines of stderr, for error messages. */
  get detail(): string {
    return this.stderr.trim().split("\n").slice(-5).join("\n");
  }

  /**
   * Closes stdin, so that the server stops its commands and exits. SIGINT and
   * then SIGKILL follow if it does not. Each Codex command runs in its own
   * process group, so a signal to the server alone would leave them running.
   */
  async stop(): Promise<void> {
    this.stopping = true;
    const child = this.child;
    this.rpc.close(new Error("Session closed"));
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.stdin!.end();
    const timers = [
      setTimeout(
        () => (process.platform === "win32" ? spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" }) : child.kill("SIGINT")),
        STOP_GRACE_MS,
      ),
      setTimeout(() => child.kill("SIGKILL"), STOP_GRACE_MS * 2),
    ];
    await this.exited;
    for (const timer of timers) clearTimeout(timer);
  }
}

/**
 * Keeps one thread open for the session. `turn/interrupt` ends a turn but
 * leaves its commands running, and only a server that stops also stops its
 * commands. So an interrupt stops the server, and the thread resumes on a new
 * server.
 */
export class CodexSession extends BaseSession {
  readonly harness = "codex";
  private threadId = "";
  private server: AppServer | undefined;
  /** Settles when the current server has its thread. A restart replaces it. */
  private ready: Promise<void> = Promise.resolve();
  private turnId: string | undefined;
  /** The server accepts `turn/interrupt` only after it sends `turn/started`. */
  private turnStarted = false;
  private finalMessage = "";
  private lastError: string | undefined;
  private usage = { inputTokens: 0, outputTokens: 0 };
  private readonly items = new Map<string, ThreadItem>();
  private readonly appTools = new Map<string, AgentTool>();
  private settings: SessionSettings = {};
  private skills: Promise<Skill[]> | undefined;
  private readonly showPath: (file: string) => string;

  constructor(
    private readonly options: CodexSessionOptions,
    private readonly env: Record<string, string>,
    private readonly executable: string,
  ) {
    super();
    this.showPath = pathDisplay(options.cwd);
    for (const appTool of options.tools?.tools ?? []) this.appTools.set(appTool.name, appTool);
  }

  get id(): string {
    return this.threadId;
  }

  async start(): Promise<void> {
    this.ready = this.open(this.options.resume);
    await this.ready;
  }

  /** Starts a server and starts the thread, or resumes `resumeId`. */
  private async open(resumeId?: string): Promise<void> {
    const server = new AppServer(this.executable, serverArgs(this.options.config), this.options.cwd, this.env, {
      onNotification: (method, params) => {
        if (server === this.server) this.handleNotification(method, params);
      },
      onRequest: (method, params) => this.handleRequest(method, params),
    });
    this.server = server;
    void server.exited.then(({ code, signal, error }) => {
      if (server.stopping || server !== this.server) return;
      this.shutdown(error ? `Could not start codex: ${error.message}` : this.exitMessage(server, code, signal));
    });
    const name = this.options.clientName;
    const { tools } = this.options;
    await server.rpc.request("initialize", {
      clientInfo: { name, title: name, version: CLIENT_VERSION },
      // Dynamic tools are part of the experimental API.
      capabilities: tools ? { experimentalApi: true, requestAttestation: false } : null,
    });
    server.rpc.notify("initialized");
    const readOnly = this.options.access === "read-only";
    const config: Record<string, unknown> = {
      // Writes to /tmp and $TMPDIR count as outside the working directory.
      "sandbox_workspace_write.exclude_slash_tmp": true,
      "sandbox_workspace_write.exclude_tmpdir_env_var": true,
    };
    if (this.options.webSearch) config.web_search = this.options.webSearch;
    if (this.options.networkAccess !== undefined) config["sandbox_workspace_write.network_access"] = this.options.networkAccess;
    const settings = {
      cwd: this.options.cwd,
      model: this.options.model ?? null,
      approvalPolicy: readOnly ? "never" : codexApprovalPolicy(this.options.approval ?? "ask"),
      // Approvals go to the user, not to an automatic reviewer that a user configuration can select.
      approvalsReviewer: "user",
      sandbox: readOnly ? "read-only" : "workspace-write",
      // Skill sets are listed here, not as Codex extra skill roots: from a root, Codex reads a skill it chose with a
      // command that asks for approval under `ask`, and sometimes from a wrong path. See isSkillRead.
      developerInstructions: [this.options.instructions, skillList(setSkills(this.options.skills ?? []))].filter(Boolean).join("\n\n") || null,
      config,
    };
    const dynamicTools = tools && [
      {
        type: "namespace",
        name: tools.name,
        description: tools.description,
        tools: tools.tools.map((appTool) => ({
          type: "function",
          name: appTool.name,
          description: appTool.description,
          inputSchema: z.toJSONSchema(z.object(appTool.input)),
        })),
      },
    ];
    const response = resumeId
      ? await server.rpc.request<ThreadStartResponse>("thread/resume", { threadId: resumeId, excludeTurns: true, ...settings })
      : await server.rpc.request<ThreadStartResponse>("thread/start", { ...settings, ...(dynamicTools && { dynamicTools }) });
    this.threadId = response.thread.id;
    if (this.options.effort) this.settings.effort ??= this.options.effort;
  }

  async models(): Promise<ModelOption[]> {
    const { data } = await (await this.connection()).request<{ data: Model[] }>("model/list", {});
    return data
      .filter((model) => !model.hidden)
      .map((model) => ({
        id: model.model,
        name: model.displayName,
        description: model.description,
        efforts: model.supportedReasoningEfforts.map((option) => option.reasoningEffort),
        defaultEffort: model.defaultReasoningEffort,
        isDefault: model.isDefault,
      }));
  }

  /** Codex skills, and the skills of the session's skill sets as `<set>:<skill>`. `send('/name request')` invokes the skill `name`. */
  async commands(): Promise<CommandOption[]> {
    const sets = setSkills(this.options.skills ?? []);
    const attached = new Set(sets.map((skill) => skill.path));
    const own = (await this.loadSkills()).filter((skill) => !attached.has(skill.path));
    return [
      ...sets.map((skill) => ({ name: skill.command, description: skill.description })),
      ...own.map((skill) => ({ name: skill.name, description: skill.shortDescription ?? skill.description })),
    ];
  }

  async configure(settings: SessionSettings): Promise<void> {
    this.settings = { ...this.settings, ...settings };
  }

  private get rpc(): RpcConnection {
    if (!this.server) throw new Error("Session closed");
    return this.server.rpc;
  }

  /** The connection of the current server, once its thread is ready. */
  private async connection(): Promise<RpcConnection> {
    await this.ready.catch(() => undefined);
    return this.rpc;
  }

  private loadSkills(): Promise<Skill[]> {
    this.skills ??= this.connection()
      .then((rpc) => rpc.request<{ data: { skills: Skill[] }[] }>("skills/list", { cwds: [this.options.cwd] }))
      .then(({ data }) => data.flatMap((entry) => entry.skills).filter((skill) => skill.enabled))
      .catch(() => []);
    return this.skills;
  }

  /**
   * The input of a turn. `/<set>:<skill>` puts the skill's instructions in the turn, as Claude Code does:
   * a Codex skill input only names the file, and the model then reads it with a shell command that may
   * need approval. `/<name>` of a Codex skill sends Codex's own skill input.
   */
  private async input(text: string): Promise<unknown[]> {
    const message = { type: "text", text, text_elements: [] };
    const command = slashCommand(text);
    if (!command) return [message];
    const set = setSkills(this.options.skills ?? []).find((candidate) => candidate.command === command.command);
    if (set) return [{ ...message, text: skillTurn(set, command.rest) }];
    const skill = (await this.loadSkills()).find((candidate) => candidate.name === command.command);
    if (!skill) return [message];
    return [{ type: "skill", name: skill.name, path: skill.path }, { ...message, text: command.rest || `Use the ${skill.name} skill.` }];
  }

  protected async startTurn(text: string): Promise<void> {
    this.turnId = undefined;
    this.turnStarted = false;
    this.finalMessage = "";
    this.lastError = undefined;
    this.usage = { inputTokens: 0, outputTokens: 0 };
    this.items.clear();
    const { model, effort, approval } = this.settings;
    const response = await (await this.connection()).request<{ turn: { id: string } }>("turn/start", {
      threadId: this.threadId,
      input: await this.input(text),
      ...(model !== undefined && { model }),
      ...(effort !== undefined && { effort }),
      ...(approval && this.options.access !== "read-only" && { approvalPolicy: codexApprovalPolicy(approval) }),
    });
    this.turnId ??= response.turn.id;
  }

  protected async interruptTurn(turn: ActiveTurn): Promise<void> {
    if (!this.turnStarted) return;
    await this.requestInterrupt();
    await this.restart(turn);
  }

  /** Stops the server, which stops the commands of the turn, and resumes the thread on a new server. */
  private async restart(turn: ActiveTurn): Promise<void> {
    const old = this.server;
    this.server = undefined;
    await old?.stop();
    if (this.closed) {
      turn.finish({ status: "interrupted", text: this.finalMessage });
      return;
    }
    this.ready = this.open(this.threadId).catch((error) => {
      this.shutdown(`Could not resume the Codex thread: ${error instanceof Error ? error.message : String(error)}`);
    });
    turn.finish({ status: "interrupted", text: this.finalMessage });
    await this.ready;
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.markClosed();
    await server?.stop();
  }

  private async requestInterrupt(): Promise<void> {
    try {
      await this.rpc.request("turn/interrupt", { threadId: this.threadId, turnId: this.turnId });
    } catch {
      // The turn already ended.
    }
  }

  private shutdown(error?: string): void {
    this.server?.rpc.close(new Error(error ?? "Session closed"));
    this.markClosed(error);
  }

  private exitMessage(server: AppServer, code: number | null, signal: NodeJS.Signals | null): string | undefined {
    if (code === 0) return undefined;
    const reason = signal ? `signal ${signal}` : `code ${code}`;
    const detail = server.detail;
    return `codex app-server exited with ${reason}${detail ? `:\n${detail}` : ""}`;
  }

  private handleNotification(method: string, params: unknown): void {
    if ((params as { threadId?: string } | undefined)?.threadId !== this.threadId || !this.currentTurn) return;
    switch (method) {
      case "item/agentMessage/delta":
        this.emit({ type: "text-delta", text: (params as AgentMessageDelta).delta });
        break;
      case "item/reasoning/summaryTextDelta":
        this.emit({ type: "thinking-delta", text: (params as ReasoningDelta).delta });
        break;
      case "item/reasoning/summaryPartAdded":
        if ((params as ReasoningDelta).summaryIndex > 0) this.emit({ type: "thinking-delta", text: "\n\n" });
        break;
      case "item/started":
        this.itemStarted((params as ItemNotification).item);
        break;
      case "item/completed":
        this.itemCompleted((params as ItemNotification).item);
        break;
      case "thread/tokenUsage/updated": {
        const { last } = (params as TokenUsageNotification).tokenUsage;
        this.usage = { inputTokens: this.usage.inputTokens + last.inputTokens, outputTokens: this.usage.outputTokens + last.outputTokens };
        break;
      }
      case "error": {
        const { error, willRetry } = params as ErrorNotification;
        if (!willRetry) this.lastError = error.message;
        break;
      }
      case "turn/started":
        this.turnId ??= (params as TurnNotification).turn.id;
        this.turnStarted = true;
        if (this.currentTurn.interruptRequested) void this.interruptTurn(this.currentTurn);
        break;
      case "turn/completed":
        this.turnCompleted(params as TurnNotification);
        break;
    }
  }

  private itemStarted(item: ThreadItem): void {
    this.items.set(item.id, item);
    // Without an approval request, Codex applies the change without waiting for this call.
    if (item.type === "fileChange" && "changes" in item) void this.beforeFileChange(item.changes.map((change) => this.showPath(change.path)));
    const title = this.describeItem(item);
    if (!title) return;
    const tool = item.type === "dynamicToolCall" && "tool" in item ? `${item.namespace}.${item.tool}` : item.type;
    this.emit({ type: "tool-start", id: item.id, tool, title, ...this.itemDetail(item) });
  }

  private async beforeFileChange(paths: string[]): Promise<void> {
    if (!paths.length) return;
    try {
      await this.options.beforeFileChange?.(paths);
    } catch {
      // The change goes ahead.
    }
  }

  private itemDetail(item: ThreadItem): { detail?: string; paths?: string[] } {
    if (item.type === "commandExecution" && "command" in item) return { detail: unwrapShell(item.command) };
    if (item.type === "fileChange" && "changes" in item) {
      return {
        detail: item.changes.map((change) => change.diff).join("\n"),
        paths: item.changes.map((change) => this.showPath(change.path)),
      };
    }
    return {};
  }

  private itemCompleted(item: ThreadItem): void {
    this.items.set(item.id, item);
    if (item.type === "agentMessage" && "text" in item) {
      this.finalMessage = item.text;
      this.emit({ type: "message", text: item.text });
      return;
    }
    if (item.type === "reasoning" && "summary" in item) {
      const text = item.summary.join("\n\n").trim();
      if (text) this.emit({ type: "thinking", text });
      return;
    }
    if (!this.describeItem(item)) return;
    const status = "status" in item ? item.status : "completed";
    let ok = status === "completed";
    let output: string | undefined;
    if (item.type === "commandExecution" && "command" in item) {
      ok &&= item.exitCode === 0;
      output = item.aggregatedOutput ?? undefined;
    } else if (item.type === "mcpToolCall" && "error" in item) {
      output = item.error?.message;
    } else if (item.type === "dynamicToolCall" && "contentItems" in item) {
      ok = item.success ?? ok;
      output = item.contentItems?.map((content) => content.text ?? "").join("");
    }
    this.emit({ type: "tool-end", id: item.id, ok, output });
  }

  private turnCompleted({ turn }: TurnNotification): void {
    if (this.turnId && turn.id !== this.turnId) return;
    const status = turn.status === "inProgress" ? "failed" : turn.status;
    const error = turn.error?.message ?? (status === "failed" ? this.lastError : undefined);
    this.currentTurn?.finish({ status, text: this.finalMessage, usage: { durationMs: 0, ...this.usage }, ...(error && { error }) });
  }

  private async handleRequest(method: string, params: unknown): Promise<unknown> {
    const signal = this.currentTurn?.controller.signal ?? AbortSignal.abort();
    const ask = (tool: string, kind: "edit" | "command" | "network" | "mcp" | "other", title: string, detail?: string) =>
      askPermission(this.options.onPermission, { tool, kind, title, detail, raw: params, signal });

    switch (method) {
      case "item/commandExecution/requestApproval": {
        const request = params as CommandApprovalParams;
        const network = request.networkApprovalContext;
        // Reading a skill of the session's skill sets is part of using it, as the Skill tool is for Claude Code.
        const folders = (this.options.skills ?? []).map((root) => join(root, "skills"));
        if (!network && request.command && isSkillRead(unwrapShell(request.command), folders, this.options.cwd)) return { decision: DECISIONS.allow };
        const detail = [request.command, request.reason && `Reason: ${request.reason}`].filter(Boolean).join("\n");
        const title = network ? `Connect to ${network.host}` : request.command ? `Run ${unwrapShell(request.command)}` : "Run a command";
        const decision = await ask("command", network ? "network" : "command", title, detail);
        return { decision: DECISIONS[decision] };
      }
      case "item/fileChange/requestApproval": {
        const request = params as FileChangeApprovalParams;
        const item = this.items.get(request.itemId);
        const changes = item && "changes" in item ? item.changes : [];
        const paths = changes.map((change) => this.showPath(change.path));
        const detail = [request.reason, ...changes.map((change) => change.diff)].filter(Boolean).join("\n");
        await this.beforeFileChange(paths);
        const decision = await ask("fileChange", "edit", `Edit ${paths.join(", ") || "files"}`, detail);
        return { decision: DECISIONS[decision] };
      }
      case "item/permissions/requestApproval": {
        const request = params as PermissionsApprovalParams;
        const { network, fileSystem } = request.permissions;
        const kind = network?.enabled ? "network" : fileSystem?.write?.length ? "edit" : "other";
        const detail = [request.reason, JSON.stringify(request.permissions, null, 2)].filter(Boolean).join("\n");
        const decision = await ask("permissions", kind, "Grant extra permissions", detail);
        if (decision === "deny") return { permissions: {}, scope: "turn" };
        return {
          permissions: { ...(network && { network }), ...(fileSystem && { fileSystem }) },
          scope: decision === "allow-session" ? "session" : "turn",
        };
      }
      case "item/tool/call": {
        const call = params as DynamicToolCallParams;
        const appTool = call.namespace === this.options.tools?.name ? this.appTools.get(call.tool) : undefined;
        const { text, isError } = appTool
          ? await runTool(appTool, call.arguments, signal)
          : { text: `Unknown tool ${call.namespace}.${call.tool}`, isError: true };
        return { contentItems: [{ type: "inputText", text }], success: !isError };
      }
      case "mcpServer/elicitation/request": {
        // A confirmation without fields can be allowed. Forms and URL requests are declined.
        const request = params as ElicitationParams;
        const needsAnswers = request.mode === "url" || (request.requestedSchema?.required?.length ?? 0) > 0;
        const decision = needsAnswers ? "deny" : await ask(request.serverName, "mcp", request.message);
        return decision === "deny" ? { action: "decline", content: null, _meta: null } : { action: "accept", content: {}, _meta: null };
      }
      default:
        throw new RpcError(-32601, `yami does not support ${method}`);
    }
  }

  private describeItem(item: ThreadItem): string | undefined {
    switch (item.type) {
      case "commandExecution":
        return "command" in item ? unwrapShell(item.command) : "command";
      case "fileChange":
        return "changes" in item ? `Edit ${item.changes.map((change) => this.showPath(change.path)).join(", ")}` : "Edit files";
      case "mcpToolCall":
        return "server" in item ? `${item.server}.${item.tool}` : "MCP tool";
      case "webSearch":
        return "query" in item && item.query ? `Search: ${item.query}` : "Web search";
      case "dynamicToolCall": {
        if (!("tool" in item)) return "Tool";
        const appTool = item.namespace === this.options.tools?.name ? this.appTools.get(item.tool) : undefined;
        return appTool?.title?.(item.arguments as never) ?? item.tool;
      }
      default:
        return undefined;
    }
  }
}

/** Codex runs commands as `/bin/zsh -lc '<command>'`. Titles show the inner command. */
export function unwrapShell(command: string): string {
  const match = command.match(/^\S*\/(?:ba|z)?sh -l?c (['"])([\s\S]*)\1$/);
  return match?.[2] ?? command;
}

function run(file: string, args: string[], env: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
    child.once("error", reject);
    child.once("close", () => resolve(output.trim()));
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

/**
 * Returns the native Codex binary, and adds the binary's own `codex-path`
 * folder to `env.PATH`. An npm launcher (`codex.js`) needs Node on `PATH`, so
 * the lookup follows it into its package. Throws when there is no Codex.
 */
export function findCodexExecutable(env: Record<string, string> = process.env as Record<string, string>): string {
  for (const candidate of findExecutables("codex", env)) {
    const real = realpathSync(candidate);
    const native = real.endsWith(".js") ? npmNativeBinary(dirname(dirname(real))) : real;
    if (!native) continue;
    const pathDir = join(dirname(dirname(native)), "codex-path");
    if (existsSync(pathDir)) env.PATH = [pathDir, env.PATH].filter(Boolean).join(delimiter);
    return native;
  }
  throw new Error("Could not find the 'codex' executable. Install Codex, or set executablePath to its full path.");
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
