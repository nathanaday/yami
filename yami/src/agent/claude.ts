import { homedir } from "node:os";
import { join } from "node:path";
import {
  query,
  type Options,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
  type SettingSource,
} from "@anthropic-ai/claude-agent-sdk";
import { Agent } from "./agent.js";
import { childEnv, findExecutables } from "./executable.js";
import { contentText, Session } from "./session.js";
import type { AgentInfo, Preferences } from "./types.js";

export interface ClaudePreferences extends Preferences {
  /** Cost limit for the session. The turn that passes it ends with status `error`. */
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
  /** Claude Code settings files to load. Defaults to none. */
  settingSources?: SettingSource[];
  preferences?: ClaudePreferences;
}

/** With no stream event for this long inside a content block, the reply has stalled. */
const STALL_MS = 60_000;
/** After a stall, the time the CLI has to end the turn before the session closes. */
const STALL_GRACE_MS = 10_000;
const STALL_MESSAGE = "Claude sent no output for 60 s in the middle of a reply, so Yami stopped the turn.";

const TOOLS = {
  "read-only": ["Read", "Glob", "Grep"],
  edit: ["Read", "Glob", "Grep", "Write", "Edit"],
};

export class ClaudeAgent extends Agent<ClaudePreferences> {
  readonly harness = "claude";
  readonly executable: string | undefined;

  constructor(private readonly options: ClaudeAgentOptions = {}) {
    super(options.preferences);
    this.executable =
      options.executable ?? findExecutables("claude", [join(homedir(), ".claude", "local")])[0];
  }

  async connect(): Promise<AgentInfo> {
    const input = new InputQueue();
    const run = query({ prompt: input, options: this.toOptions(this.preferences) });
    try {
      const init = await run.initializationResult();
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
      input.end();
      run.close();
    }
  }

  protected createSession(preferences: ClaudePreferences): Session {
    return new ClaudeSession(this.toOptions(preferences));
  }

  private toOptions(preferences: ClaudePreferences): Options {
    const access = preferences.access ?? "read-only";
    return {
      cwd: preferences.cwd,
      model: preferences.model,
      effort: preferences.effort,
      maxBudgetUsd: preferences.maxBudgetUsd,
      includePartialMessages: true,
      systemPrompt: { type: "preset", preset: "claude_code", append: preferences.instructions },
      tools: TOOLS[access],
      permissionMode: access === "edit" ? "acceptEdits" : "default",
      canUseTool: async (toolName) => ({
        behavior: "deny",
        message: `${toolName} is outside what ${access} access allows.`,
      }),
      settingSources: this.options.settingSources ?? [],
      strictMcpConfig: true,
      pathToClaudeCodeExecutable: this.executable,
      env: childEnv({ CLAUDE_AGENT_SDK_CLIENT_APP: "yami", ...this.options.env }),
    };
  }
}

/** Keeps one Claude Code process open and sends each prompt to it. */
class ClaudeSession extends Session {
  private readonly input = new InputQueue();
  private readonly run: Query;
  private stallTimer: ReturnType<typeof setTimeout> | undefined;
  private stalled = false;

  constructor(options: Options) {
    super();
    this.run = query({ prompt: this.input, options });
    void this.read();
  }

  protected startTurn(prompt: string): void {
    this.input.push({
      type: "user",
      message: { role: "user", content: prompt },
      parent_tool_use_id: null,
    });
  }

  protected async stopTurn(): Promise<void> {
    await this.run.interrupt();
  }

  protected dispose(): void {
    clearTimeout(this.stallTimer);
    this.input.end();
    this.run.close();
  }

  private async read(): Promise<void> {
    try {
      for await (const message of this.run) this.handle(message);
      this.finish();
    } catch (error) {
      this.finish(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private handle(message: SDKMessage): void {
    switch (message.type) {
      case "system":
        if (message.subtype === "init") {
          this.ready({ sessionId: message.session_id, model: message.model, tools: message.tools });
        }
        return;
      case "stream_event":
        this.watch(message.event.type);
        return;
      case "assistant":
        if (message.parent_tool_use_id) return;
        for (const block of message.message.content) {
          if (block.type === "text") this.emit({ type: "text", text: block.text });
          if (block.type === "tool_use") this.emit({ type: "tool-call", id: block.id, name: block.name, input: block.input });
        }
        return;
      case "user":
        if (message.parent_tool_use_id || typeof message.message.content === "string") return;
        for (const block of message.message.content) {
          if (block.type !== "tool_result") continue;
          this.emit({
            type: "tool-result",
            id: block.tool_use_id,
            isError: block.is_error ?? false,
            output: contentText(block.content),
          });
        }
        return;
      case "result": {
        this.watch("message_stop");
        const success = message.subtype === "success";
        const errors = success ? (message.is_error ? [message.result] : []) : [...message.errors];
        if (this.stalled) errors.push(STALL_MESSAGE);
        const usage = message.usage;
        this.endTurn({
          status: success && !message.is_error && !this.stalled ? "success" : "error",
          text: success ? message.result : "",
          errors,
          usage: {
            inputTokens: usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens,
            outputTokens: usage.output_tokens,
          },
          costUsd: message.total_cost_usd,
          durationMs: message.duration_ms,
        });
        this.stalled = false;
        return;
      }
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
    this.run.interrupt().catch(() => {});
    this.stallTimer = setTimeout(() => this.finish(new Error(STALL_MESSAGE)), STALL_GRACE_MS);
  }
}

/** The prompt stream of a session. It stays open until `end()`. */
class InputQueue implements AsyncIterable<SDKUserMessage> {
  private readonly items: SDKUserMessage[] = [];
  private ended = false;
  private wake: (() => void) | undefined;

  push(message: SDKUserMessage): void {
    this.items.push(message);
    this.wake?.();
  }

  end(): void {
    this.ended = true;
    this.wake?.();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    while (true) {
      const next = this.items.shift();
      if (next) {
        yield next;
      } else if (this.ended) {
        return;
      } else {
        await new Promise<void>((resolve) => (this.wake = resolve));
      }
    }
  }
}
