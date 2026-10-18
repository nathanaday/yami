import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
import { createScratch, removeScratch, SCRATCH_PARENT, scratchEnv, sessionInstructions } from "./scratch.js";
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
 * A read-only session's tools. Bash runs in the sandbox of `readOnlySandbox`, which writes only in the session's scratch folder.
 * A subagent inherits its parent's tools and sandbox, so its workers are read-only too.
 */
const READ_ONLY_TOOLS = ["Read", "Glob", "Grep", "Bash", "WebSearch", "WebFetch", "Agent"];
const READ_ONLY_DENIAL = "This session is read-only, so it asks for nothing. Run only commands that read or check, such as git log or the tests.";
const UNSANDBOXED_DENIAL = "The user's settings run this command outside the sandbox, so a read-only session does not run it.";
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
  // On an interrupt, Claude Code moves a running command to the background, where it outlives the turn and the run.
  const env = await harnessEnv({ CLAUDE_AGENT_SDK_CLIENT_APP: options.clientName, CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1", ...options.env });
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
  /** The one folder that a read-only session's commands write. It goes when the CLI exits. */
  private readonly scratch: string | undefined;
  /** Settles when the CLI's messages end, so when it has exited. */
  private pumped: Promise<void> = Promise.resolve();
  /** The commands that the user's settings run outside the sandbox, as Bash rule patterns. A read-only session denies them. */
  private readonly unsandboxed: string[];

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
    const cwd = options.cwd ?? process.cwd();
    const binding = readOnly ? bindingSettings(env, settingSources, cwd) : [];
    refuseWideWrites(binding, cwd);
    this.unsandboxed = binding.flatMap(({ settings }) => strings(settings.sandbox?.excludedCommands));
    const hidden = [...setAgents(options.skills ?? []).map((name) => `Agent(${name})`), ...this.unsandboxed.map((pattern) => `Bash(${pattern})`)];
    this.scratch = readOnly ? createScratch() : undefined;
    const instructions = sessionInstructions(options.instructions, readOnly);
    this.query = query({
      prompt: this.input,
      options: {
        cwd: options.cwd,
        // Claude Code keeps its own temporary folder in CLAUDE_CODE_TMPDIR, and gives sandboxed commands a TMPDIR in it. It
        // does so only for a path spelled under /tmp: for /private/tmp, the commands get /tmp/claude-<uid>, which the sandbox denies.
        env: this.scratch ? { ...env, ...scratchEnv(this.scratch), CLAUDE_CODE_TMPDIR: this.scratch } : env,
        pathToClaudeCodeExecutable: executable,
        model: options.model,
        ...(options.effort && { effort: options.effort as EffortLevel }),
        maxBudgetUsd: options.maxBudgetUsd,
        settings: { showThinkingSummaries: true },
        settingSources,
        strictMcpConfig: readOnly || !settingSources.includes("user"),
        permissionMode: claudePermissionMode(options.approval ?? "ask"),
        ...(tools && { mcpServers: { [tools.name]: this.toolServer(tools) } }),
        ...(instructions && { systemPrompt: { type: "preset", preset: "claude_code", append: instructions } }),
        includePartialMessages: true,
        canUseTool: this.canUseTool,
        stderr: (data) => {
          this.stderr = (this.stderr + data).slice(-STDERR_LIMIT);
        },
        ...(options.resume ? { resume: options.resume } : { sessionId: this.id }),
        ...options.sdkOptions,
        // Read-only is a limit, so it comes after the host's options. The Skill tool is not a built-in tool of the list; the skills option turns it on.
        ...(readOnly && { tools: READ_ONLY_TOOLS, skills: "all" as const, sandbox: readOnlySandbox(this.scratch!, cwd) }),
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
    this.pumped = this.pump();
    this.info = await Promise.race([
      this.query.initializationResult(),
      this.pumped.then(() => {
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
    await this.pumped;
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
    removeScratch(this.scratch);
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
    if (this.options.access === "read-only") {
      // Claude Code asks before some commands that run in its sandbox, such as `VAR=x cmd`, and the sandbox is the limit of
      // such a command. It also asks before a command that the user's settings run outside the sandbox.
      if (toolName !== "Bash") return { behavior: "deny", message: READ_ONLY_DENIAL };
      if (this.leavesSandbox(input.command)) return { behavior: "deny", message: UNSANDBOXED_DENIAL };
      const { dangerouslyDisableSandbox: _, ...command } = input;
      return { behavior: "allow", updatedInput: command };
    }
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

  /** Whether a command names a command that the user's settings run outside the sandbox. It errs toward yes. */
  private leavesSandbox(command: unknown): boolean {
    const words = new Set(String(command ?? "").split(/[^\w.+-]+/));
    return this.unsandboxed.some((pattern) => words.has(pattern.split(/[\s:*(]/)[0]!));
  }

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
 * Commands of a read-only session run in Claude Code's sandbox and may not leave it. They write only the
 * session's scratch folder, which holds Claude Code's own temporary folder too. A setting of the user, such
 * as an `Edit(…)` allow rule or `sandbox.filesystem.allowWrite`, can let the sandbox write a folder, and
 * the sandbox writes the working directory and a few folders of its own by default; a denial wins over
 * each. So the sandbox denies by name every folder beside the scratch folder's path from the root, and the
 * defaults. Where Claude Code has no sandbox, the session does not start. A command reaches only the hosts
 * that the user's settings allow: for any other host, `strictAllowlist` denies it without a request.
 */
function readOnlySandbox(scratch: string, cwd: string): Options["sandbox"] {
  const real = realPath(scratch);
  const defaults = [cwd, homedir(), "/tmp/claude", "/private/tmp/claude"].filter((path) => !holds(realPath(path), real));
  const denyWrite = [...new Set([...defaults, ...foldersBeside([real, "/dev"])])];
  return {
    enabled: true,
    failIfUnavailable: true,
    autoAllowBashIfSandboxed: true,
    allowUnsandboxedCommands: false,
    network: { strictAllowlist: true },
    filesystem: { allowWrite: [scratch], denyWrite },
  };
}

/** Each entry of each folder on the paths from the root to `open` that is not on those paths: what a deny list names to leave only `open`. */
function foldersBeside(open: string[]): string[] {
  const beside: string[] = [];
  const seen = new Set<string>();
  const walk = (folder: string) => {
    if (seen.has(folder)) return;
    seen.add(folder);
    for (const name of entries(folder)) {
      const path = join(folder, name);
      const real = realPath(path);
      if (open.includes(real)) continue;
      if (open.some((target) => holds(real, target))) walk(real);
      else beside.push(path);
    }
  };
  walk("/");
  return beside;
}

function holds(folder: string, path: string): boolean {
  return path === folder || path.startsWith(folder.endsWith("/") ? folder : `${folder}/`);
}

function entries(folder: string): string[] {
  try {
    return readdirSync(folder);
  } catch {
    return [];
  }
}

function realPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** A settings file of Claude Code, with the folder from which it reads a path that starts with one `/`. */
interface SettingsFile {
  file: string;
  root: string;
  settings: { sandbox?: { excludedCommands?: unknown; filesystem?: { allowWrite?: unknown } }; permissions?: { allow?: unknown } };
}

/** Where Claude Code reads its managed settings: `managed-settings.json`, then each file of `managed-settings.d`. */
const MANAGED_FOLDER: Partial<Record<NodeJS.Platform, string>> = { darwin: "/Library/Application Support/ClaudeCode", win32: "C:\\Program Files\\ClaudeCode" };

/**
 * The settings that can widen a read-only session's sandbox: the user's, when the session loads them, and the
 * managed ones. Claude Code ignores the project's and the local ones once the sandbox may not be left, and the
 * adapter's `sandbox` option replaces the host's.
 */
function bindingSettings(env: Record<string, string>, sources: SettingSource[], cwd: string): SettingsFile[] {
  const user = env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  const managed = MANAGED_FOLDER[process.platform] ?? "/etc/claude-code";
  const dropIns = join(managed, "managed-settings.d");
  const files = [
    ...(sources.includes("user") ? [{ file: join(user, "settings.json"), root: user }] : []),
    { file: join(managed, "managed-settings.json"), root: cwd },
    ...entries(dropIns)
      .filter((name) => name.endsWith(".json") && !name.startsWith("."))
      .sort()
      .map((name) => ({ file: join(dropIns, name), root: cwd })),
  ];
  return files.flatMap(({ file, root }) => {
    try {
      const settings = JSON.parse(readFileSync(file, "utf8"));
      return settings && typeof settings === "object" ? [{ file, root, settings }] : [];
    } catch {
      return [];
    }
  });
}

/**
 * Throws when a setting lets the sandbox write a folder that holds the scratch folders, such as `/tmp`. The sandbox
 * denies each folder there that exists when the session starts, so a command could still write a new one.
 */
function refuseWideWrites(files: SettingsFile[], cwd: string): void {
  for (const { file, root, settings } of files) {
    const writes = [
      ...strings(settings.sandbox?.filesystem?.allowWrite).map((raw) => ({ raw, key: "sandbox.filesystem.allowWrite", path: allowWritePath(raw, root) })),
      ...strings(settings.permissions?.allow).flatMap((raw) => {
        const rule = /^Edit\((.+)\)$/.exec(raw.trim());
        return rule ? [{ raw, key: "permissions.allow", path: editRulePath(rule[1]!, root, cwd) }] : [];
      }),
    ];
    for (const { raw, key, path } of writes) {
      const folder = writeRoot(path);
      if (holds(folder, SCRATCH_PARENT) || holds(realPath(folder), realPath(SCRATCH_PARENT))) {
        throw new Error(
          `A read-only session does not start: "${raw}" in ${key} of ${file} lets commands write ${folder}, which holds the session's scratch folder, and the sandbox cannot deny a folder there that does not exist yet. Remove the entry or name a folder that does not hold ${SCRATCH_PARENT}, or give the session access "edit".`,
        );
      }
    }
  }
}

/** A path of `sandbox.filesystem.allowWrite`, as Claude Code reads it: `//` or `/` starts an absolute path, `~` the home folder, and another path is relative to the settings file's folder. */
function allowWritePath(raw: string, root: string): string {
  return raw.startsWith("//") ? raw.slice(1) : resolve(root, withHome(raw));
}

/** A path of an `Edit(…)` rule, as Claude Code reads it: `//` starts an absolute path, `/` a path in the settings file's folder, `~` the home folder, and another path is relative to the working directory. */
function editRulePath(raw: string, root: string, cwd: string): string {
  if (raw.startsWith("//")) return raw.slice(1);
  if (raw.startsWith("/")) return join(root, raw.slice(1));
  return resolve(cwd, withHome(raw));
}

function withHome(path: string): string {
  return path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

/** The folder that a path lets a command write. For a glob, it is the folder before the glob's first segment. */
function writeRoot(path: string): string {
  const glob = path.search(/[*?[{]/);
  if (glob === -1) return resolve(path);
  const prefix = path.slice(0, glob);
  return resolve(prefix.endsWith("/") ? prefix : dirname(prefix));
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
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
