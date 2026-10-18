import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => {
  class Base {}
  class MarkdownView {
    setViewData() {}
  }
  class FileSystemAdapter {
    constructor(private readonly root: string) {}
    getBasePath() {
      return this.root;
    }
  }
  class Notice {
    static messages: string[] = [];
    constructor(message: string) {
      Notice.messages.push(message);
    }
  }
  class Menu {
    static shown: string[][] = [];
    readonly titles: string[] = [];
    addItem(make: (item: { setTitle(title: string): unknown; onClick(run: () => void): unknown }) => void) {
      const item = {
        setTitle: (title: string) => (this.titles.push(title), item),
        onClick: () => item,
      };
      make(item);
      return this;
    }
    showAtMouseEvent() {
      Menu.shown.push(this.titles);
    }
  }
  return {
    Modal: Base,
    SuggestModal: Base,
    FuzzySuggestModal: Base,
    Scope: Base,
    TFile: Base,
    MarkdownView,
    FileSystemAdapter,
    Notice,
    Menu,
    debounce: (fn: unknown) => fn,
    getIcon: () => ({}),
    setIcon: () => undefined,
    setTooltip: () => undefined,
    prepareFuzzySearch: () => () => null,
    editorInfoField: {},
    normalizePath: (path: string) => path.replace(/\/+/g, "/").replace(/^\/|\/$/g, "") || "/",
    parseYaml: () => ({}),
    stringifyYaml: () => "",
  };
});

import type { Command, Plugin } from "obsidian";
import { Menu, Notice } from "obsidian";
import { COMMAND_PREFIX, createYami, type AgentWork, type ObsidianYami, type YamiPluginOptions } from "../../../src/obsidian/index.js";
import { ScriptedAgent } from "../../../src/testing/index.js";

const shown = () => (Menu as unknown as { shown: string[][] }).shown;
const notices = () => (Notice as unknown as { messages: string[] }).messages;
let reduceMotion = false;

beforeAll(() => {
  Object.assign(globalThis, { window: globalThis, matchMedia: () => ({ matches: reduceMotion }) });
});

/** A plugin over a fake Obsidian app: the commands, the ribbon, and the status bar it gets, and its unload. */
async function fakePlugin() {
  const root = await mkdtemp(join(tmpdir(), "yami-obsidian-"));
  const { FileSystemAdapter } = (await import("obsidian")) as unknown as { FileSystemAdapter: new (root: string) => object };
  const on = () => ({});
  let active: { path: string; basename: string; extension: string } | null = null;
  const app = {
    vault: { adapter: new FileSystemAdapter(root), on, offref: () => undefined, getConfig: () => undefined, getFileByPath: () => null },
    metadataCache: { on, offref: () => undefined, getFileCache: () => null, getCache: () => null },
    workspace: { on, onLayoutReady: () => undefined, iterateAllLeaves: () => undefined, getActiveFile: () => active, getActiveViewOfType: () => null },
  };
  const commands = new Map<string, Command>();
  const classes = new Set<string>();
  const status = {
    text: "",
    click: undefined as ((event: unknown) => void) | undefined,
    addClass: (name: string) => classes.add(name),
    setText(text: string) {
      this.text = text;
    },
    toggleClass: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)),
    addEventListener(_type: string, listener: (event: unknown) => void) {
      this.click = listener;
    },
  };
  const unload: (() => void)[] = [];
  let ribbon: (() => void) | undefined;
  const plugin = {
    app,
    manifest: { id: "test" },
    addCommand: (command: Command) => (commands.set(command.id, command), command),
    removeCommand: (id: string) => commands.delete(id),
    addRibbonIcon: (_icon: string, _title: string, callback: () => void) => (ribbon = callback),
    addStatusBarItem: () => status,
    register: (callback: () => void) => unload.push(callback),
    registerEvent: () => undefined,
    registerEditorExtension: () => undefined,
  } as unknown as Plugin;
  return {
    plugin,
    root,
    commands,
    status,
    working: () => classes.has("is-working"),
    ribbon: () => ribbon!(),
    open: (path: string | null) => (active = path === null ? null : { path, basename: path.replace(/\.md$/, ""), extension: "md" }),
    run: (id: string, checking = false) => {
      const command = commands.get(id)!;
      return command.checkCallback ? command.checkCallback(checking) : (command.callback?.(), true);
    },
    async unload() {
      for (const callback of unload.splice(0)) callback();
      await rm(root, { recursive: true, force: true });
    },
  };
}

let fake: Awaited<ReturnType<typeof fakePlugin>> | undefined;
afterEach(async () => {
  await fake?.unload();
  fake = undefined;
  notices().length = 0;
  shown().length = 0;
  reduceMotion = false;
});

async function build(options: Partial<YamiPluginOptions> = {}): Promise<ObsidianYami> {
  fake = await fakePlugin();
  return createYami(fake.plugin, { agents: [], folderColors: false, ...options });
}

describe("createYami", () => {
  it("gives every command of the library an id that starts with its prefix", async () => {
    await build({ agents: [new ScriptedAgent()] });
    const ids = [...fake!.commands.keys()];
    expect(ids.every((id) => id.startsWith(COMMAND_PREFIX))).toBe(true);
    expect(ids).toEqual(
      expect.arrayContaining([
        "yami-new-conversation-claude",
        "yami-end-conversation",
        "yami-stop",
        "yami-focus-composer",
        "yami-revert",
        "yami-run-session-claude",
        "yami-resume-session",
        "yami-stop-session",
        "yami-kill-session",
        "yami-wiki-search",
        "yami-new-module",
      ]),
    );
  });

  it("builds with no agents, and the ribbon says so", async () => {
    const yami = await build();
    expect(yami.registered).toEqual([]);
    expect([...fake!.commands.keys()].filter((id) => id.startsWith("yami-new-conversation-") || id.startsWith("yami-run-session-"))).toEqual([]);
    fake!.ribbon();
    expect(notices()).toEqual(["Yami has no agents."]);
  });
});

describe("setAgents", () => {
  it("adds, removes, and replaces the agents, their commands, and their setup, with no reload", async () => {
    const claude = new ScriptedAgent();
    const yami = await build({ agents: [claude] });
    let heard = 0;
    yami.onSessionsChange(() => heard++);
    const work = new ScriptedAgent();
    yami.setAgents([claude, { agent: work, name: "work", color: "#112233" }]);
    expect(yami.agents).toEqual([claude, work]);
    expect(yami.registered.map((r) => [r.name, r.color])).toEqual([
      ["claude", "#d97757"],
      ["work", "#112233"],
    ]);
    expect(work.preferences).toMatchObject({ cwd: fake!.root, tools: { name: "yami" }, skills: yami.skills() });
    expect(fake!.commands.get("yami-new-conversation-work")?.name).toBe("New conversation with work");
    expect(fake!.commands.get("yami-run-session-work")?.name).toBe("Run this session with Work");
    await vi.waitFor(() => expect(heard).toBe(1));

    yami.setAgents([{ agent: work, name: "work" }]);
    expect(fake!.commands.has("yami-new-conversation-claude")).toBe(false);
    expect(fake!.commands.has("yami-run-session-claude")).toBe(false);
    expect(yami.agentNamed("claude")).toBeUndefined();

    const create = vi.spyOn(yami.conversations, "create").mockResolvedValue({ path: "conversations/x.md" } as never);
    const replaced = new ScriptedAgent();
    yami.setAgents([{ agent: replaced, name: "work" }]);
    fake!.run("yami-new-conversation-work");
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ name: "work", agent: replaced }));
    fake!.ribbon();
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("refuses two agents of one name, and changes nothing", async () => {
    const claude = new ScriptedAgent();
    const yami = await build({ agents: [claude] });
    expect(() => yami.setAgents([claude, new ScriptedAgent()])).toThrow("Two agents are named claude: give each a name of its own.");
    expect(yami.agents).toEqual([claude]);
    expect(yami.registered.map((r) => r.name)).toEqual(["claude"]);
  });
});

describe("agent work of a host", () => {
  it("shows in the status bar, and a click opens its note or lists several", async () => {
    const yami = await build();
    const open = vi.spyOn(yami, "open").mockResolvedValue();
    const end = yami.addWork({ name: "claude", path: "notes/Ideas.md" });
    expect(fake!.status.text).toBe("claude working in Ideas");
    expect(fake!.working()).toBe(true);
    fake!.status.click!({});
    expect(open).toHaveBeenCalledWith("notes/Ideas.md");
    const other = yami.addWork({ name: "codex", path: "Plans.md" });
    expect(fake!.status.text).toBe("2 agents working");
    fake!.status.click!({});
    expect(shown()).toEqual([["claude working in Ideas", "codex working in Plans"]]);
    end();
    other();
    end();
    expect(fake!.status.text).toBe("");
    expect(fake!.working()).toBe(false);
    expect(yami.works).toEqual([]);
  });

  it("stops with yami-stop in its note, and only there", async () => {
    const yami = await build();
    const stop = vi.fn();
    const work: AgentWork = { name: "claude", path: "Ideas.md", stop };
    yami.addWork(work);
    fake!.open("Plans.md");
    expect(fake!.run("yami-stop", true)).toBe(false);
    fake!.open("Ideas.md");
    expect(fake!.run("yami-stop", true)).toBe(true);
    expect(stop).not.toHaveBeenCalled();
    fake!.run("yami-stop");
    expect(stop).toHaveBeenCalledOnce();
  });
});

describe("noteSessions", () => {
  it("shows a session's turn as work in its note, and yami-stop interrupts the turn", async () => {
    const claude = new ScriptedAgent();
    const yami = await build({ agents: [claude] });
    const notes = yami.noteSessions();
    const { session } = await notes.session("Ideas.md", "claude", { skills: [] });
    claude.queue(() => new Promise(() => undefined));
    const turn = session.send("Answer the question in the note.");
    await vi.waitFor(() => expect(fake!.status.text).toBe("claude working in Ideas"));
    fake!.open("Ideas.md");
    fake!.run("yami-stop");
    expect(await turn).toMatchObject({ status: "interrupted" });
    expect(fake!.status.text).toBe("");
  });
});

describe("options that change while the plugin runs", () => {
  it("reads the conversation folder, the idle minutes, and animate at each use", async () => {
    let folder = "chats";
    let minutes = 5;
    let animate = true;
    const yami = await build({ conversationFolder: () => folder, idleMinutes: () => minutes, animate: () => animate });
    const options = (yami.conversations as unknown as { options: { folder(): string; idleMinutes(): number; animate(): boolean } }).options;
    expect([yami.conversationFolder, options.folder(), options.idleMinutes(), options.animate()]).toEqual(["chats", "chats", 5, true]);
    folder = "talk";
    minutes = 30;
    animate = false;
    expect([yami.conversationFolder, options.folder(), options.idleMinutes(), options.animate()]).toEqual(["talk", "talk", 30, false]);
    animate = true;
    reduceMotion = true;
    expect(options.animate()).toBe(false);
  });
});
