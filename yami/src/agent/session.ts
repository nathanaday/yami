import type { SessionEvent, SessionListener, TurnResult } from "./types.js";

type ReadyEvent = Omit<Extract<SessionEvent, { type: "ready" }>, "type">;
type Outcome = Omit<TurnResult, "status"> & { status: "success" | "error" };

/**
 * One conversation with a harness. The base class runs one turn at a time,
 * delivers events, and closes the session. A subclass runs the turns: it
 * implements the abstract methods and reports through `ready`, `emit`,
 * `endTurn`, and `finish`.
 */
export abstract class Session {
  private sessionId: string | undefined;
  private isClosed = false;
  private readonly listeners = new Set<SessionListener>();
  private turn:
    | { resolve(result: TurnResult): void; reject(error: Error): void; interrupted: boolean }
    | undefined;

  /** Known after the `ready` event. */
  get id(): string | undefined {
    return this.sessionId;
  }

  get closed(): boolean {
    return this.isClosed;
  }

  /**
   * Sends one prompt and resolves when the turn ends. A turn that the harness
   * ends with an error resolves with `status: "error"`. The promise rejects
   * only when the session cannot run the turn.
   */
  send(prompt: string): Promise<TurnResult> {
    if (this.isClosed) return Promise.reject(new Error("The session is closed."));
    if (this.turn) {
      return Promise.reject(new Error("A turn is already running. Wait for it to end, or call interrupt()."));
    }
    return new Promise((resolve, reject) => {
      this.turn = { resolve, reject, interrupted: false };
      try {
        this.startTurn(prompt);
      } catch (error) {
        this.turn = undefined;
        reject(error);
      }
    });
  }

  /** Returns a function that removes the listener. */
  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Ends the current turn with status `interrupted`. The session stays open. */
  async interrupt(): Promise<void> {
    if (!this.turn || this.isClosed) return;
    this.turn.interrupted = true;
    await this.stopTurn();
  }

  close(): void {
    this.finish();
  }

  /** Starts a turn. The turn must end with `endTurn` or `finish`. */
  protected abstract startTurn(prompt: string): void;
  protected abstract stopTurn(): Promise<void>;
  /** Releases the harness resources. Runs once, when the session closes. */
  protected abstract dispose(): void;

  /** Sets the session ID. Only the first call emits `ready`. */
  protected ready(event: ReadyEvent): void {
    if (this.sessionId) return;
    this.sessionId = event.sessionId;
    this.emit({ type: "ready", ...event });
  }

  protected endTurn(outcome: Outcome): void {
    const turn = this.turn;
    if (!turn) return;
    this.turn = undefined;
    const result: TurnResult = { ...outcome, status: turn.interrupted ? "interrupted" : outcome.status };
    this.emit({ type: "turn-end", result });
    turn.resolve(result);
  }

  protected finish(error?: Error): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.dispose();
    this.turn?.reject(error ?? new Error("The session closed before the turn ended."));
    this.turn = undefined;
    this.emit({ type: "closed", error });
  }

  protected emit(event: SessionEvent): void {
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

/** Returns the text of a tool result: a string, or a list of content blocks. */
export function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (block?.type === "text" ? block.text : `[${block?.type}]`))
    .join("\n");
}
