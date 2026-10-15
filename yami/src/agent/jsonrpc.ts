interface Message {
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface JsonRpcHandlers {
  notification(method: string, params: unknown): void;
  /** Answers a request from the other side. A thrown error becomes an error response. */
  request(method: string, params: unknown): Promise<unknown>;
}

/** JSON-RPC over newline-delimited JSON. Messages have no `jsonrpc` field, as in `codex app-server`. */
export class JsonRpcConnection {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve(result: unknown): void; reject(error: Error): void }>();
  private closedWith: Error | undefined;

  constructor(
    private readonly write: (line: string) => void,
    private readonly handlers: JsonRpcHandlers,
  ) {}

  request<T>(method: string, params?: unknown): Promise<T> {
    if (this.closedWith) return Promise.reject(this.closedWith);
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (result: unknown) => void, reject });
      this.send({ id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    if (!this.closedWith) this.send({ method, params });
  }

  receive(line: string): void {
    let message: Message;
    try {
      message = JSON.parse(line) as Message;
    } catch {
      return;
    }
    if (message.method === undefined) {
      const call = typeof message.id === "number" ? this.pending.get(message.id) : undefined;
      if (!call) return;
      this.pending.delete(message.id as number);
      if (message.error) call.reject(new Error(message.error.message));
      else call.resolve(message.result);
    } else if (message.id === undefined) {
      this.handlers.notification(message.method, message.params);
    } else {
      void this.answer(message.id, message.method, message.params);
    }
  }

  /** Rejects every pending request. Later requests reject with the same error. */
  close(error: Error): void {
    this.closedWith ??= error;
    for (const call of this.pending.values()) call.reject(this.closedWith);
    this.pending.clear();
  }

  private async answer(id: number | string, method: string, params: unknown): Promise<void> {
    try {
      const result = await this.handlers.request(method, params);
      if (!this.closedWith) this.send({ id, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!this.closedWith) this.send({ id, error: { code: -32601, message } });
    }
  }

  private send(message: Message): void {
    this.write(JSON.stringify(message) + "\n");
  }
}
