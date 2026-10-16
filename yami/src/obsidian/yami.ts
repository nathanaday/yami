import { MarkdownView, Notice, type App, type Plugin, type TFile } from "obsidian";
import type { Agent } from "../agent/agent.js";
import type { Harness } from "../agent/types.js";
import { CONVERSATION_FOLDER } from "../conversation/conversations.js";
import { basename } from "../document/document.js";
import { SessionTemplate, type ActionResult, type YamiModule } from "../module/module.js";
import type { Session } from "../module/session.js";
import { Yami } from "../module/yami.js";
import type { WikiOptions } from "../wiki/wiki.js";
import { vaultRoot, type ConversationAgent } from "./agents.js";
import { CollabHub, installCollab, uninstallCollab } from "./collab/hub.js";
import { addConversationCommands, addModuleCommands, addSessionCommands, addWikiCommands } from "./commands.js";
import { ConversationManager } from "./conversation/manager.js";
import { ObsidianConversations } from "./conversation/obsidian-conversations.js";
import { PermissionPrompts } from "./prompts/permission-modal.js";
import { ObsidianVault } from "./vault.js";
import { ignoredPaths, openNote, pickOne, watchWiki, type OpenMode } from "./wiki/open.js";

/** The color of each harness's cursor and name in a note, unless the host gives one. */
export const HARNESS_COLORS: Record<Harness, string> = { claude: "#d97757", codex: "#4f8cf7" };
/** Minutes after which an agent process with no open message box closes. */
export const IDLE_MINUTES = 15;

/** An agent with the name and color it has in the vault. Both default to its harness's. */
export interface AgentEntry {
  agent: Agent;
  name?: string;
  color?: string;
}

export type CommandGroup = "conversations" | "sessions" | "wiki";

export interface YamiPluginOptions {
  /** The plugin's agents. The first is the default. Yami sets their working directory, tools, and skills. */
  agents: (Agent | AgentEntry)[];
  /** The plugin's modules. The wiki module is built in. */
  modules?: YamiModule[];
  /** Options of the wiki. The conversation folder and Obsidian's Excluded files always stay out of its index. */
  wiki?: WikiOptions;
  /** The folder of conversation notes. Default `conversations`. */
  conversationFolder?: string;
  /** Minutes after which an agent process with no open message box closes. Default 15. */
  idleMinutes?: number;
  /** The groups of commands to add. Default: every group. The commands of the modules' templates and actions are always added. */
  commands?: Partial<Record<CommandGroup, boolean>>;
  /** A status bar item that says which agents work. Default true. */
  statusBar?: boolean;
}

/**
 * Builds the Yami of a plugin: the vault over the Obsidian API, the wiki, the shared documents, the
 * conversation notes with their message box, the agents, and the commands. It enables the modules when the
 * workspace is ready, and stops everything when the plugin unloads. Call it once, in `onload`.
 */
export function createYami(plugin: Plugin, options: YamiPluginOptions): ObsidianYami {
  return new ObsidianYami(plugin, options);
}

/** A Yami in Obsidian: the SDK's Yami, with the conversation notes, the shared documents, and the helpers that commands use. */
export class ObsidianYami extends Yami {
  readonly app: App;
  readonly plugin: Plugin;
  /** The shared documents of the window. */
  readonly hub: CollabHub;
  /** The conversation notes, with their message box. Other plugins start conversations with it. */
  readonly conversations: ConversationManager;
  /** The agents with their names and colors, as conversations show them. */
  readonly registered: ConversationAgent[];
  #status: HTMLElement | undefined;

  constructor(plugin: Plugin, options: YamiPluginOptions) {
    const app = plugin.app;
    const registered = options.agents.map((entry): ConversationAgent => {
      const { agent, name, color } = "harness" in entry ? { agent: entry, name: undefined, color: undefined } : entry;
      return { agent, name: name ?? agent.harness, color: color ?? HARNESS_COLORS[agent.harness] };
    });
    const names = registered.map((r) => r.name);
    const twice = names.find((name, i) => names.indexOf(name) !== i);
    if (twice) throw new Error(`Two agents are named ${twice}: give each a name of its own.`);
    const folder = options.conversationFolder ?? CONVERSATION_FOLDER;
    const exclude = options.wiki?.exclude;
    // The run conversations need the conversation manager, which the hub comes before. Both wait until
    // super() succeeds, so a Yami that fails to build leaves no hub in the window.
    let runs: ObsidianConversations | undefined;
    super({
      vault: new ObsidianVault(app, vaultRoot(app)),
      agents: registered.map((r) => r.agent),
      modules: options.modules,
      wiki: { ...options.wiki, exclude: () => [...ignoredPaths(app), ...(typeof exclude === "function" ? exclude() : (exclude ?? []))] },
      conversations: { open: (open) => runs!.open(open) },
      conversationFolder: folder,
    });
    const hub = installCollab(app, plugin);
    const conversations = new ConversationManager(app, hub, new PermissionPrompts(app), {
      agents: () => registered,
      folder: () => folder,
      animate: () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      idleMinutes: () => options.idleMinutes ?? IDLE_MINUTES,
      onActivity: () => this.updateStatus(),
    });
    runs = new ObsidianConversations(app, conversations, () => registered);
    this.app = app;
    this.plugin = plugin;
    this.hub = hub;
    this.conversations = conversations;
    this.registered = registered;

    conversations.install(plugin);
    watchWiki(app, plugin, this.wiki);
    app.workspace.onLayoutReady(() =>
      this.enable().catch((error: Error) => {
        console.error(error);
        new Notice(error.message, 10_000);
      }),
    );
    plugin.register(() => {
      // Closing the conversations ends every turn, so the runs end too; the teardown does not wait for them.
      void this.close().catch((error) => console.error(error));
      void conversations
        .destroy()
        .catch((error) => console.error(error))
        .finally(() => uninstallCollab(hub));
    });

    const groups = { conversations: true, sessions: true, wiki: true, ...options.commands };
    if (groups.conversations) addConversationCommands(this);
    if (groups.sessions) addSessionCommands(this);
    if (groups.wiki) addWikiCommands(this);
    addModuleCommands(this);
    if (options.statusBar ?? true) {
      this.#status = plugin.addStatusBarItem();
      this.#status.addClass("yami-status");
      this.onSession(() => this.updateStatus());
    }
  }

  /** The agent registered under a name: conversation notes name their agent so. */
  agentNamed(name: unknown): Agent | undefined {
    return this.registered.find((r) => r.name === name)?.agent;
  }

  /** The note in the active editor. */
  activeFile(): TFile | undefined {
    return this.app.workspace.getActiveViewOfType(MarkdownView)?.file ?? this.app.workspace.getActiveFile() ?? undefined;
  }

  /** The selected text of the active editor, on one line. */
  activeSelection(): string {
    return this.app.workspace.getActiveViewOfType(MarkdownView)?.editor.getSelection().replace(/\s+/g, " ").trim() ?? "";
  }

  /**
   * The session open in the active editor: a session document of a module of this Yami, and of the
   * module or the template given. It reads the properties from Obsidian's cache, so commands can ask it often.
   */
  activeSession(of?: YamiModule | SessionTemplate): Session | undefined {
    const file = this.app.workspace.getActiveFile();
    const properties = file?.extension === "md" ? this.app.metadataCache.getFileCache(file)?.frontmatter : undefined;
    if (!file || properties?.type !== "session") return undefined;
    const module = this.module(String(properties.module ?? ""));
    if (!module || module.sessionsIn === "none" || file.path !== `${module.layout.sessions}/${file.name}`) return undefined;
    if (of instanceof SessionTemplate ? module.templateOf(properties.template) !== of : of && of !== module) return undefined;
    return this.session(file.path);
  }

  /** The properties of a note, from Obsidian's cache. */
  properties(path: string): Record<string, unknown> {
    const file = this.app.vault.getFileByPath(path);
    return (file && this.app.metadataCache.getFileCache(file)?.frontmatter) ?? {};
  }

  /** Opens a note: in this tab, in a new tab, or as a link at the cursor of the active editor. */
  open(path: string, mode: OpenMode = "open"): Promise<void> {
    return openNote(this.app, path, mode);
  }

  /** Lets the person pick one item by typing. Resolves with nothing when the person closes the list. */
  pick<T>(items: T[], label: (item: T) => string, placeholder: string): Promise<T | undefined> {
    return pickOne(this.app, items, label, placeholder);
  }

  /** Shows what a piece of work reports when it ends: its message in a notice, and the note it names, opened. An error shows in a notice too. */
  notify(work: Promise<ActionResult>): void {
    work.then(
      async (result) => {
        const { message, open } = typeof result === "object" ? result : { message: result || undefined, open: undefined };
        if (open) await this.open(open);
        if (message) new Notice(message);
      },
      (error: Error) => {
        console.error(error);
        new Notice(`Yami: ${error.message}`, 10_000);
      },
    );
  }

  /** Says in the status bar which agents work. */
  updateStatus(): void {
    if (!this.#status) return;
    const working = this.conversations.working;
    const running = this.running;
    const text =
      working.length === 1
        ? `${working[0]!.agentName} working in ${working[0]!.file.basename}`
        : working.length
          ? `${working.length} agents working`
          : running.length
            ? `Checking ${running.length === 1 ? basename(running[0]!.path) : `${running.length} sessions`}`
            : "";
    this.#status.setText(text);
    this.#status.toggleClass("is-working", working.length > 0 || running.length > 0);
  }
}
