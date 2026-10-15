import {
  type AgentEvent,
  type AgentEventListener,
  type AgentSession,
  type CommandOption,
  type Harness,
  type ModelOption,
  type PermissionDecision,
  type PermissionHandler,
  type PermissionRequest,
  SessionClosedError,
  type SessionSettings,
  type TurnResult,
} from "./types.js";

interface QueuedMessage {
  text: string;
  resolve(result: TurnResult): void;
  reject(error: Error): void;
}

/**
 * Shared turn queue and event delivery. A turn becomes active inside `send`,
 * so `interrupt` right after `send` stops that turn.
 */
export abstract class BaseSession implements AgentSession {
  abstract readonly harness: Harness;
  abstract readonly id: string;

  private readonly listeners = new Set<AgentEventListener>();
  private readonly queue: QueuedMessage[] = [];
  private active: ActiveTurn | undefined;
  private closeReason: string | undefined;
  private isClosed = false;

  get closed(): boolean {
    return this.isClosed;
  }

  on(listener: AgentEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  send(text: string): Promise<TurnResult> {
    if (this.isClosed) return Promise.reject(new SessionClosedError(this.closeReason));
    return new Promise((resolve, reject) => {
      this.queue.push({ text, resolve, reject });
      if (!this.active) this.startNext();
    });
  }

  async interrupt(): Promise<void> {
    const turn = this.active;
    if (!turn || turn.interruptRequested) return;
    turn.interruptRequested = true;
    turn.controller.abort();
    await this.interruptTurn(turn);
  }

  abstract close(): Promise<void>;
  abstract models(): Promise<ModelOption[]>;
  abstract commands(): Promise<CommandOption[]>;
  abstract configure(settings: SessionSettings): Promise<void>;

  /** Sends the message to the harness. The adapter calls `turn.finish` when the harness ends the turn. */
  protected abstract startTurn(text: string, turn: ActiveTurn): Promise<void>;

  protected abstract interruptTurn(turn: ActiveTurn): Promise<void>;

  protected get currentTurn(): ActiveTurn | undefined {
    return this.active;
  }

  protected emit(event: AgentEvent): void {
    if (event.type === "tool-start") event = { ...event, title: oneLine(event.title) };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("yami: event listener threw", error);
      }
    }
  }

  /** Closes the session once: ends the active turn, rejects queued messages and emits `closed`. */
  protected markClosed(error?: string): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.closeReason = error;
    this.active?.finish({ status: error ? "failed" : "interrupted", text: "", error: error ?? "Session closed" });
    this.rejectQueued();
    this.emit({ type: "closed", error });
  }

  private startNext(): void {
    const message = this.queue.shift();
    if (!message) return;
    const turn = new ActiveTurn();
    const started = Date.now();
    this.active = turn;
    this.emit({ type: "turn-start", prompt: message.text });
    this.startTurn(message.text, turn).catch((error: unknown) =>
      turn.finish({ status: "failed", text: "", error: error instanceof Error ? error.message : String(error) }),
    );
    void turn.result.then((finished) => {
      const result: TurnResult = { ...finished, usage: { ...finished.usage, durationMs: Date.now() - started } };
      this.active = undefined;
      this.emit({ type: "turn-end", result });
      message.resolve(result);
      if (this.isClosed) this.rejectQueued();
      else this.startNext();
    });
  }

  private rejectQueued(): void {
    for (const message of this.queue.splice(0)) message.reject(new SessionClosedError(this.closeReason));
  }
}

export class ActiveTurn {
  /** Aborts on interrupt and when the turn ends, so open permission prompts can close. */
  readonly controller = new AbortController();
  readonly result: Promise<TurnResult>;
  interruptRequested = false;
  private resolve!: (result: TurnResult) => void;

  constructor() {
    this.result = new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  finish(result: TurnResult): void {
    this.controller.abort();
    this.resolve(result);
  }
}

/** Shortens text to one line of at most `max` characters. */
export function oneLine(text: string, max = 100): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export async function askPermission(handler: PermissionHandler | undefined, request: PermissionRequest): Promise<PermissionDecision> {
  if (!handler) return "deny";
  try {
    return await handler({ ...request, title: oneLine(request.title) });
  } catch {
    return "deny";
  }
}
