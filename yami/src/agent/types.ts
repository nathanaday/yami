import type { z } from "zod";

export type Harness = "claude" | "codex";

/**
 * One approval setting for both harnesses.
 * - `ask`: ask before edits and commands (Claude Code), or before every command (Codex).
 * - `accept-edits`: Claude Code edits files without asking. Codex edits and runs commands inside its sandbox without asking.
 * - `plan`: Claude Code only reads and plans. Codex treats it as `ask`.
 * - `auto`: Claude Code decides which actions are safe to run without asking. Codex treats it as `ask`.
 * - `sandbox`: Codex works freely inside its sandbox. Claude Code treats it as `ask`.
 */
export type ApprovalSetting = "ask" | "accept-edits" | "plan" | "auto" | "sandbox";

export interface SessionOptions {
  /** Working directory of the agent. For the Obsidian plugin, this is the vault root. */
  cwd: string;
  /** Name of the app that drives the session. The harness uses it to identify the client. */
  clientName: string;
  /** Path to the harness binary. When omitted, the adapter looks it up. */
  executablePath?: string;
  /** Variables added to the inherited environment, for example `CLAUDE_CONFIG_DIR`. */
  env?: Record<string, string>;
  model?: string;
  /** Reasoning effort, for example `low`, `medium` or `high`. `AgentSession.models` lists the levels of each model. */
  effort?: string;
  /** Instructions added to the harness's own system prompt. They apply to every turn of a new session. */
  instructions?: string;
  /** When the agent asks before it acts. Default: `ask`. */
  approval?: ApprovalSetting;
  /** Session id from an earlier `AgentSession.id`. The agent continues that conversation. */
  resume?: string;
  /** Called when the agent wants to use a tool that needs approval. With no handler, the session denies the request. */
  onPermission?: PermissionHandler;
  /**
   * Called when the agent asks the user questions, with Claude Code's `AskUserQuestion` tool. Without a handler,
   * the agent is told to ask in its reply. Codex does not ask questions this way.
   */
  onQuestion?: QuestionHandler;
  /** Tools that run inside the app. The agent calls them like its built-in tools, without approval. */
  tools?: ToolSet;
  /**
   * Skill-set folders, as absolute paths. Each holds a `skills/` folder with one folder for each skill,
   * and the set's name is its folder's name. The agent can use every skill, and a message that starts
   * with `/<set>:<skill>` invokes one. Claude Code loads each set as a plugin of the session; Codex as
   * an extra skill root, with the adapter mapping the command.
   */
  skills?: string[];
  /**
   * `read-only`: the agent can read files and search, but it cannot change files or run commands
   * that change them, and it never asks for approval. It can still change things through `tools`.
   */
  access?: "edit" | "read-only";
  /**
   * Called before the agent changes files with its own tools, with the paths that it will change. Paths inside
   * `cwd` are relative. Claude Code waits for the promise. Codex waits only when it asks for approval first;
   * otherwise the change can start before the promise settles. Errors are ignored.
   */
  beforeFileChange?: (paths: string[]) => Promise<void> | void;
}

export interface ToolSet {
  /** Namespace of the tools, for example `note`. Letters, digits and underscores. */
  name: string;
  description: string;
  tools: AgentTool[];
}

export interface AgentTool<Shape extends z.ZodRawShape = z.ZodRawShape> {
  /** Letters, digits and underscores. */
  name: string;
  description: string;
  input: Shape;
  /** Short one-line summary for `tool-start` events. */
  title?(input: z.infer<z.ZodObject<Shape>>): string;
  run(input: z.infer<z.ZodObject<Shape>>, context: { signal: AbortSignal }): Promise<ToolOutput>;
}

export type ToolOutput = string | { text: string; isError?: boolean };

/** Returns the tool unchanged. It exists so TypeScript infers the input type of `run` from `input`. */
export function defineTool<Shape extends z.ZodRawShape>(tool: AgentTool<Shape>): AgentTool<Shape> {
  return tool;
}

/** Runs an app tool. A thrown error becomes an error result, so the agent can react to it. */
export async function runTool(tool: AgentTool, input: unknown, signal: AbortSignal): Promise<{ text: string; isError: boolean }> {
  try {
    const output = await tool.run(input as never, { signal });
    return typeof output === "string" ? { text: output, isError: false } : { text: output.text, isError: output.isError ?? false };
  } catch (error) {
    return { text: error instanceof Error ? error.message : String(error), isError: true };
  }
}

export interface SessionSettings {
  model?: string | null;
  effort?: string | null;
  approval?: ApprovalSetting;
}

export interface ModelOption {
  /** Value for `SessionOptions.model` and `AgentSession.configure`. */
  id: string;
  name: string;
  description: string;
  /** Effort levels that the model accepts. Empty when the model has no effort setting. */
  efforts: string[];
  defaultEffort?: string;
  isDefault: boolean;
}

export interface CommandOption {
  /** Name without the leading slash. */
  name: string;
  description: string;
  argumentHint?: string;
}

export type PermissionKind = "read" | "edit" | "command" | "network" | "mcp" | "other";

export interface PermissionRequest {
  /** Harness-specific tool name, for example `Bash`, `Edit`, `command` or `fileChange`. */
  tool: string;
  /** What the request is for, the same for both harnesses. */
  kind: PermissionKind;
  /** Short one-line summary, at most 100 characters. */
  title: string;
  /**
   * Content the user needs to see to decide: a command, or for a file change a diff whose lines
   * start with ' ', '-' or '+' (Codex diffs also contain '@@' hunk headers).
   */
  detail?: string;
  /** Raw request from the harness. */
  raw: unknown;
  /** Aborts when the harness no longer needs the answer, for example after an interrupt. */
  signal: AbortSignal;
}

/** `allow-session` approves this request and similar requests for the rest of the session. */
export type PermissionDecision = "allow" | "allow-session" | "deny";

export type PermissionHandler = (request: PermissionRequest) => Promise<PermissionDecision>;

export interface Question {
  /** The full question. Answers are keyed by this text. */
  question: string;
  /** Very short label, at most 12 characters, for example `Approach`. */
  header: string;
  /** Two to four choices. The user can also write an answer of their own. */
  options: QuestionOption[];
  /** The user can pick more than one option. */
  multiSelect: boolean;
}

export interface QuestionOption {
  label: string;
  description: string;
}

export interface QuestionRequest {
  questions: Question[];
  /** Aborts when the harness no longer needs the answers, for example after an interrupt. */
  signal: AbortSignal;
}

/**
 * Answers keyed by question text. An answer is an option label, the user's own text, or for a multi-select
 * question several of these joined with ", ". Undefined when the user does not answer.
 */
export type QuestionAnswers = Record<string, string>;

export type QuestionHandler = (request: QuestionRequest) => Promise<QuestionAnswers | undefined>;

export type TurnStatus = "completed" | "interrupted" | "failed";

export interface TurnResult {
  status: TurnStatus;
  /** The agent's final message for the turn. Empty when the turn did not finish. */
  text: string;
  error?: string;
  usage?: TurnUsage;
}

export interface TurnUsage {
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
  /** Only harnesses that report cost set this. */
  costUsd?: number;
}

export type AgentEvent =
  | { type: "turn-start"; prompt: string }
  | { type: "text-delta"; text: string }
  | { type: "message"; text: string }
  /** Summary of the agent's reasoning, when the harness and model provide one. */
  | { type: "thinking-delta"; text: string }
  | { type: "thinking"; text: string }
  | {
      type: "tool-start";
      id: string;
      tool: string;
      /** Short one-line summary. */
      title: string;
      /** A command, or a diff whose lines start with ' ', '-' or '+'. */
      detail?: string;
      /** Files that the tool reads or changes, relative to `cwd` when inside it. */
      paths?: string[];
    }
  | { type: "tool-end"; id: string; ok: boolean; output?: string }
  | { type: "turn-end"; result: TurnResult }
  | { type: "closed"; error?: string };

export type AgentEventListener = (event: AgentEvent) => void;

export interface AgentSession {
  readonly harness: Harness;
  /** Pass this value as `SessionOptions.resume` to continue the conversation later. */
  readonly id: string;
  readonly closed: boolean;
  /** Subscribes to session events. Returns a function that removes the listener. */
  on(listener: AgentEventListener): () => void;
  /**
   * Sends a user message and resolves when the agent finishes its turn.
   * Messages sent during a turn wait until the current turn ends.
   */
  send(text: string): Promise<TurnResult>;
  /** Stops the current turn. The turn resolves with status `interrupted`. */
  interrupt(): Promise<void>;
  close(): Promise<void>;
  /** The models that the harness offers to this user. */
  models(): Promise<ModelOption[]>;
  /** Slash commands that `send` accepts, for example `/review`. */
  commands(): Promise<CommandOption[]>;
  /**
   * Changes settings. Omitted fields stay as they are; `null` returns to the default. Claude Code applies a new
   * approval mode at once, also to the request that waits for approval; other changes apply from the next turn.
   */
  configure(settings: SessionSettings): Promise<void>;
}

export interface AgentInfo {
  harness: Harness;
  version: string;
  account: {
    /** How the harness connects, in its own terms: `ChatGPT` for Codex, `firstParty` for Claude. */
    login?: string;
    email?: string;
    organization?: string;
    subscription?: string;
  };
}

export class SessionClosedError extends Error {
  constructor(reason?: string) {
    super(reason ? `Session closed: ${reason}` : "Session closed");
    this.name = "SessionClosedError";
  }
}
