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
import { applyOps } from "../../../src/obsidian/collab/text-ops.js";
import { ConversationManager } from "../../../src/obsidian/conversation/manager.js";

// The mocks take the arguments that the tests need, not those of Obsidian's classes.
const FakeFile = TFile as unknown as new (path: string) => TFile;
const FakeView = MarkdownView as unknown as new () => MarkdownView;

beforeAll(() => {
  Object.assign(globalThis, { window: globalThis });
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A harness session that the test drives with `emit`. */
function fakeSession() {
  let listener: (event: AgentEvent) => void = () => undefined;
  return {
    id: "session-1",
    closed: false,
    sent: [] as string[],
    on(next: (event: AgentEvent) => void) {
      listener = next;
    },
    send(text: string) {
      this.sent.push(text);
      return new Promise<TurnResult>(() => undefined);
    },
    emit: (event: AgentEvent) => listener(event),
    endTurn(status: TurnResult["status"] = "completed") {
      listener({ type: "turn-start" } as AgentEvent);
      listener({ type: "turn-end", result: { status, text: "Done." } });
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
    claude = new FakeAgent("claude", async () => session);
    agents = [
      { name: "claude", color: "#d97757", agent: claude },
      { name: "codex", color: "#4f8cf7", agent: new FakeAgent("codex", async () => session) },
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

  it("shows a queued message as working when listeners hear of the end", async () => {
    const { file } = await start({ message: "First", open: false });
    await manager.controller(file)!.send("Second");
    const seen: string[] = [];
    manager.onTurnEnd(file.path, () => seen.push(manager.status(file.path)));
    session.endTurn();
    await flush();
    expect(seen).toEqual(["working"]);
    expect(session.sent.at(-1)).toBe("Second");
  });

  it("follows a renamed note, isolates a failing listener, and stops calling after unsubscribe", async () => {
    const { file } = await start({ message: "Hello", title: "Named", open: false });
    const turns: TurnEnd[] = [];
    manager.onTurnEnd(file.path, () => {
      throw new Error("listener bug");
    });
    const stop = manager.onTurnEnd(file.path, (turn) => turns.push(turn));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await fake.app.fileManager.renameFile(file, "conversations/Renamed.md");
    session.endTurn("interrupted");
    await flush();
    expect(turns).toEqual([{ path: "conversations/Renamed.md", status: "interrupted", text: "Done." }]);
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
    stop();
    session.endTurn();
    await flush();
    expect(turns).toHaveLength(1);
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
});
