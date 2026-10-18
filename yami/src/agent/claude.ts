import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import {
  type CanUseTool,
  createSdkMcpServer,
  type EffortLevel,
  type HookCallback,
  type HookCallbackMatcher,
  type McpServerConfig,
  type Options,
  type PermissionMode,
  type PermissionResult,
  type Query,
  query,
  type SDKControlInitializeResponse,
  type SDKMessage,
  type SDKUserMessage,
  type SettingSource,
  tool,
} from "@anthropic-ai/claude-agent-sdk/core";
import { Agent, type AgentPreferences, type SessionStart } from "./agent.js";
import { claudePermissionMode } from "./approval.js";
import { AsyncQueue } from "./async-queue.js";
import { lineDiff } from "./diff.js";
import { findExecutables, harnessEnv, pathDisplay } from "./executable.js";
import { askPermission, BaseSession } from "./session.js";
import { setAgents } from "./skills.js";
import {
  type AgentInfo,
  type AgentSession,
  type AgentTool,
  type CommandOption,
  type ModelOption,
  type PermissionKind,
  type Question,
  type QuestionAnswers,
  errorText,
  runTool,
  toolTitle,
  type SessionOptions,
  type SessionSettings,
  type ToolSet,
} from "./types.js";

export interface ClaudeSessionOptions extends SessionOptions {
  /**
   * Claude Code settings to load: `user` (`~/.claude`), `project` (`.claude/`
   * and `CLAUDE.md` in `cwd`), and `local`. Defaults to all three. Without
   * `user`, the session loads no MCP servers.
   */
  settingSources?: SettingSource[];
  /** Cost limit for the session. The turn that passes it ends with status `failed`. */
  maxBudgetUsd?: number;
  /** Extra Agent SDK options. They override the adapter's defaults. */
  sdkOptions?: Partial<Options>;
}

export interface ClaudePreferences extends AgentPreferences {
  maxBudgetUsd?: number;
}

export interface ClaudeAgentOptions {
  /**
   * Path to the Claude Code CLI. Defaults to the first `claude` on `PATH` or in
   * a standard install folder, then to the binary in the SDK package. A bundled
   * host, such as an Obsidian plugin, cannot use the SDK binary.
   */
  executable?: string;
  /** Variables added to the CLI environment, for example `CLAUDE_CONFIG_DIR`. */
  env?: Record<string, string>;
  settingSources?: SettingSource[];
  sdkOptions?: Partial<Options>;
  preferences?: ClaudePreferences;
}

const STDERR_LIMIT = 4096;
/**
 * A read-only session's tools. Bash runs in the sandbox of `readOnlySandbox`, which writes only in `/tmp`.
 * A subagent inherits its parent's tools and sandbox, so its workers are read-only too.
 */
const READ_ONLY_TOOLS = ["Read", "Glob", "Grep", "Bash", "WebSearch", "WebFetch", "Agent"];
const READ_ONLY_DENIAL = "This session is read-only, so it asks for nothing. Run only commands that read or check, one at a time, such as git log or the tests.";
const FILE_TOOLS = new Set(["Read", "Edit", "Write", "NotebookEdit"]);
/** Built-in tools that change a file, matched by a PreToolUse hook. */
const FILE_CHANGE_TOOLS = "Edit|MultiEdit|Write|NotebookEdit";
/** Approval modes that can approve a waiting request without the user, and the tools that each one approves. */
const APPROVING_MODES: Partial<Record<PermissionMode, (tool: string) => boolean>> = {
  acceptEdits: (tool) => FILE_CHANGE_TOOLS.split("|").includes(tool),
  auto: () => true,
};
const RETRY_MESSAGE = "Not run yet: the user changed the approval mode while this request waited. Make the same tool call again.";
/** With no stream event for this long inside a content block, the reply has stalled. */
const STALL_MS = 60_000;
/** After a stall, the time the CLI has to end the turn before the session closes. */
const STALL_GRACE_MS = 10_000;
const STALL_MESSAGE = "Claude sent no output for 60 s in the middle of a reply, so Yami stopped the turn.";

export class ClaudeAgent extends Agent<ClaudePreferences> {
  readonly harness = "claude";

  constructor(private readonly options: ClaudeAgentOptions = {}) {
    super(options.preferences);
  }

  async connect(): Promise<AgentInfo> {
    const session = await startClaudeSession(this.toOptions({ ...this.preferences }));
    try {
      const init = session.info!;
      return {
        harness: this.harness,
        version: init.claude_code_version ?? "unknown",
        account: {
          login: init.account.apiKeySource ?? init.account.tokenSource ?? init.account.apiProvider,
          email: init.account.email,
          organization: init.account.organization,
          subscription: init.account.subscriptionType,
        },
      };
    } finally {
      await session.close();
    }
  }

  protected createSession(options: ClaudePreferences & SessionStart<ClaudePreferences>): Promise<AgentSession> {
    return startClaudeSession(this.toOptions(options));
  }

  private toOptions(options: ClaudePreferences & SessionStart<ClaudePreferences>): ClaudeSessionOptions {
    return {
      ...this.sessionOptions(options),
      executablePath: this.options.executable,
      env: this.options.env,
      settingSources: this.options.settingSources,
      sdkOptions: this.options.sdkOptions,
      maxBudgetUsd: options.maxBudgetUsd,
    };
  }
}

export async function startClaudeSession(options: ClaudeSessionOptions): Promise<ClaudeSession> {
  const env = await harnessEnv({ CLAUDE_AGENT_SDK_CLIENT_APP: options.clientName, ...options.env });
  const executable = options.executablePath ?? findExecutables("claude", env, [join(homedir(), ".claude", "local")])[0];
  const session = new ClaudeSession(options, env, executable);
  try {
    await session.start();
  } catch (error) {
    await session.close();
    throw error;
  }
  return session;
}

export class ClaudeSession extends BaseSession {
  readonly harness = "claude";
  readonly id: string;
  /** The CLI's answer to initialization: version, account, models. Set by `start`. */
  info: SDKControlInitializeResponse | undefined;
  private readonly input = new AsyncQueue<SDKUserMessage>();
  private readonly query: Query;
  private finalMessage = "";
  private costUsd: number | undefined;
  /** Claude Code ignores an interrupt that arrives before it reads the user message. */
  private turnStarted = false;
  private stderr = "";
  private readonly showPath: (file: string) => string;
  private readonly appTools = new Map<string, AgentTool>();
  /** Approval requests that wait for the user, by tool name. Aborting one sends the request back to Claude Code. */
  private readonly waiting = new Map<AbortController, string>();
  /** The user's answers to questions, by tool use id, as `question → answer` lines for the `tool-end` event. */
  private readonly answers = new Map<string, string>();
  private stallTimer: ReturnType<typeof setTimeout> | undefined;
  private stalled = false;

  constructor(
    private readonly options: ClaudeSessionOptions,
    env: Record<string, string>,
    executable: string | undefined,
  ) {
    super();
    this.id = options.resume ?? randomUUID();
    this.showPath = pathDisplay(options.cwd);
    const { tools } = options;
    for (const appTool of tools?.tools ?? []) this.appTools.set(`mcp__${tools!.name}__${appTool.name}`, appTool);
    const readOnly = options.access === "read-only";
    const settingSources = options.settingSources ?? ["user", "project", "local"];
    const unsandboxed = readOnly && settingSources.includes("user") ? unsandboxedCommands(env) : [];
    const hidden = [...setAgents(options.skills ?? []).map((name) => `Agent(${name})`), ...unsandboxed.map((pattern) => `Bash(${pattern})`)];
    this.query = query({
      prompt: this.input,
      options: {
        cwd: options.cwd,
        env,
        pathToClaudeCodeExecutable: executable,
        model: options.model,
        ...(options.effort && { effort: options.effort as EffortLevel }),
        maxBudgetUsd: options.maxBudgetUsd,
        settings: { showThinkingSummaries: true },
        settingSources,
        strictMcpConfig: readOnly || !settingSources.includes("user"),
        permissionMode: claudePermissionMode(options.approval ?? "ask"),
        ...(tools && { mcpServers: { [tools.name]: this.toolServer(tools) } }),
        ...(options.instructions && {
          systemPrompt: { type: "preset", preset: "claude_code", append: options.instructions },
        }),
        includePartialMessages: true,
        canUseTool: this.canUseTool,
        stderr: (data) => {
          this.stderr = (this.stderr + data).slice(-STDERR_LIMIT);
        },
        ...(options.resume ? { resume: options.resume } : { sessionId: this.id }),
        ...options.sdkOptions,
        // Read-only is a limit, so it comes after the host's options. The Skill tool is not a built-in tool of the list; the skills option turns it on.
        ...(readOnly && { tools: READ_ONLY_TOOLS, skills: "all" as const, sandbox: readOnlySandbox(options.cwd ?? process.cwd()) }),
        ...(tools &&
          options.sdkOptions?.mcpServers && {
            mcpServers: { ...options.sdkOptions.mcpServers, [tools.name]: this.toolServer(tools) },
          }),
        // A skill set is a plugin folder: Claude Code names it by the folder and finds its skills in skills/.
        // It would also load each .md under agents/ as a subagent, so the session denies them: a set lends its skills only.
        ...(options.skills?.length && {
          plugins: [...(options.sdkOptions?.plugins ?? []), ...options.skills.map((path) => ({ type: "local" as const, path, skipMcpDiscovery: true }))],
        }),
        ...(hidden.length && { disallowedTools: [...(options.sdkOptions?.disallowedTools ?? []), ...hidden] }),
        ...(options.beforeFileChange && {
          hooks: {
            ...options.sdkOptions?.hooks,
            PreToolUse: [...(options.sdkOptions?.hooks?.PreToolUse ?? []), this.fileChangeHook()],
          },
        }),
      },
    });
  }

  /** Runs `beforeFileChange` before a built-in tool changes a file. Claude Code waits for the hook. */
  private fileChangeHook(): HookCallbackMatcher {
    const hook: HookCallback = async (input) => {
      if (input.hook_event_name !== "PreToolUse") return {};
      const { file_path: file, notebook_path: notebook } = (input.tool_input ?? {}) as Record<string, unknown>;
      const path = typeof file === "string" ? file : typeof notebook === "string" ? notebook : undefined;
      if (path) {
        try {
          await this.options.beforeFileChange?.([this.showPath(path)]);
        } catch {
          // The change goes ahead.
        }
      }
      return {};
    };
    return { matcher: FILE_CHANGE_TOOLS, hooks: [hook] };
  }

  private toolServer(tools: ToolSet): McpServerConfig {
    return createSdkMcpServer({
      name: tools.name,
      instructions: tools.description,
      alwaysLoad: true,
      tools: tools.tools.map((appTool) =>
        tool(appTool.name, appTool.description, appTool.input, async (input) => {
          const signal = this.currentTurn?.controller.signal ?? AbortSignal.abort();
          const { text, isError } = await runTool(appTool, input, signal);
          return { content: [{ type: "text", text }], isError };
        }),
      ),
    });
  }

  async start(): Promise<void> {
    const pump = this.pump();
    this.info = await Promise.race([
      this.query.initializationResult(),
      pump.then(() => {
        throw new Error(this.closeMessage("Claude Code exited during startup"));
      }),
    ]);
  }

  protected async startTurn(text: string): Promise<void> {
    this.finalMessage = "";
    this.costUsd = undefined;
    this.turnStarted = false;
    this.stalled = false;
    this.input.push({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
    });
  }

  protected async interruptTurn(): Promise<void> {
    if (this.turnStarted) await this.query.interrupt().catch(() => undefined);
  }

  async close(): Promise<void> {
    clearTimeout(this.stallTimer);
    this.markClosed();
    this.input.end();
    this.query.close();
  }

  async models(): Promise<ModelOption[]> {
    const models = await this.query.supportedModels();
    return models.map((model, index) => ({
      id: model.value,
      name: model.displayName,
      description: model.description,
      efforts: model.supportsEffort ? (model.supportedEffortLevels ?? []) : [],
      isDefault: index === 0,
    }));
  }

  async commands(): Promise<CommandOption[]> {
    const commands = await this.query.supportedCommands();
    return commands.map(({ name, description, argumentHint }) => ({ name, description, ...(argumentHint && { argumentHint }) }));
  }

  async configure(settings: SessionSettings): Promise<void> {
    if (settings.model !== undefined) await this.query.setModel(settings.model ?? undefined);
    if (settings.effort !== undefined) await this.query.applyFlagSettings({ effortLevel: (settings.effort as EffortLevel) ?? null });
    if (settings.approval) {
      const mode = claudePermissionMode(settings.approval);
      await this.query.setPermissionMode(mode);
      const approves = APPROVING_MODES[mode];
      if (approves) for (const [retry, tool] of this.waiting) if (approves(tool)) retry.abort();
    }
  }

  private async pump(): Promise<void> {
    let error: string | undefined;
    try {
      for await (const message of this.query) {
        try {
          this.handle(message);
        } catch (thrown) {
          // A fault of the adapter, not of Claude Code: the reason says where, and the session closes.
          error = `Yami could not read a message of Claude Code: ${errorText(thrown)}`;
          this.input.end();
          this.query.close();
          break;
        }
      }
    } catch (thrown) {
      error = this.closeMessage(thrown instanceof Error ? thrown.message : String(thrown));
    }
    clearTimeout(this.stallTimer);
    this.markClosed(error ?? (this.closed ? undefined : this.closeMessage("Claude Code exited")));
  }

  private closeMessage(reason: string): string {
    const detail = this.stderr.trim().split("\n").slice(-5).join("\n");
    return detail ? `${reason}:\n${detail}` : reason;
  }

  private handle(message: SDKMessage): void {
    const turn = this.currentTurn;
    if (turn && !this.turnStarted && isTurnStart(message)) {
      this.turnStarted = true;
      if (turn.interruptRequested) void this.query.interrupt().catch(() => undefined);
    }
    if ("parent_tool_use_id" in message && message.parent_tool_use_id !== null) return;
    switch (message.type) {
      case "stream_event": {
        const { event } = message;
        this.watch(event.type);
        if (event.type !== "content_block_delta") break;
        if (event.delta.type === "text_delta") this.emit({ type: "text-delta", text: event.delta.text });
        else if (event.delta.type === "thinking_delta") this.emit({ type: "thinking-delta", text: event.delta.thinking });
        break;
      }
      case "assistant":
        for (const block of message.message.content) {
          if (block.type === "text") {
            this.finalMessage = block.text;
            this.emit({ type: "message", text: block.text });
          } else if (block.type === "thinking") {
            if (block.thinking) this.emit({ type: "thinking", text: block.thinking });
          } else if (block.type === "tool_use") {
            this.emit({ type: "tool-start", id: block.id, ...this.toolSummary(block.name, block.input as Record<string, unknown>) });
          }
        }
        break;
      case "user": {
        const { content } = message.message;
        if (typeof content === "string") break;
        for (const block of content) {
          if (block.type !== "tool_result") continue;
          const answers = this.answers.get(block.tool_use_id);
          this.answers.delete(block.tool_use_id);
          this.emit({
            type: "tool-end",
            id: block.tool_use_id,
            ok: !block.is_error,
            output: (!block.is_error && answers) || toolResultText(block.content),
          });
        }
        break;
      }
      case "result":
        this.watch("message_stop");
        this.costUsd = message.total_cost_usd;
        this.finishTurn(message);
        break;
    }
  }

  private finishTurn(message: Extract<SDKMessage, { type: "result" }>): void {
    const turn = this.currentTurn;
    if (!turn) return;
    const { input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens } = message.usage;
    const usage = {
      durationMs: message.duration_ms,
      inputTokens: input_tokens + (cache_read_input_tokens ?? 0) + (cache_creation_input_tokens ?? 0),
      outputTokens: output_tokens,
      costUsd: this.costUsd,
    };
    if (this.stalled) {
      turn.finish({ status: "failed", text: this.finalMessage, error: STALL_MESSAGE, usage });
    } else if (turn.interruptRequested) {
      turn.finish({ status: "interrupted", text: this.finalMessage, usage });
    } else if (message.subtype === "success" && !message.is_error) {
      turn.finish({ status: "completed", text: message.result, usage });
    } else {
      const error = message.subtype === "success" ? message.result : message.errors.join("\n") || message.subtype;
      turn.finish({ status: "failed", text: this.finalMessage, error, usage });
    }
  }

  /**
   * Times the gaps between stream events while a content block streams. Time
   * to the first token, tool runs, and waits between messages are not timed.
   */
  private watch(eventType: string): void {
    clearTimeout(this.stallTimer);
    this.stallTimer = eventType.startsWith("content_block") ? setTimeout(() => this.stall(), STALL_MS) : undefined;
  }

  private stall(): void {
    this.stalled = true;
    this.query.interrupt().catch(() => undefined);
    this.stallTimer = setTimeout(() => {
      this.markClosed(STALL_MESSAGE);
      this.input.end();
      this.query.close();
    }, STALL_GRACE_MS);
  }

  private readonly canUseTool: CanUseTool = async (toolName, input, { signal, suggestions, toolUseID }) => {
    if (this.appTools.has(toolName)) return { behavior: "allow", updatedInput: input };
    // Claude Code asks before some commands in its sandbox too, such as a loop, and before a command that its settings run outside it.
    if (this.options.access === "read-only") return { behavior: "deny", message: READ_ONLY_DENIAL };
    if (toolName === "AskUserQuestion") return this.askQuestions(input, signal, toolUseID);
    // A new approval mode can approve this request. Claude Code decides again when the agent retries it.
    const retry = new AbortController();
    const retried = new Promise<"retry">((resolve) => retry.signal.addEventListener("abort", () => resolve("retry")));
    this.waiting.set(retry, toolName);
    const decision = await Promise.race([
      askPermission(this.options.onPermission, {
        tool: toolName,
        kind: permissionKind(toolName),
        title: this.describeTool(toolName, input),
        detail: this.toolDetail(toolName, input),
        raw: input,
        signal: AbortSignal.any([signal, retry.signal]),
      }),
      retried,
    ]).finally(() => this.waiting.delete(retry));
    if (decision === "retry") return { behavior: "deny", message: RETRY_MESSAGE };
    const result: PermissionResult =
      decision === "deny"
        ? { behavior: "deny", message: "The user denied this action." }
        : {
            behavior: "allow",
            updatedInput: input,
            // The rule applies to this session only, never to the user's settings files.
            ...(decision === "allow-session" &&
              suggestions && { updatedPermissions: suggestions.map((suggestion) => ({ ...suggestion, destination: "session" as const })) }),
          };
    return result;
  };

  private async askQuestions(input: Record<string, unknown>, signal: AbortSignal, toolUseID: string): Promise<PermissionResult> {
    const { onQuestion } = this.options;
    if (!onQuestion) return { behavior: "deny", message: "This app cannot show questions. Ask them in your reply instead." };
    const questions = (Array.isArray(input.questions) ? input.questions : []) as Question[];
    let answers: QuestionAnswers | undefined;
    try {
      answers = await onQuestion({ questions, signal });
    } catch {
      answers = undefined;
    }
    if (!answers || !Object.keys(answers).length) return { behavior: "deny", message: "The user closed the questions without answering." };
    const lines = questions.filter(({ question }) => answers[question]).map(({ question }) => `${question} → ${answers[question]!.replace(/\s+/g, " ")}`);
    this.answers.set(toolUseID, lines.join("\n"));
    return { behavior: "allow", updatedInput: { ...input, answers } };
  }

  private toolSummary(name: string, input: Record<string, unknown>) {
    const filePath = typeof input.file_path === "string" ? input.file_path : input.notebook_path;
    return {
      tool: name,
      title: this.describeTool(name, input),
      detail: this.appTools.has(name) ? undefined : this.toolDetail(name, input),
      ...(FILE_TOOLS.has(name) && typeof filePath === "string" && { paths: [this.showPath(filePath)] }),
    };
  }

  private describeTool(name: string, input: unknown): string {
    const appTool = this.appTools.get(name);
    if (appTool) return toolTitle(appTool, input);
    const fields = (input ?? {}) as Record<string, unknown>;
    if (name === "AskUserQuestion") return "Asked you questions";
    // A subagent's title names its type, so the record shows which agent did the work.
    if (name === "Agent" && typeof fields.subagent_type === "string") return `Agent ${fields.subagent_type}: ${String(fields.description ?? "")}`.trim();
    if (typeof fields.file_path === "string") return `${name} ${this.showPath(fields.file_path)}`;
    const subject = fields.command ?? fields.pattern ?? fields.url ?? fields.description;
    return typeof subject === "string" ? `${name} ${subject}` : name;
  }

  private toolDetail(name: string, input: Record<string, unknown>): string | undefined {
    if (name === "Bash" && typeof input.command === "string") return input.command;
    if (name === "Edit" && typeof input.old_string === "string" && typeof input.new_string === "string") {
      return lineDiff(input.old_string, input.new_string);
    }
    if (name === "Write" && typeof input.content === "string") {
      return input.content.split("\n").map((line) => `+${line}`).join("\n");
    }
    if (name === "AskUserQuestion" && Array.isArray(input.questions)) {
      return (input.questions as Question[]).map((question) => question.question).join("\n");
    }
    if (name === "Read" || name === "Glob" || name === "Grep") return undefined;
    return JSON.stringify(input, null, 2);
  }
}

/**
 * Commands of a read-only session run in Claude Code's sandbox and may not leave it. A setting of the user
 * or the project, such as an `Edit(…)` allow rule or `sandbox.filesystem.allowWrite`, can let the sandbox
 * write a folder; a denial wins over it. So the sandbox denies every folder of the root but `/tmp` (where
 * Claude Code keeps its own temporary folder) and `/dev` (for `/dev/null`), and the working directory and
 * the home folder by name. Where Claude Code has no sandbox, the session does not start.
 */
function readOnlySandbox(cwd: string): Options["sandbox"] {
  const children = (folder: string) => (existsSync(folder) ? readdirSync(folder).map((name) => join(folder, name)) : []);
  const open = new Set(["/tmp", "/dev", "/private", "/private/tmp"]);
  const denyWrite = [cwd, homedir(), ...[...children("/"), ...children("/private")].filter((folder) => !open.has(folder))];
  return { enabled: true, failIfUnavailable: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false, filesystem: { denyWrite } };
}

/**
 * The commands that the user's Claude Code settings run outside the sandbox, `sandbox.excludedCommands`,
 * as Bash rule patterns. Claude Code runs one without asking when an allow rule matches, so a read-only
 * session denies them. It ignores the project's list once the sandbox may not be left.
 */
function unsandboxedCommands(env: Record<string, string>): string[] {
  try {
    const listed = JSON.parse(readFileSync(join(env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "settings.json"), "utf8"))?.sandbox?.excludedCommands;
    return Array.isArray(listed) ? listed.filter((pattern): pattern is string => typeof pattern === "string") : [];
  } catch {
    return [];
  }
}

function permissionKind(toolName: string): PermissionKind {
  if (toolName.startsWith("mcp__")) return "mcp";
  if (["Read", "Glob", "Grep", "LS", "NotebookRead"].includes(toolName)) return "read";
  if (["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(toolName)) return "edit";
  if (toolName === "Bash") return "command";
  if (toolName === "WebFetch" || toolName === "WebSearch") return "network";
  return "other";
}

function isTurnStart(message: SDKMessage): boolean {
  return (
    (message.type === "system" && message.subtype === "init") ||
    message.type === "stream_event" ||
    message.type === "assistant" ||
    message.type === "result"
  );
}

function toolResultText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  return (content as unknown[]).map((part) => (part && typeof part === "object" && "text" in part ? String(part.text) : "")).join("");
}
