import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

export interface RpcHandlers {
  onNotification(method: string, params: unknown): void;
  /** Answers a request from the server. Throw `RpcError` to send an error response. */
  onRequest(method: string, params: unknown): Promise<unknown>;
}

type Id = number | string;

interface Message {
  id?: Id;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** Terminal control sequences: CSI, OSC, and two-byte escapes. A server can print them before a line. */
const ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g;

/**
 * JSON-RPC 2.0 over newline-delimited JSON, as `codex app-server` speaks it.
 * The server omits the `"jsonrpc": "2.0"` field, so this client omits it too.
 */
export class RpcConnection {
  private nextId = 1;
  private readonly pending = new Map<Id, { resolve(value: unknown): void; reject(error: Error): void }>();
  private closedError: Error | undefined;

  constructor(
    input: Readable,
    private readonly output: Writable,
    private readonly handlers: RpcHandlers,
  ) {
    createInterface({ input }).on("line", (line) => this.receive(line));
    output.on("error", (error) => this.close(error));
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (this.closedError) return Promise.reject(this.closedError);
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    this.write(params === undefined ? { method } : { method, params });
  }

  /** Rejects all pending requests. Later requests reject with the same error. */
  close(error = new Error("Connection closed")): void {
    if (this.closedError) return;
    this.closedError = error;
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }

  private write(message: Message): void {
    if (this.closedError || this.output.destroyed) return;
    this.output.write(JSON.stringify(message) + "\n");
  }

  private receive(line: string): void {
    const json = line.replace(ESCAPES, "");
    if (!json.trim()) return;
    let message: Message;
    try {
      message = JSON.parse(json) as Message;
    } catch {
      return;
    }
    if (message.method !== undefined && message.id !== undefined) {
      void this.answer(message.id, message.method, message.params);
    } else if (message.method !== undefined) {
      this.handlers.onNotification(message.method, message.params);
    } else if (message.id !== undefined) {
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) {
        waiter.reject(new RpcError(message.error.code, message.error.message, message.error.data));
      } else {
        waiter.resolve(message.result);
      }
    }
  }

  private async answer(id: Id, method: string, params: unknown): Promise<void> {
    try {
      const result = await this.handlers.onRequest(method, params);
      this.write({ id, result });
    } catch (error) {
      const rpcError = error instanceof RpcError ? error : new RpcError(-32603, error instanceof Error ? error.message : String(error));
      this.write({ id, error: { code: rpcError.code, message: rpcError.message, data: rpcError.data } });
    }
  }
}
