export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * - `read-only`: the agent can read and search files in `cwd`.
 * - `edit`: the agent can also create and change files in `cwd`.
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

export interface HarnessInfo {
  harness: string;
  version: string;
  account: {
    email?: string;
    organization?: string;
    subscription?: string;
  };
}

export interface TurnResult {
  status: "success" | "error" | "interrupted";
  text: string;
  errors: string[];
  costUsd: number;
  durationMs: number;
}

export type SessionEvent =
  | { type: "ready"; sessionId: string; model: string; tools: string[] }
  | { type: "text"; text: string }
  | { type: "tool-call"; id: string; name: string; input: unknown }
  | { type: "tool-result"; id: string; isError: boolean; output: string }
  | { type: "turn-end"; result: TurnResult }
  | { type: "closed"; error?: Error };

export type SessionListener = (event: SessionEvent) => void;

export interface Session {
  /** Known after the `ready` event. */
  readonly id: string | undefined;
  readonly closed: boolean;
  /**
   * Sends one prompt and resolves when the turn ends. A turn that the harness
   * ends with an error resolves with `status: "error"`. The promise rejects
   * only when the session cannot run the turn.
   */
  send(prompt: string): Promise<TurnResult>;
  /** Returns a function that removes the listener. */
  subscribe(listener: SessionListener): () => void;
  /** Ends the current turn with status `interrupted`. The session stays open. */
  interrupt(): Promise<void>;
  close(): void;
}

export interface Harness {
  readonly name: string;
  connect(preferences: Preferences): Promise<HarnessInfo>;
  openSession(preferences: Preferences): Session;
}
