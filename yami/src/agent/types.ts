export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * - `read-only`: the agent cannot change files.
 * - `edit`: the agent can change files in `cwd`.
 */
export type Access = "read-only" | "edit";

export interface Preferences {
  /** Working directory of the agent. Defaults to the current process directory. */
  cwd?: string;
  /** Model ID. Defaults to the harness default. */
  model?: string;
  effort?: Effort;
  /** Text added to the harness system prompt. */
  instructions?: string;
  /** Defaults to `read-only`. */
  access?: Access;
}

export interface AgentInfo {
  harness: string;
  version: string;
  account: {
    /** How the harness connects, in its own terms: `ChatGPT` for Codex, `firstParty` for Claude. */
    login?: string;
    email?: string;
    organization?: string;
    subscription?: string;
  };
}

export interface Usage {
  /** Includes cached input tokens. */
  inputTokens: number;
  outputTokens: number;
}

export interface TurnResult {
  status: "success" | "error" | "interrupted";
  text: string;
  errors: string[];
  usage: Usage;
  /** Only harnesses that report cost set this. */
  costUsd?: number;
  durationMs: number;
}

export type PermissionKind = "read" | "edit" | "command" | "network" | "mcp" | "other";

/** A request from the harness to do something that `access` does not allow by itself. */
export interface PermissionRequest {
  kind: PermissionKind;
  /** The harness name of the tool, for example `Read` or `shell`. */
  tool: string;
  input: unknown;
  /** The harness's own description of the request, when it gives one. */
  reason?: string;
  /** True when the harness can apply `allow-for-session`. */
  canAllowForSession: boolean;
}

export type PermissionDecision = "allow" | "allow-for-session" | "deny";

/**
 * Decides one request. The signal aborts when the request is withdrawn, for
 * example on `interrupt()` or `close()`; the host should then close its prompt.
 */
export type PermissionHandler = (request: PermissionRequest, signal: AbortSignal) => Promise<PermissionDecision>;

export type SessionEvent =
  | { type: "ready"; sessionId: string; model?: string; tools?: string[] }
  | { type: "text"; text: string }
  | { type: "tool-call"; id: string; name: string; input: unknown }
  | { type: "tool-result"; id: string; isError: boolean; output: string }
  | { type: "permission"; request: PermissionRequest; decision: PermissionDecision }
  | { type: "turn-end"; result: TurnResult }
  | { type: "closed"; error?: Error };

export type SessionListener = (event: SessionEvent) => void;
