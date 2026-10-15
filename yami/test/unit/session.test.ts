import { describe, expect, it } from "vitest";
import { AsyncQueue } from "../../src/agent/async-queue.js";
import { type ActiveTurn, askPermission, BaseSession, oneLine } from "../../src/agent/session.js";
import type { PermissionRequest } from "../../src/agent/types.js";

class EchoSession extends BaseSession {
  readonly harness = "claude";
  readonly id = "echo";
  readonly started: string[] = [];

  protected async startTurn(text: string, turn: ActiveTurn): Promise<void> {
    this.started.push(text);
    if (text === "throw") throw new Error("adapter bug");
    setTimeout(() => turn.finish({ status: turn.interruptRequested ? "interrupted" : "completed", text }), 5);
  }

  protected async interruptTurn(): Promise<void> {}

  async close(): Promise<void> {
    this.markClosed();
  }

  async models() {
    return [];
  }

  async commands() {
    return [];
  }

  async configure() {}
}

describe("BaseSession", () => {
  it("runs one turn at a time in send order", async () => {
    const session = new EchoSession();
    const events: string[] = [];
    session.on((event) => events.push(event.type === "turn-start" ? `start:${event.prompt}` : event.type));
    const results = await Promise.all([session.send("a"), session.send("b")]);
    expect(results.map((result) => result.text)).toEqual(["a", "b"]);
    expect(events).toEqual(["start:a", "turn-end", "start:b", "turn-end"]);
  });

  it("fails the turn when the adapter throws, then runs the next one", async () => {
    const session = new EchoSession();
    expect(await session.send("throw")).toMatchObject({ status: "failed", text: "", error: "adapter bug" });
    expect((await session.send("next")).text).toBe("next");
  });

  it("interrupts a turn right after send", async () => {
    const session = new EchoSession();
    const turn = session.send("a");
    await session.interrupt();
    expect((await turn).status).toBe("interrupted");
  });

  it("rejects send on a closed session", async () => {
    const session = new EchoSession();
    await session.close();
    await expect(session.send("a")).rejects.toThrow("Session closed");
  });

  it("rejects sends after close, including queued ones", async () => {
    const session = new EchoSession();
    const running = session.send("a");
    const queued = session.send("b");
    await session.close();
    expect(await running).toMatchObject({ status: "interrupted" });
    await expect(queued).rejects.toThrow("Session closed");
    expect(session.started).toEqual(["a"]);
  });

  it("isolates listeners that throw", async () => {
    const session = new EchoSession();
    const seen: string[] = [];
    session.on(() => {
      throw new Error("bad listener");
    });
    const off = session.on((event) => seen.push(event.type));
    const error = console.error;
    console.error = () => {};
    try {
      await session.send("a");
    } finally {
      console.error = error;
    }
    off();
    await session.send("b");
    expect(seen).toEqual(["turn-start", "turn-end"]);
  });
});

describe("askPermission", () => {
  const request: PermissionRequest = { tool: "t", kind: "other", title: "x\ny", raw: null, signal: new AbortController().signal };

  it("denies without a handler or when the handler throws", async () => {
    expect(await askPermission(undefined, request)).toBe("deny");
    expect(
      await askPermission(async () => {
        throw new Error("ui crashed");
      }, request),
    ).toBe("deny");
  });

  it("passes a one-line title to the handler", async () => {
    let title = "";
    await askPermission(async (received) => {
      title = received.title;
      return "allow";
    }, request);
    expect(title).toBe("x y");
  });
});

describe("oneLine", () => {
  it("collapses whitespace and truncates", () => {
    expect(oneLine("a\n  b")).toBe("a b");
    expect(oneLine("abcdef", 4)).toBe("abc…");
  });
});

describe("AsyncQueue", () => {
  it("delivers items pushed before and after the consumer waits", async () => {
    const queue = new AsyncQueue<number>();
    queue.push(1);
    const seen: number[] = [];
    const consumer = (async () => {
      for await (const item of queue) seen.push(item);
    })();
    await new Promise((resolve) => setTimeout(resolve, 1));
    queue.push(2);
    queue.end();
    await consumer;
    expect(seen).toEqual([1, 2]);
  });
});
