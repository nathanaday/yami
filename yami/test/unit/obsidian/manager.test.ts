import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => {
  class TFile {
    parent: { path: string } | null = null;
    constructor(public path: string) {}
    get basename() {
      return this.path.split("/").pop()!.replace(/\.md$/, "");
    }
  }
  class MarkdownView {
    file: TFile | null = null;
  }
  class Notice {
    static messages: string[] = [];
    constructor(message: string) {
      Notice.messages.push(message);
    }
  }
  const normalizePath = (path: string) => path.replace(/\/+/g, "/").replace(/^\/|\/$/g, "") || "/";
  return { TFile, MarkdownView, Notice, normalizePath };
});

vi.mock("../../../src/obsidian/agents.js", async (actual) => ({
  ...(await actual<typeof import("../../../src/obsidian/agents.js")>()),
  Presence: class {
    peer() {
      return { beginTurn() {}, setCursor() {} };
    }
    setStatus() {}
    clear() {}
  },
}));

vi.mock("../../../src/obsidian/collab/region.js", () => ({
  LiveRegion: class {
    set() {}
    settled() {
      return Promise.resolve();
    }
    close() {}
  },
}));

vi.mock("../../../src/obsidian/conversation/composer.js", () => ({
  Composer: class {
    constructor(_app: unknown, _view: unknown, readonly controller: { attach(holder: object): Promise<void> }) {
      void controller.attach(this);
    }
    focus() {}
    destroy() {}
  },
}));

import { MarkdownView, TFile } from "obsidian";
import { Agent, type AgentEvent, type AgentInfo, type AgentSession, type SessionOptions, type TurnResult } from "../../../src/agent/index.js";
import type { ConversationAgent } from "../../../src/obsidian/agents.js";
import type { TurnEnd } from "../../../src/obsidian/api.js";
import { applyOps } from "../../../src/document/text-ops.js";
import { ConversationManager } from "../../../src/obsidian/conversation/manager.js";
import { ObsidianConversations } from "../../../src/obsidian/conversation/obsidian-conversations.js";

// The mocks take the arguments that the tests need, not those of Obsidian's classes.
const FakeFile = TFile as unknown as new (path: string) => TFile;
const FakeView = MarkdownView as unknown as new () => MarkdownView;

beforeAll(() => {
  Object.assign(globalThis, { window: globalThis });
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A harness session that the test drives with `emit`. */
function fakeSession(id = "session-1") {
  const listeners = new Set<(event: AgentEvent) => void>();
  const emit = (event: AgentEvent) => listeners.forEach((listener) => listener(event));
  return {
    id,
    closed: false,
    sent: [] as string[],
    on(next: (event: AgentEvent) => void) {
      listeners.add(next);
      return () => listeners.delete(next);
    },
    send(text: string) {
      this.sent.push(text);
      return new Promise<TurnResult>(() => undefined);
    },
    emit,
    endTurn(status: TurnResult["status"] = "completed") {
      emit({ type: "turn-start" } as AgentEvent);
      emit({ type: "turn-end", result: { status, text: "Done." } });
    },
    models: async () => [],
    commands: async () => [],
    interrupt: async () => undefined,
    close: async () => undefined,
    configure: async () => undefined,
  };
}

/** An agent whose sessions the test supplies. */
class FakeAgent extends Agent {
  readonly started: SessionOptions[] = [];
  constructor(
    readonly harness: "claude" | "codex",
    private readonly session: () => Promise<AgentSession>,
  ) {
    super({});
  }
  async connect(): Promise<AgentInfo> {
    return { harness: this.harness, version: "0", account: {} };
  }
  protected createSession(options: SessionOptions): Promise<AgentSession> {
    this.started.push(options);
    return this.session();
  }
}

/** The parts of Obsidian's App that conversations use, over files in memory. */
function fakeApp() {
  const files = new Map<string, TFile>();
  const text = new Map<TFile, string>();
  const folders = new Set<string>();
  /** Folders on disk that Obsidian has not indexed. */
  const onDisk = new Set<string>();
  const listeners = new Set<(file: TFile) => void>();
  const leaves: { view: MarkdownView }[] = [];
  const frontmatter = (file: TFile) => {
    const match = /^---\n([\s\S]*?)\n---/.exec(text.get(file) ?? "");
    if (!match) return undefined;
    const properties: Record<string, unknown> = {};
    for (const line of match[1]!.split("\n")) {
      const [, key, value] = /^([\w-]+): (.+)$/.exec(line) ?? [];
      if (key) properties[key] = value === "true" ? true : value;
    }
    return properties;
  };
  const getLeaf = vi.fn((_where: unknown) => {
    const leaf = {
      view: new FakeView(),
      openFile: vi.fn(async (file: TFile, _state: unknown) => {
        leaf.view.file = file;
      }),
    };
    leaves.push(leaf);
    return leaf;
  });
  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => files.get(path) ?? (folders.has(path) ? {} : null),
      getFileByPath: (path: string) => files.get(path) ?? null,
      getFolderByPath: (path: string) => (folders.has(path) ? { path } : null),
      getAllFolders: () => [...folders].map((path) => ({ path })),
      createFolder: vi.fn(async (path: string) => {
        if (folders.has(path) || onDisk.has(path)) throw new Error("Folder already exists.");
        folders.add(path);
      }),
      adapter: { exists: async (path: string) => folders.has(path) || onDisk.has(path) },
      create: async (path: string, content: string) => {
        const file = new FakeFile(path);
        file.parent = { path: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "/" } as TFile["parent"];
        files.set(path, file);
        text.set(file, content);
        // The metadata cache reads a new file a moment later.
        queueMicrotask(() => listeners.forEach((listener) => listener(file)));
        return file;
      },
    },
    metadataCache: {
      getFileCache: (file: TFile) => ({ frontmatter: frontmatter(file) }),
      getFirstLinkpathDest: (link: string) => ({ path: `${link}.md` }),
      on: (_name: string, listener: (file: TFile) => void) => (listeners.add(listener), listener),
      offref: (listener: (file: TFile) => void) => listeners.delete(listener),
    },
    fileManager: {
      processFrontMatter: async (file: TFile, change: (properties: Record<string, unknown>) => void) => {
        const properties = frontmatter(file) ?? {};
        change(properties);
        const body = (text.get(file) ?? "").replace(/^---\n[\s\S]*?\n---\n/, "");
        text.set(
          file,
          `---\n${Object.entries(properties)
            .map(([key, value]) => `${key}: ${value}`)
            .join("\n")}\n---\n${body}`,
        );
      },
      renameFile: vi.fn(async (file: TFile, path: string) => {
        files.delete(file.path);
        file.path = path;
        files.set(path, file);
      }),
    },
    workspace: {
      getLeaf,
      iterateAllLeaves: (visit: (leaf: { view: MarkdownView }) => void) => leaves.forEach(visit),
    },
  };
  return { app, text, folders, onDisk, getLeaf };
}

/** A shared note over the fake file's text. */
function fakeHub(text: Map<TFile, string>) {
  return {
    acquire: async (file: TFile) => ({
      get content() {
        return text.get(file) ?? "";
      },
      applyOps: (ops: Parameters<typeof applyOps>[1]) => text.set(file, applyOps(text.get(file) ?? "", ops)),
      relative: () => undefined,
    }),
    release() {},
    addWriter: () => () => undefined,
    prepare: async () => undefined,
  };
}

describe("ConversationManager", () => {
  let fake: ReturnType<typeof fakeApp>;
  let manager: ConversationManager;
  let session: ReturnType<typeof fakeSession>;
  let agents: ConversationAgent[];
  let claude: FakeAgent;

  beforeEach(() => {
    fake = fakeApp();
    session = fakeSession();
    claude = new FakeAgent("claude", async () => session as unknown as AgentSession);
    agents = [
      { name: "claude", color: "#d97757", agent: claude },
      { name: "codex", color: "#4f8cf7", agent: new FakeAgent("codex", async () => session as unknown as AgentSession) },
    ];
    manager = new ConversationManager(fake.app as never, fakeHub(fake.text) as never, {} as never, {
      agents: () => agents,
      folder: () => "conversations",
      animate: () => false,
      idleMinutes: () => 15,
      onActivity: () => undefined,
    });
  });

  afterEach(async () => {
    await manager.destroy();
  });

  const start = async (options: Parameters<ConversationManager["start"]>[0]) => {
    const file = await manager.start(options);
    await flush();
    return { file, text: () => fake.text.get(file)! };
  };

  it("creates the note in the conversation folder, named after the message, and sends the message", async () => {
    const { file, text } = await start({ message: "Summarize [[Ideas]] please", open: false });
    expect(file.path).toMatch(/^conversations\/\d{4}-\d{2}-\d{2} Summarize Ideas please\.md$/);
    expect(fake.folders.has("conversations")).toBe(true);
    expect(text()).toMatch(/^---\ntype: conversation\nagent: claude\nstatus: active\ncreated: \d{4}-\d{2}-\d{2} \d{2}:\d{2}\n/);
    expect(text()).toContain("> [!user]\n> Summarize [[Ideas]] please");
    expect(session.sent).toEqual([`Summarize [[Ideas]] please\n\nConversation note: ${file.path} (do not edit it)\nLinked notes: Ideas.md`]);
    expect(fake.app.fileManager.renameFile).not.toHaveBeenCalled();
    expect(fake.getLeaf).not.toHaveBeenCalled();
    expect(claude.started[0]).toMatchObject({ approval: "ask", instructions: expect.stringContaining("conversation note") });

    const again = await start({ message: "Summarize [[Ideas]] please", open: false });
    expect(again.file.path).toMatch(/ Summarize Ideas please 2\.md$/);
  });

  it("gives two notes that are created at the same time two paths, as two agents of one session need", async () => {
    fake.folders.add("conversations");
    const create = fake.app.vault.create;
    // Obsidian adds a new file to the vault only once it is written.
    fake.app.vault.create = async (path: string, content: string) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return create(path, content);
    };
    const notes = await Promise.all([manager.create(agents[0]!, { name: "Same", open: false }), manager.create(agents[0]!, { name: "Same", open: false })]);
    expect(notes.map((file) => file.path).sort()).toEqual(["conversations/Same 2.md", "conversations/Same.md"]);
  });

  it("uses the given agent, title, folder and module", async () => {
    const { file, text } = await start({
      message: "/atlas-obsidian:wiki-ingest",
      agent: "codex",
      title: "Ingest: notes/today",
      folder: "changes/agents/",
      open: false,
      module: "hello/Session 1.md",
    });
    expect(file.path).toBe("changes/agents/Ingest notes today.md");
    expect(text()).toMatch(/\nagent: codex\nmodule: "\[\[hello\/Session 1\]\]"\n/);
    expect(claude.started).toHaveLength(0);
    expect(session.sent[0]).toMatch(/^\/atlas-obsidian:wiki-ingest\n/);
  });

  it("uses a conversation folder that exists with other letter case, or on disk only", async () => {
    fake.folders.add("Conversations");
    const { file } = await start({ message: "Hello", open: false });
    expect(file.path).toMatch(/^Conversations\//);
    expect(fake.app.vault.createFolder).not.toHaveBeenCalled();

    fake.folders.clear();
    fake.onDisk.add("changes");
    const other = await start({ message: "Hello", folder: "changes", open: false });
    expect(other.file.path).toMatch(/^changes\//);
    expect(fake.app.vault.createFolder).toHaveBeenCalledWith("changes");
  });

  it("opens the note in a new tab unless asked not to", async () => {
    const { file } = await start({ message: "Hello" });
    expect(fake.getLeaf).toHaveBeenCalledWith("tab");
    const leaf = fake.getLeaf.mock.results[0]!.value;
    expect(leaf.openFile).toHaveBeenCalledWith(file, expect.objectContaining({ active: true }));
  });

  it("reports the status, and calls listeners when a turn ends", async () => {
    const { file } = await start({ message: "Hello", open: false });
    expect(manager.status(file.path)).toBe("working");
    const turns: TurnEnd[] = [];
    const stop = manager.onTurnEnd(file.path, (turn) => turns.push(turn));
    session.endTurn();
    await flush();
    expect(turns).toEqual([{ path: file.path, status: "completed", text: "Done." }]);
    expect(manager.status(file.path)).toBe("active");

    await manager.controller(file)!.end();
    expect(manager.status(file.path)).toBe("ended");
    stop();
    expect(manager.status("conversations/Missing.md")).toBe("none");
  });

  it("ends the turn as failed when the agent cannot start", async () => {
    agents[0] = { ...agents[0]!, agent: new FakeAgent("claude", () => Promise.reject(new Error("claude not found"))) };
    const turns: TurnEnd[] = [];
    const file = await manager.start({ message: "Hello", open: false });
    manager.onTurnEnd(file.path, (turn) => turns.push(turn));
    await flush();
    expect(turns).toEqual([{ path: file.path, status: "failed", error: "claude not found" }]);
    expect(manager.status(file.path)).toBe("active");
  });

  it("rejects an empty message, an unknown agent, and calls after the plugin unloads", async () => {
    await expect(manager.start({ message: "  " })).rejects.toThrow("needs a message");
    await expect(manager.start({ message: "Hi", agent: "gemini" })).rejects.toThrow("Yami has no agent named gemini. Agents: claude, codex.");
    agents.length = 0;
    await expect(manager.start({ message: "Hi" })).rejects.toThrow("Yami has no agents.");
    await manager.destroy();
    await expect(manager.start({ message: "Hi" })).rejects.toThrow("Yami is turned off.");
  });

  it("starts the agent of a run's conversation with the tools that the run gives, in place of the agent's", async () => {
    const runs = new ObsidianConversations(fake.app as never, manager, () => agents);
    const tools = { name: "yami", description: "The reviewer's tools.", tools: [] };
    const review = await runs.open({ agent: claude, name: "x review", folder: "conversations", access: "read-only", tools });
    void review.send("Judge the work.");
    await flush();
    expect(claude.started.at(-1)).toMatchObject({ access: "read-only", tools });
    const work = await runs.open({ agent: claude, name: "x", folder: "conversations" });
    void work.send("Do the work.");
    await flush();
    expect(claude.started).toHaveLength(2);
    expect(claude.started.at(-1)?.tools).toBeUndefined();
  });

  // The guarantees that the README gives under Conversation notes. Another plugin depends on each one.
  describe("the guarantees of start, status, and onTurnEnd", () => {
    it("gives the note its final path when start resolves, so no message renames it", async () => {
      const named = await manager.start({ message: "Plan the week", open: false });
      const titled = await manager.start({ message: "Hello", title: "Weekly plan", open: false });
      const paths = [named.path, titled.path];
      expect(paths[0]).toMatch(/^conversations\/\d{4}-\d{2}-\d{2} Plan the week\.md$/);
      expect(paths[1]).toBe("conversations/Weekly plan.md");
      await flush();
      session.endTurn();
      await flush();
      void manager.controller(named)!.send("And the next one");
      await flush();
      expect(session.sent.at(-1)).toMatch(/^And the next one/);
      session.endTurn();
      await flush();
      expect([named.path, titled.path]).toEqual(paths);
      expect(fake.app.fileManager.renameFile).not.toHaveBeenCalled();
    });

    it("is working when start resolves, before the agent has started", async () => {
      const file = await manager.start({ message: "Hello", open: false });
      expect(manager.status(file.path)).toBe("working");
      await flush();
      expect(manager.status(file.path)).toBe("working");
    });

    it("starts the turn of a queued message before the listeners hear of the end, so they see working", async () => {
      const { file } = await start({ message: "First", open: false });
      await manager.controller(file)!.send("Second");
      const seen: string[] = [];
      manager.onTurnEnd(file.path, () => seen.push(manager.status(file.path)));
      session.endTurn();
      await flush();
      expect(seen).toEqual(["working"]);
      expect(session.sent.at(-1)).toBe("Second");
    });

    it("follows a renamed note, and stops calling after unsubscribe", async () => {
      const { file } = await start({ message: "Hello", title: "Named", open: false });
      const turns: TurnEnd[] = [];
      const stop = manager.onTurnEnd(file.path, (turn) => turns.push(turn));
      await fake.app.fileManager.renameFile(file, "conversations/Renamed.md");
      session.endTurn("interrupted");
      await flush();
      expect(turns).toEqual([{ path: "conversations/Renamed.md", status: "interrupted", text: "Done." }]);
      stop();
      session.endTurn();
      await flush();
      expect(turns).toHaveLength(1);
    });

    it("logs an error of a listener, and the other listeners and the next turn go on", async () => {
      const { file } = await start({ message: "First", open: false });
      await manager.controller(file)!.send("Second");
      const failure = new Error("listener bug");
      manager.onTurnEnd(file.path, () => {
        throw failure;
      });
      const turns: TurnEnd[] = [];
      manager.onTurnEnd(file.path, (turn) => turns.push(turn));
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      session.endTurn();
      await flush();
      expect(error).toHaveBeenCalledWith("Yami: a turn-end listener failed", failure);
      error.mockRestore();
      expect(turns).toHaveLength(1);
      expect(session.sent.at(-1)).toBe("Second");
      expect(manager.status(file.path)).toBe("working");
    });
  });

  describe("a turn that a run waits for", () => {
    const settled = (promise: Promise<unknown>) => {
      let done = false;
      void promise.then(() => (done = true));
      return () => done;
    };

    it("settles with the turn of its own message, not with a turn of the person's that came before", async () => {
      const { file } = await start({ message: "The person's message", open: false });
      const controller = manager.conversation(file);
      const mine = controller.sendForTurn("The run's prompt");
      const done = settled(mine);
      session.endTurn();
      await flush();
      expect(done()).toBe(false);
      expect(session.sent.at(-1)).toMatch(/^The run's prompt/);
      session.endTurn();
      expect(await mine).toMatchObject({ status: "completed", text: "Done." });
    });

    it("ends as interrupted when the session closes on purpose, and as failed when it breaks", async () => {
      const { file } = await start({ message: "One", open: false });
      const controller = manager.conversation(file);
      const first = controller.sendForTurn("Two");
      session.endTurn();
      await flush();
      session.emit({ type: "closed" } as AgentEvent);
      expect(await first).toMatchObject({ status: "interrupted" });
      const second = controller.sendForTurn("Three");
      await flush();
      session.emit({ type: "closed", error: "boom" } as AgentEvent);
      expect(await second).toMatchObject({ status: "failed", error: "boom" });
    });

    it("ends when the session closed while the agent started, so no run waits for ever", async () => {
      session.send = function (text: string) {
        this.sent.push(text);
        return Promise.reject(new Error("The session is closed."));
      };
      const { file } = await start({ message: "Hello", open: false });
      const turn = await manager.conversation(file).sendForTurn("Again");
      expect(turn).toMatchObject({ status: "interrupted", error: "The session is closed." });
      expect(manager.status(file.path)).toBe("active");
    });

    it("interrupts the turn that follows when the interrupt came while the agent started", async () => {
      let ready!: (value: AgentSession) => void;
      const interrupts: number[] = [];
      session.interrupt = async () => void interrupts.push(1);
      agents[0] = { ...agents[0]!, agent: new FakeAgent("claude", () => new Promise((resolve) => (ready = resolve))) };
      const file = await manager.create(agents[0]!, { open: false });
      const controller = manager.conversation(file);
      void controller.sendForTurn("Slow start");
      await flush();
      expect(controller.phase).toBe("starting");
      await controller.interrupt();
      ready(session as unknown as AgentSession);
      await flush();
      await flush();
      expect(session.sent).toHaveLength(1);
      expect(interrupts).toEqual([1]);
    });

    it("says whether the agent continued the session that the note records", async () => {
      const { file } = await start({ message: "Hello", open: false });
      session.endTurn();
      await flush();
      const controller = manager.conversation(file);
      await controller.closeSession();
      expect(await controller.connect()).toBe(true);
      expect(claude.started.at(-1)?.resume).toBe("session-1");
      await controller.closeSession();
      agents[0] = {
        ...agents[0]!,
        agent: new FakeAgent("claude", async () => {
          if ((agents[0]!.agent as FakeAgent).started.at(-1)?.resume) throw new Error("No such session.");
          return session as unknown as AgentSession;
        }),
      };
      expect(await controller.connect()).toBe(false);
    });
  });

  describe("agents that change while a conversation runs", () => {
    /** An agent whose every session is new, and closes as a harness's does. */
    function closingAgent(harness: "claude" | "codex") {
      const sessions: ReturnType<typeof fakeSession>[] = [];
      const agent = new FakeAgent(harness, async () => {
        const next = fakeSession(`${harness}-${sessions.length + 1}`);
        next.close = async function () {
          this.closed = true;
          this.emit({ type: "closed" });
        };
        sessions.push(next);
        return next as unknown as AgentSession;
      });
      return { agent, sessions };
    }
    const settle = async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await flush();
    };

    it("starts a conversation with an agent that the host added, by its name", async () => {
      const added = closingAgent("claude");
      agents.push({ name: "work", color: "#000000", agent: added.agent });
      const { file, text } = await start({ message: "Hello", agent: "work", open: false });
      expect(added.sessions).toHaveLength(1);
      expect(text()).toMatch(/\nagent: work\n/);
      expect(manager.conversation(file).agentName).toBe("work");
    });

    it("keeps a replaced agent until its turn ends, then closes it, and the next message starts the new agent", async () => {
      const old = closingAgent("claude");
      agents[0] = { ...agents[0]!, agent: old.agent };
      const { file } = await start({ message: "Hello", open: false });
      const first = old.sessions[0]!;
      first.emit({ type: "turn-start" } as AgentEvent);
      const replaced = closingAgent("claude");
      agents[0] = { name: "claude", color: "#123456", agent: replaced.agent };
      manager.agentsChanged();
      await settle();
      expect(first.closed).toBe(false);
      expect(manager.status(file.path)).toBe("working");
      first.emit({ type: "turn-end", result: { status: "completed", text: "Done." } });
      await settle();
      expect(first.closed).toBe(true);
      const controller = manager.conversation(file);
      expect(controller.registered?.color).toBe("#123456");
      void controller.send("Again");
      await settle();
      expect(replaced.sessions).toHaveLength(1);
      expect(replaced.agent.started[0]!.resume).toBe("claude-1");
      expect(replaced.sessions[0]!.sent[0]).toMatch(/^Again/);
    });

    it("closes the idle session of an agent that the host removed, and the note goes on with the first agent", async () => {
      const old = closingAgent("claude");
      agents[0] = { ...agents[0]!, agent: old.agent };
      const { file } = await start({ message: "Hello", open: false });
      old.sessions[0]!.endTurn();
      await settle();
      const codex = closingAgent("codex");
      agents.splice(0, agents.length, { name: "codex", color: "#4f8cf7", agent: codex.agent });
      manager.agentsChanged();
      await settle();
      expect(old.sessions[0]!.closed).toBe(true);
      const controller = manager.conversation(file);
      expect(controller.agentName).toBe("codex");
      void controller.send("Again");
      await settle();
      expect(codex.sessions).toHaveLength(1);
    });

    it("keeps the agent of a run's conversation that the host removes, until the run closes the conversation", async () => {
      const old = closingAgent("claude");
      const retired = { name: "claude", color: "#d97757", agent: old.agent };
      agents[0] = retired;
      const runs = new ObsidianConversations(fake.app as never, manager, () => [...agents, retired]);
      const conversation = await runs.open({ agent: old.agent, name: "x", folder: "conversations" });
      const codex = closingAgent("codex");
      agents.splice(0, agents.length, { name: "codex", color: "#4f8cf7", agent: codex.agent });
      manager.agentsChanged();
      void conversation.send("Do the work.");
      await settle();
      expect(old.sessions).toHaveLength(1);
      expect(codex.sessions).toHaveLength(0);
      await conversation.close();
      expect(old.sessions[0]!.closed).toBe(true);
      expect(manager.conversation(fake.app.vault.getFileByPath(conversation.path)!).agentName).toBe("codex");
    });
  });
});
