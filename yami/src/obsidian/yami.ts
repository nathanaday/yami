import { MarkdownView, Menu, Notice, type App, type Plugin, type TAbstractFile, type TFile } from "obsidian";
import type { Agent } from "../agent/agent.js";
import type { Harness } from "../agent/types.js";
import { basename } from "../document/document.js";
import { Flow, type ActionResult, type ModuleAct, type ModuleAction, type YamiModule } from "../module/module.js";
import type { Session } from "../module/session.js";
import { Yami } from "../module/yami.js";
import type { WikiOptions } from "../wiki/wiki.js";
import { noAgentsMessage, vaultRoot, type ConversationAgent } from "./agents.js";
import { CollabHub, installCollab, uninstallCollab } from "./collab/hub.js";
import { ChangeFeed } from "./change-feed.js";
import { showFolderColors } from "./colors.js";
import { watchModules } from "./discovery.js";
import { checkModuleIcons } from "./icons.js";
import { addConversationCommands, addModuleCommands, addNewModuleCommand, addSessionCommands, addWikiCommands } from "./commands.js";
import { ConversationManager } from "./conversation/manager.js";
import { ObsidianConversations } from "./conversation/obsidian-conversations.js";
import { NoteSessions, type AgentWork, type NoteEvents, type NoteSessionsOptions } from "./note-sessions.js";
import { PermissionPrompts } from "./prompts/permission-modal.js";
import { ObsidianVault } from "./vault.js";
import { askText, ignoredPaths, openNote, pickOne, watchWiki, type AskOptions, type OpenMode } from "./wiki/open.js";

/** The color of each harness's cursor and name in a note, unless the host gives one. */
export const HARNESS_COLORS: Record<Harness, string> = { claude: "#d97757", codex: "#4f8cf7" };
/** Minutes after which an agent process with no open message box closes. */
export const IDLE_MINUTES = 15;

/**
 * An agent with the name and color it has in the vault. Both default to its harness's. `yami.registered`
 * gives each as a `ConversationAgent`, with the name and the color filled in.
 */
export interface AgentEntry {
  agent: Agent;
  name?: string;
  color?: string;
}

export type CommandGroup = "conversations" | "sessions" | "wiki" | "modules";

export interface YamiPluginOptions {
  /**
   * The plugin's agents. The first is the default. Yami sets their working directory, tools, and skills.
   * Each needs a name of its own. `yami.setAgents` changes them while the plugin runs. None is allowed.
   */
  agents: (Agent | AgentEntry)[];
  /** The plugin's modules. The wiki and threads modules are built in. */
  modules?: YamiModule[];
  /** Whether the Yami holds the built-in threads module. Default true. With false, a module of the plugin can take the id `threads`. */
  threads?: boolean;
  /** Options of the wiki. The conversation folder and Obsidian's Excluded files always stay out of its index. */
  wiki?: WikiOptions;
  /** The folder of conversation notes. Default `conversations`. A function is read at each use. */
  conversationFolder?: string | (() => string);
  /** Minutes after which an agent process with no open message box and no turn closes. Default 15. A function is read at each use. */
  idleMinutes?: number | (() => number);
  /**
   * Whether an agent's edits play as typing in a note that the person sees. Default true. A function is read
   * at each edit. Edits never play as typing while the system asks for reduced motion.
   */
  animate?: boolean | (() => boolean);
  /**
   * The groups of commands to add. Default: every group. `modules` is the New module command. The commands
   * of the modules' flows and actions are always added.
   */
  commands?: Partial<Record<CommandGroup, boolean>>;
  /** A status bar item that says which agents work. Default true. */
  statusBar?: boolean;
  /** Each module's folders in the module's colors in the file explorer, and `internal/` in gray. Default true. */
  folderColors?: boolean;
}

/**
 * Builds the Yami of a plugin: the vault over the Obsidian API, the wiki, the shared documents, the
 * conversation notes with their message box, the agents, and the commands. It enables the modules when the
 * workspace is ready, and stops everything when the plugin unloads. Call it once, in `onload`.
 */
export function createYami(plugin: Plugin, options: YamiPluginOptions): ObsidianYami {
  return new ObsidianYami(plugin, options);
}

/** The registered agents of entries: a name and a color for each, and no name twice. */
function registerAgents(entries: readonly (Agent | AgentEntry)[]): ConversationAgent[] {
  const registered = entries.map((entry): ConversationAgent => {
    const { agent, name, color } = "harness" in entry ? { agent: entry, name: undefined, color: undefined } : entry;
    return { agent, name: name ?? agent.harness, color: color ?? HARNESS_COLORS[agent.harness] };
  });
  const names = registered.map((r) => r.name);
  const twice = names.find((name, i) => names.indexOf(name) !== i);
  if (twice) throw new Error(`Two agents are named ${twice}: give each a name of its own.`);
  return registered;
}

const read = <T>(value: T | (() => T)): T => (typeof value === "function" ? (value as () => T)() : value);

/** A Yami in Obsidian: the SDK's Yami, with the conversation notes, the shared documents, and the helpers that commands use. */
export class ObsidianYami extends Yami {
  readonly app: App;
  readonly plugin: Plugin;
  /** The shared documents of the window. */
  readonly hub: CollabHub;
  /** The conversation notes, with their message box. Other plugins start conversations with it. */
  readonly conversations: ConversationManager;
  #registered: ConversationAgent[];
  /** The agents that `setAgents` removed, so that a run that is live keeps its agent's name and color. */
  #retired: ConversationAgent[] = [];
  readonly #idleMinutes: number | (() => number);
  readonly #animate: boolean | (() => boolean);
  readonly #works = new Set<AgentWork>();
  readonly #noteSessions = new Set<{ close(): Promise<void> }>();
  readonly #noteEvents = new Set<NoteEvents>();
  /** The functions that bring the commands of each agent up to date. */
  readonly #agentCommands: (() => void)[] = [];
  #status: HTMLElement | undefined;
  readonly #sessionsFeed = new ChangeFeed("sessions", 150);
  readonly #wikiFeed = new ChangeFeed("wiki", 300);

  constructor(plugin: Plugin, options: YamiPluginOptions) {
    const app = plugin.app;
    const registered = registerAgents(options.agents);
    const exclude = options.wiki?.exclude;
    // The run conversations need the conversation manager, which the hub comes before. Both wait until
    // super() succeeds, so a Yami that fails to build leaves no hub in the window.
    let runs: ObsidianConversations | undefined;
    super({
      vault: new ObsidianVault(app, vaultRoot(app)),
      agents: registered.map((r) => r.agent),
      modules: options.modules,
      threads: options.threads,
      wiki: { ...options.wiki, exclude: () => [...ignoredPaths(app), ...(typeof exclude === "function" ? exclude() : (exclude ?? []))] },
      conversations: { open: (open) => runs!.open(open) },
      conversationFolder: options.conversationFolder,
    });
    this.#registered = registered;
    this.#idleMinutes = options.idleMinutes ?? IDLE_MINUTES;
    this.#animate = options.animate ?? true;
    const hub = installCollab(app, plugin);
    const conversations = new ConversationManager(app, hub, new PermissionPrompts(app), {
      agents: () => this.#registered,
      folder: () => this.conversationFolder,
      animate: this.animate,
      idleMinutes: () => read(this.#idleMinutes),
      onActivity: () => this.updateStatus(),
      noAgents: noAgentsMessage(plugin.manifest.name),
    });
    runs = new ObsidianConversations(app, conversations, () => [...this.#registered, ...this.#retired]);
    this.app = app;
    this.plugin = plugin;
    this.hub = hub;
    this.conversations = conversations;

    conversations.install(plugin);
    watchWiki(app, plugin, this.wiki);
    watchModules(app, plugin, this);
    const watch = (file: TAbstractFile, old?: string) => {
      const paths = old ? [file.path, old] : [file.path];
      if (paths.some((path) => this.concernsSessions(path))) this.#sessionsFeed.changed();
      // A change to a note the index leaves out, such as a conversation, cannot change the wiki.
      if (paths.some((path) => this.wiki.note(path) !== undefined || this.wiki.holds(path, this.app.metadataCache.getCache(path)?.frontmatter ?? {}))) this.#wikiFeed.changed();
    };
    plugin.registerEvent(app.vault.on("create", watch));
    plugin.registerEvent(app.vault.on("modify", watch));
    plugin.registerEvent(app.vault.on("delete", watch));
    plugin.registerEvent(app.vault.on("rename", watch));
    plugin.registerEvent(app.metadataCache.on("changed", (file) => watch(file)));
    this.onSession(() => this.#sessionsFeed.changed());
    plugin.register(() => {
      this.#sessionsFeed.stop();
      this.#wikiFeed.stop();
    });
    app.workspace.onLayoutReady(() =>
      this.enable().catch((error: Error) => {
        console.error(error);
        new Notice(error.message, 10_000);
      }),
    );
    plugin.register(() => {
      // Closing the conversations ends every turn, so the runs end too; the teardown does not wait for them.
      void this.close().catch((error) => console.error(error));
      for (const notes of this.#noteSessions) void notes.close().catch((error) => console.error(error));
      void conversations
        .destroy()
        .catch((error) => console.error(error))
        .finally(() => uninstallCollab(hub));
    });

    const groups = { conversations: true, sessions: true, wiki: true, modules: true, ...options.commands };
    if (groups.conversations) this.#agentCommands.push(addConversationCommands(this));
    if (groups.sessions) this.#agentCommands.push(addSessionCommands(this));
    if (groups.wiki) addWikiCommands(this);
    if (groups.modules) addNewModuleCommand(this);
    checkModuleIcons(this.modules);
    const syncCommands = addModuleCommands(this);
    plugin.register(
      this.onModulesChange(() => {
        checkModuleIcons(this.modules);
        syncCommands();
        this.#sessionsFeed.changed();
      }),
    );
    if (options.folderColors ?? true) showFolderColors(this, plugin);
    if (options.statusBar ?? true) {
      const status = plugin.addStatusBarItem();
      status.addClass("yami-status");
      status.addEventListener("click", (event) => this.#openWork(event));
      this.#status = status;
      this.onSession(() => this.updateStatus());
    }
  }

  /**
   * Whether an agent's edits play as typing now: the `animate` option, and no request of the system for
   * reduced motion. A function, so a host's own `Presence` or `AgentPeer` follows the same rule.
   * @example
   * const presence = new Presence({ name: "claude", color: "#d97757" }, yami.animate);
   */
  readonly animate = (): boolean => read(this.#animate) && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /** The agents with their names and colors, as conversations and commands show them. `setAgents` changes them. */
  get registered(): readonly ConversationAgent[] {
    return this.#registered;
  }

  /**
   * Replaces the agents while the plugin runs, from the host's settings for example. It takes the entries of
   * the `agents` option, and throws before it changes anything when two have one name. Yami sets the working
   * directory, the tools, and the skills of a new agent. The commands of each agent follow at once (New
   * conversation with each, Run this session with each), and so do the status bar, the composers, the acts
   * of the sessions, and `onSessionsChange`. A conversation or a run keeps the agent it works with until its
   * turn or the run ends. Then a conversation closes the agent session of an agent that is gone or replaced,
   * so no process of a removed agent stays open, and its next message starts the agent of the note's name
   * now. A note whose agent is gone goes on with the first agent. The sessions of `noteSessions` do the same.
   * @example
   * this.yami.setAgents(this.settings.profiles.map((p) => ({ agent: this.agentOf(p), name: p.name, color: p.color })));
   */
  override setAgents(agents: readonly (Agent | AgentEntry)[]): void {
    const registered = registerAgents(agents);
    super.setAgents(registered.map((r) => r.agent));
    const kept = new Set(registered.map((r) => r.agent));
    this.#retired = [...this.#retired, ...this.#registered].filter((r) => !kept.has(r.agent));
    this.#registered = registered;
    for (const sync of this.#agentCommands) sync();
    this.conversations.agentsChanged();
    for (const events of this.#noteEvents) events.agentsChanged();
    this.updateStatus();
    this.#sessionsFeed.changed();
  }

  /**
   * Shows a piece of agent work in the status bar, as conversations and runs show, until the function that it
   * returns ends it. When the work has a `path` and a `stop`, `yami-stop` in that note calls `stop`. A host
   * adds the work of the agent sessions that it runs itself; a session of `noteSessions` adds its turns itself.
   * @example
   * const end = yami.addWork({ name: "claude", path: file.path, stop: () => session.interrupt() });
   * try { await session.send(prompt); } finally { end(); }
   */
  addWork(work: AgentWork): () => void {
    this.#works.add(work);
    this.updateStatus();
    return () => {
      if (this.#works.delete(work)) this.updateStatus();
    };
  }

  /** The agent work that `addWork` added and that has not ended, oldest first. */
  get works(): readonly AgentWork[] {
    return [...this.#works];
  }

  /**
   * Harness sessions of notes: one for each note and agent, for agents that work in a note that is not a
   * conversation note, such as an agent that answers in the margin. A session starts when the host asks for
   * it, with the options and the host's own state that `setup` makes for it. It continues the session that
   * the host stored for the note and agent, or starts a new one when the harness lost it. It closes after the
   * idle minutes with no turn, follows `setAgents`, and closes when the plugin unloads. It follows a renamed
   * note or folder, and a removed note forgets it: Yami hears the vault's events itself. The host stores the
   * ids: it gives the stored ones in `ids`, and `save` gets a new object with every id after each change.
   * @example
   * const notes = this.yami.noteSessions({
   *   ids: data.sessions,
   *   save: (ids) => this.saveData({ ...data, sessions: ids }),
   *   setup: ({ file }) => { const reply = new Reply(file); return { options: { instructions, access: "read-only", tools: reply.tools, skills: [] }, state: reply }; },
   * });
   * const { session, state: reply } = await notes.session(file.path, "claude");
   * await notes.forget(file.path);
   */
  noteSessions<State = undefined>(options: NoteSessionsOptions<State> = {}): NoteSessions<State> {
    const notes = new NoteSessions<State>(
      {
        agents: () => this.#registered,
        file: (path) => this.app.vault.getFileByPath(path),
        idleMinutes: () => read(this.#idleMinutes),
        addWork: (work) => this.addWork(work),
        follow: (events) => {
          this.#noteEvents.add(events);
          this.plugin.registerEvent(this.app.vault.on("rename", (file, old) => events.renamed(old, file.path)));
          this.plugin.registerEvent(this.app.vault.on("delete", (file) => events.removed(file.path)));
        },
      },
      options,
    );
    this.#noteSessions.add(notes);
    return notes;
  }

  /** The name the agent is registered under, also for an agent that `setAgents` removed while a run used it. */
  override agentName(agent: Agent): string {
    return [...this.#registered, ...this.#retired].find((r) => r.agent === agent)?.name ?? agent.harness;
  }

  /**
   * Calls the listener when the sessions or the modules may look different: a session document or a
   * module's document is created, changed, renamed, or removed; a run changes its status; or a discovery
   * changes `modules` or `problems`, as `onModulesChange` hears. The wiki's change documents are under its
   * internal folder, so a view hears of each proposal, approval, rejection, and failure here too. So a view
   * of the modules, the sessions, and the proposals needs this feed only. Calls that come close together
   * become one, a moment after the last. Returns the function that stops it.
   */
  onSessionsChange(listener: () => void): () => void {
    return this.#sessionsFeed.on(listener);
  }

  /**
   * Calls the listener when the wiki may look different: a note that the index holds, or would hold, is
   * created, changed, renamed, or removed. Calls that come close together become one. The wiki reads the
   * vault again at its next query. Returns the function that stops it.
   */
  onWikiChange(listener: () => void): () => void {
    return this.#wikiFeed.on(listener);
  }

  /** Whether a path is a session document, or a document of a module. */
  private concernsSessions(path: string): boolean {
    return this.modules.some((module) => [module.layout.sessions, module.layout.internal].some((folder) => path.startsWith(`${folder}/`)));
  }

  /** Does an act of a module: creates the session of a `new` act and opens it, or does the action. */
  runModuleAct(act: ModuleAct): Promise<void> {
    return act.kind === "new" ? this.newSession(act.flow) : this.runAction(act.action);
  }

  /** Creates a session from a flow, opens it, and says so. */
  newSession(flow: Flow): Promise<void> {
    return this.notify(flow.create().then((session) => ({ message: `Created ${session.path}.`, open: session.path })));
  }

  /**
   * Does an action of a module, and shows what it reports: an action on a session does it on the one given;
   * an action with choices first lets the person pick one.
   */
  runAction(action: ModuleAction, session?: Session): Promise<void> {
    if ("on" in action) return session ? this.notify(action.run(session)) : Promise.resolve();
    if (!("choose" in action)) return this.notify(action.run());
    const choose = action.choose;
    return this.notify(
      choose.items().then(async (items) => {
        if (!items.length) return choose.empty ?? "There is nothing to choose.";
        const choice = await this.pick(items, choose.label, choose.placeholder);
        return choice === undefined ? undefined : action.run(choice);
      }),
    );
  }

  /** The agent registered under a name: conversation notes name their agent so. */
  override agentNamed(name: unknown): Agent | undefined {
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
   * module or the flow given. It reads the properties from Obsidian's cache, so commands can ask it often.
   */
  activeSession(of?: YamiModule | Flow): Session | undefined {
    const file = this.app.workspace.getActiveFile();
    const properties = file?.extension === "md" ? this.app.metadataCache.getFileCache(file)?.frontmatter : undefined;
    if (!file || properties?.type !== "session") return undefined;
    const module = this.module(String(properties.module ?? ""));
    if (!module || module.sessionsIn === "none" || file.path !== `${module.layout.sessions}/${file.name}`) return undefined;
    if (of instanceof Flow ? module.flowOf(properties.flow) !== of : of && of !== module) return undefined;
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

  /**
   * Asks the person for a text in a prompt with one field: Enter gives the text, trimmed, and Escape gives
   * nothing. The commands that create a module or a form ask for its name so, and Wiki: reject a change asks
   * for the reason. The prompt has the class `yami-ask`; its one item reads `<hint>: <text>`. With
   * `empty`, the item reads that text while the field is empty, and Enter then gives `""`; without it, an
   * empty field has no item. The README table "The prompts" names its elements.
   * @example
   * const name = await yami.ask("The name of the new flow, such as Daily review", "Create the flow");
   * const reason = await yami.ask("Why the change is rejected", "Reject the change", { empty: "Reject the change with no reason" });
   */
  ask(placeholder: string, hint: string, options: AskOptions = {}): Promise<string | undefined> {
    return askText(this.app, placeholder, hint, options);
  }

  /**
   * Lets the person pick one item by typing. Resolves with nothing when the person closes the list. The
   * prompt has the class `yami-pick`, and each item reads `label(item)`. The README table "The prompts"
   * names its elements.
   * @example
   * const flow = await yami.pick(module.flows, (f) => f.title, "The flow of the new Threads session");
   */
  pick<T>(items: T[], label: (item: T) => string, placeholder: string): Promise<T | undefined> {
    return pickOne(this.app, items, label, placeholder);
  }

  /** Shows what a piece of work reports when it ends: its message in a notice, and the note it names, opened. An error shows in a notice too. Resolves when the notice shows. */
  notify(work: Promise<ActionResult>): Promise<void> {
    return work.then(
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

  /** The agents that work now, with the note each works in: conversations and `addWork`, or else the live runs. */
  #working(): { text: string; path?: string }[] {
    const agents = [
      ...this.conversations.working.map((controller) => ({ name: controller.agentName, path: controller.file.path })),
      ...[...this.#works].map((work) => ({ name: work.name, path: work.path })),
    ];
    if (agents.length) return agents.map(({ name, path }) => ({ text: `${name} working${path ? ` in ${basename(path)}` : ""}`, path }));
    return this.running.map((session) => ({ text: `Checking ${basename(session.path)}`, path: session.path }));
  }

  /** Opens the note where the agent works. With several, a menu lists them. */
  #openWork(event: MouseEvent): void {
    const working = this.#working().filter((entry) => entry.path);
    if (working.length === 1) return void this.open(working[0]!.path!);
    if (!working.length) return;
    const menu = new Menu();
    for (const entry of working) menu.addItem((item) => item.setTitle(entry.text).onClick(() => void this.open(entry.path!)));
    menu.showAtMouseEvent(event);
  }

  /**
   * Says in the status bar which agents work: `claude working in Ideas` for one agent of a conversation or of
   * `addWork`, `2 agents working` for several, and else `Checking Weekly` or `Checking 2 sessions` for the live
   * runs. A click opens the note where the agent works; with several, a menu lists them.
   */
  updateStatus(): void {
    if (!this.#status) return;
    const working = this.#working();
    const checking = !this.conversations.working.length && !this.#works.size;
    const text = working.length === 1 ? working[0]!.text : !working.length ? "" : checking ? `Checking ${working.length} sessions` : `${working.length} agents working`;
    this.#status.setText(text);
    this.#status.toggleClass("is-working", working.length > 0);
  }
}
