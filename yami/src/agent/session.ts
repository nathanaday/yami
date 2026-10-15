import type {
  PermissionDecision,
  PermissionHandler,
  PermissionRequest,
  SessionEvent,
  SessionListener,
  TurnResult,
} from "./types.js";

type ReadyEvent = Omit<Extract<SessionEvent, { type: "ready" }>, "type">;
type Outcome = Omit<TurnResult, "status"> & { status: "success" | "error" };

/**
 * One conversation with a harness. The base class runs one turn at a time,
 * delivers events, and closes the session. A subclass runs the turns: it
 * implements the abstract methods and reports through `ready`, `emit`,
 * `askPermission`, `endTurn`, and `finish`.
 */
export abstract class Session {
  private sessionId: string | undefined;
  private isClosed = false;
  private readonly listeners = new Set<SessionListener>();
  private permissionHandler: PermissionHandler | undefined;
  private readonly openPrompts = new Set<AbortController>();
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

  /**
   * Sets the handler for requests that `access` does not allow by itself.
   * Without a handler, the session denies each request.
   */
  setPermissionHandler(handler: PermissionHandler | undefined): void {
    this.permissionHandler = handler;
  }

  /** Ends the current turn with status `interrupted`. The session stays open. */
  async interrupt(): Promise<void> {
    if (!this.turn || this.isClosed) return;
    this.turn.interrupted = true;
    this.withdrawPrompts();
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

  /**
   * Asks the permission handler, and denies when there is none, when no turn
   * is running, or when the request is withdrawn. `signal` lets the harness
   * withdraw the request.
   */
  protected async askPermission(request: PermissionRequest, signal?: AbortSignal): Promise<PermissionDecision> {
    let decision: PermissionDecision = "deny";
    const handler = this.permissionHandler;
    if (handler && this.turn && !this.isClosed && !signal?.aborted) {
      const prompt = new AbortController();
      const withdraw = () => prompt.abort();
      signal?.addEventListener("abort", withdraw);
      this.openPrompts.add(prompt);
      try {
        decision = await Promise.race([
          handler(request, prompt.signal),
          new Promise<PermissionDecision>((resolve) => prompt.signal.addEventListener("abort", () => resolve("deny"))),
        ]);
      } catch {
        decision = "deny";
      } finally {
        signal?.removeEventListener("abort", withdraw);
        this.openPrompts.delete(prompt);
      }
      if (prompt.signal.aborted) decision = "deny";
    }
    this.emit({ type: "permission", request, decision });
    return decision;
  }

  protected endTurn(outcome: Outcome): void {
    const turn = this.turn;
    if (!turn) return;
    this.turn = undefined;
    this.withdrawPrompts();
    const result: TurnResult = { ...outcome, status: turn.interrupted ? "interrupted" : outcome.status };
    this.emit({ type: "turn-end", result });
    turn.resolve(result);
  }

  protected finish(error?: Error): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.withdrawPrompts();
    this.dispose();
    this.turn?.reject(error ?? new Error("The session closed before the turn ended."));
    this.turn = undefined;
    this.emit({ type: "closed", error });
  }

  private withdrawPrompts(): void {
    for (const prompt of this.openPrompts) prompt.abort();
    this.openPrompts.clear();
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
