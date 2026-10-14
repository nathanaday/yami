import { accessSync, constants, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import {
  query,
  type Options,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
  type SettingSource,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  Harness,
  HarnessInfo,
  Preferences,
  Session,
  SessionEvent,
  SessionListener,
  TurnResult,
} from "./types.js";

export interface ClaudeOptions {
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
}

const TOOLS = {
  "read-only": ["Read", "Glob", "Grep"],
  edit: ["Read", "Glob", "Grep", "Write", "Edit"],
};

export class ClaudeHarness implements Harness {
  readonly name = "claude";
  readonly executable: string | undefined;

  constructor(private readonly options: ClaudeOptions = {}) {
    this.executable = options.executable ?? findClaudeExecutable();
  }

  async connect(preferences: Preferences): Promise<HarnessInfo> {
    const input = new InputQueue();
    const run = query({ prompt: input, options: this.toOptions(preferences) });
    try {
      const init = await run.initializationResult();
      return {
        harness: this.name,
        version: init.claude_code_version ?? "unknown",
        account: {
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

  openSession(preferences: Preferences): Session {
    return new ClaudeSession(this.toOptions(preferences));
  }

  private toOptions(preferences: Preferences): Options {
    const access = preferences.access ?? "read-only";
    return {
      cwd: preferences.cwd,
      model: preferences.model,
      effort: preferences.effort,
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
      env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: "yami", ...this.options.env },
    };
  }
}

export function claude(options?: ClaudeOptions): ClaudeHarness {
  return new ClaudeHarness(options);
}

/**
 * Searches `PATH` and the standard install folders. A GUI app such as Obsidian
 * often starts with a short `PATH` that omits the folder of the CLI.
 */
export function findClaudeExecutable(): string | undefined {
  const name = process.platform === "win32" ? "claude.exe" : "claude";
  const home = homedir();
  const folders = [
    ...(process.env.PATH ?? "").split(delimiter),
    join(home, ".local", "bin"),
    join(home, ".claude", "local"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
  for (const folder of folders) {
    if (!folder) continue;
    const candidate = join(folder, name);
    if (isExecutable(candidate)) return candidate;
  }
  return undefined;
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

class ClaudeSession implements Session {
  id: string | undefined;
  closed = false;
  private readonly input = new InputQueue();
  private readonly listeners = new Set<SessionListener>();
  private readonly run: Query;
  private turn:
    | { resolve(result: TurnResult): void; reject(error: Error): void; interrupted: boolean }
    | undefined;

  constructor(options: Options) {
    this.run = query({ prompt: this.input, options });
    void this.read();
  }

  send(prompt: string): Promise<TurnResult> {
    if (this.closed) return Promise.reject(new Error("The session is closed."));
    if (this.turn) {
      return Promise.reject(new Error("A turn is already running. Wait for it to end, or call interrupt()."));
    }
    return new Promise((resolve, reject) => {
      this.turn = { resolve, reject, interrupted: false };
      this.input.push({
        type: "user",
        message: { role: "user", content: prompt },
        parent_tool_use_id: null,
      });
    });
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async interrupt(): Promise<void> {
    if (!this.turn || this.closed) return;
    this.turn.interrupted = true;
    await this.run.interrupt();
  }

  close(): void {
    this.finish();
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
        if (message.subtype === "init" && !this.id) {
          this.id = message.session_id;
          this.emit({ type: "ready", sessionId: message.session_id, model: message.model, tools: message.tools });
        }
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
            output: textOf(block.content),
          });
        }
        return;
      case "result": {
        const success = message.subtype === "success";
        const result: TurnResult = {
          status: this.turn?.interrupted ? "interrupted" : success && !message.is_error ? "success" : "error",
          text: success ? message.result : "",
          errors: success ? [] : message.errors,
          costUsd: message.total_cost_usd,
          durationMs: message.duration_ms,
        };
        this.emit({ type: "turn-end", result });
        const turn = this.turn;
        this.turn = undefined;
        turn?.resolve(result);
        return;
      }
    }
  }

  private finish(error?: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.input.end();
    this.run.close();
    this.turn?.reject(error ?? new Error("The session closed before the turn ended."));
    this.turn = undefined;
    this.emit({ type: "closed", error });
  }

  private emit(event: SessionEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        queueMicrotask(() => {
          throw error;
        });
      }
    }
  }
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (block?.type === "text" ? block.text : `[${block?.type}]`))
    .join("\n");
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
