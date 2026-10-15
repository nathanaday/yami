import { MarkdownView, Notice, Plugin, type TFile } from "obsidian";
import { createYami } from "yami";
import type { Agent } from "yami/agent";
import { ClaudeAgent } from "yami/agent/claude";
import { CodexAgent } from "yami/agent/codex";
import { link, timestamp } from "yami/document";
import { createSession, enableModule, layout, moduleSkills, moduleTools, runSession, type Module } from "yami/module";
import { hello } from "yami/modules/hello";
import { SOURCES, wiki as wikiModule } from "yami/modules/wiki";
import { captureSource, captureSources, Wiki } from "yami/wiki";
import {
  type CollabHub,
  type ConversationAgent,
  ConversationManager,
  findingRows,
  ignoredPaths,
  installCollab,
  matchRows,
  NoteListModal,
  type NoteRow,
  ObsidianConversations,
  ObsidianVault,
  PermissionPrompts,
  pickOne,
  uninstallCollab,
  vaultRoot,
  watchWiki,
  WikiCompareModal,
  WikiSearchModal,
} from "yami/obsidian";

const MODULES = [hello, wikiModule];
const CONVERSATION_FOLDER = "conversations";
const IDLE_MINUTES = 15;
const COLORS = { claude: "#d97757", codex: "#4f8cf7" };

declare global {
  interface Window {
    yami?: {
      claude: ClaudeAgent;
      codex: CodexAgent;
      conversations: ConversationManager;
      wiki: Wiki;
      ClaudeAgent: typeof ClaudeAgent;
      CodexAgent: typeof CodexAgent;
    };
  }
}

export default class YamiPlugin extends Plugin {
  private yami = createYami();
  private claude!: ClaudeAgent;
  private codex!: CodexAgent;
  private agents!: ConversationAgent[];
  private vault!: ObsidianVault;
  private wiki!: Wiki;
  hub!: CollabHub;
  conversations!: ConversationManager;
  private statusEl!: HTMLElement;

  async onload() {
    const cwd = vaultRoot(this.app);
    this.vault = new ObsidianVault(this.app, cwd);
    this.wiki = new Wiki(this.vault, { exclude: () => [CONVERSATION_FOLDER, ...ignoredPaths(this.app)] });
    watchWiki(this.app, this, this.wiki);
    const tools = moduleTools({ vault: this.vault, wiki: this.wiki }, MODULES);
    // Every agent can invoke each module skill as /<module>:<skill>.
    const skills = moduleSkills(this.vault, MODULES);
    this.claude = new ClaudeAgent({ preferences: { cwd, tools, skills } });
    this.codex = new CodexAgent({ preferences: { cwd, tools, skills } });
    this.agents = [
      { name: "claude", color: COLORS.claude, agent: this.claude },
      { name: "codex", color: COLORS.codex, agent: this.codex },
    ];

    this.hub = installCollab(this.app, this);
    this.conversations = new ConversationManager(this.app, this.hub, new PermissionPrompts(this.app), {
      agents: () => this.agents,
      folder: () => CONVERSATION_FOLDER,
      animate: () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      idleMinutes: () => IDLE_MINUTES,
      onActivity: () => this.updateStatus(),
    });
    this.conversations.install(this);
    window.yami = { claude: this.claude, codex: this.codex, conversations: this.conversations, wiki: this.wiki, ClaudeAgent, CodexAgent };

    this.app.workspace.onLayoutReady(() => this.enableModules());

    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("yami-status");
    this.addRibbonIcon("message-square-plus", "New conversation", () => this.newConversation(this.agents[0]!));
    for (const registered of this.agents) {
      this.addCommand({
        id: `new-conversation-${registered.name}`,
        name: `New conversation with ${registered.name}`,
        callback: () => this.newConversation(registered),
      });
    }
    this.addCommand({
      id: "end-conversation",
      name: "End this conversation",
      checkCallback: (checking) => {
        const file = this.activeFile();
        const controller = file && this.conversations.controller(file);
        if (!controller || controller.ended) return false;
        if (!checking) void controller.end();
        return true;
      },
    });
    this.addCommand({
      id: "stop",
      name: "Stop the agent in this conversation",
      checkCallback: (checking) => {
        const file = this.activeFile();
        const controller = file && this.conversations.controller(file);
        if (!controller?.working) return false;
        if (!checking) void controller.interrupt();
        return true;
      },
    });
    this.addCommand({
      id: "focus-composer",
      name: "Focus the message box",
      checkCallback: (checking) => {
        const composer = this.conversations.activeComposer();
        if (!composer) return false;
        if (!checking) composer.focus();
        return true;
      },
    });
    this.addCommand({
      id: "revert",
      name: "Undo the agent's last changes in this note",
      checkCallback: (checking) => {
        const file = this.activeFile();
        const note = file && this.hub.get(file.path);
        if (!note?.agentUndo.canUndo()) return false;
        if (!checking) note.agentUndo.undo();
        return true;
      },
    });

    this.addCommand({
      id: "hello-new-session",
      name: "Hello: new session",
      callback: () => this.notify(this.newHelloSession()),
    });
    this.addCommand({
      id: "wiki-ingest-file",
      name: "Wiki: ingest this file",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.path.startsWith(`${wikiModule.id}/`) || file.path.startsWith("internal/")) return false;
        if (!checking) this.notify(this.newIngestSession([file.path]));
        return true;
      },
    });
    this.addCommand({
      id: "wiki-ingest-folder",
      name: "Wiki: ingest a folder",
      callback: () =>
        this.notify(
          pickOne(
            this.app,
            this.app.vault
              .getAllFolders()
              .filter((f) => !f.isRoot() && !f.path.startsWith("internal") && !f.path.startsWith(wikiModule.id) && !f.path.startsWith(CONVERSATION_FOLDER)),
            (f) => f.path,
            "The folder whose files the wiki learns from",
          ).then((folder) => (folder ? this.newIngestSession([folder.path], true) : "")),
        ),
    });
    this.addWikiCommands();
    for (const module of MODULES) {
      for (const [name, agent] of [["Claude", () => this.claude], ["Codex", () => this.codex]] as const) {
        this.addCommand({
          id: `${module.id}-run-${name.toLowerCase()}`,
          name: `${module.name}: run this session with ${name}`,
          checkCallback: (checking) => {
            const file = this.app.workspace.getActiveFile();
            const folder = `${layout(module).sessions}/`;
            if (!file || !file.path.startsWith(folder) || file.extension !== "md" || file.path.slice(folder.length).includes("/")) return false;
            if (!checking) this.notify(this.runModuleSession(module, agent(), file.path));
            return true;
          },
        });
      }
    }

    this.addCommand({
      id: "say-hello",
      name: "Say hello",
      callback: () => new Notice(this.yami.sayHello()),
    });
  }

  onunload() {
    void this.conversations.destroy().then(() => uninstallCollab(this.hub));
    void this.claude.closeAll();
    void this.codex.closeAll();
    delete window.yami;
  }

  /** Writes the folders and documents of each module that are missing. */
  private async enableModules(): Promise<void> {
    for (const module of MODULES) {
      try {
        await enableModule(this.vault, module);
      } catch (error) {
        console.error(error);
        new Notice(`Yami could not enable ${module.name}: ${(error as Error).message}`, 10_000);
      }
    }
  }

  private async newHelloSession(): Promise<string> {
    const path = await createSession(this.vault, hello, `Session ${timestamp().slice(0, 16).replace("T", " ").replace(":", "-")}`);
    await this.open(path);
    return `Created ${path}.`;
  }

  private addWikiCommands(): void {
    const activeNote = () => {
      const file = this.app.workspace.getActiveFile();
      return file?.extension === "md" ? file : undefined;
    };
    this.addCommand({
      id: "wiki-search",
      name: "Wiki: search",
      callback: () => new WikiSearchModal(this.app, this.wiki).open(),
    });
    this.addCommand({
      id: "wiki-related",
      name: "Wiki: notes related to this note",
      checkCallback: (checking) => {
        const file = activeNote();
        if (!file) return false;
        if (!checking) new WikiSearchModal(this.app, this.wiki, { seeds: [file.path], algorithm: "ppr" }).open();
        return true;
      },
    });
    this.addCommand({
      id: "wiki-compare",
      name: "Wiki: compare the algorithms",
      callback: () => new WikiCompareModal(this.app, this.wiki, this.activeSelection()).open(),
    });
    this.addCommand({
      id: "wiki-match",
      name: "Wiki: match the selection",
      checkCallback: (checking) => {
        const selection = this.activeSelection();
        if (!selection) return false;
        if (!checking) this.notify(this.wiki.match([selection]).then((matches) => this.showRows(matchRows(this.wiki, matches), `Where "${selection}" stands in the wiki`)));
        return true;
      },
    });
    this.addCommand({
      id: "wiki-lint-note",
      name: "Wiki: lint this note",
      checkCallback: (checking) => {
        const file = activeNote();
        if (!file) return false;
        if (!checking) this.notify(this.wiki.lint({ paths: [file.path] }).then((findings) => this.showRows(findingRows(this.wiki, findings), `Findings in ${file.basename}`)));
        return true;
      },
    });
    this.addCommand({
      id: "wiki-lint-vault",
      name: "Wiki: lint the vault",
      callback: () => this.notify(this.wiki.lint().then((findings) => this.showRows(findingRows(this.wiki, findings), `${findings.length} findings; type to filter`))),
    });
    this.addCommand({
      id: "wiki-snapshot",
      name: "Wiki: take a snapshot",
      callback: () =>
        this.notify(
          this.wiki.captured().then(async (state) => {
            if (state.captured) return `The wiki is already version ${state.latest!.version}; nothing changed since.`;
            const version = await this.wiki.snapshot();
            return `Wiki: version ${version.version}, ${version.notes} notes.`;
          }),
        ),
    });
    this.addCommand({
      id: "wiki-versions",
      name: "Wiki: versions",
      callback: () =>
        this.notify(
          this.wiki.versions().then((versions) =>
            this.showRows(
              [...versions].reverse().map((v) => ({
                path: v.path,
                title: `Version ${v.version}`,
                badge: `${v.notes} notes`,
                tone: "neighbor",
                detail: `${v.created.replace("T", " ")}${v.change ? ` · ${v.change}` : ""}${v.restored !== undefined ? ` · restored version ${v.restored}` : ""}`,
              })),
              "The versions of the wiki, newest first",
            ),
          ),
        ),
    });
    this.addCommand({
      id: "wiki-restore",
      name: "Wiki: restore a version",
      callback: () =>
        this.notify(
          this.wiki.versions().then(async (versions) => {
            const picked = await pickOne(this.app, [...versions].reverse(), (v) => `Version ${v.version} · ${v.created.replace("T", " ")} · ${v.notes} notes`, "The version to restore");
            if (!picked) return "";
            const version = await this.wiki.restore(picked.version);
            return `Wiki: restored version ${picked.version} as version ${version.version}.`;
          }),
        ),
    });
    this.addCommand({
      id: "wiki-refresh",
      name: "Wiki: rebuild the index",
      callback: () => this.notify(this.rebuildWiki()),
    });
  }

  /** Opens the rows in a note list, or says that there are none. */
  private showRows(rows: NoteRow[], placeholder: string): string {
    if (!rows.length) return "The wiki found nothing to show.";
    new NoteListModal(this.app, rows, placeholder).open();
    return "";
  }

  private async rebuildWiki(): Promise<string> {
    const started = performance.now();
    await this.wiki.refresh();
    const communities = new Set(this.wiki.notes.map((note) => note.community).filter((c) => c !== undefined)).size;
    const ms = Math.round(performance.now() - started);
    return `Wiki: ${this.wiki.notes.length} notes, ${this.wiki.graph.size} links, ${communities} communities, in ${ms} ms.`;
  }

  /** The selected text of the active editor, on one line. */
  private activeSelection(): string {
    return this.app.workspace.getActiveViewOfType(MarkdownView)?.editor.getSelection().replace(/\s+/g, " ").trim() ?? "";
  }

  /** Writes the source notes of the files, or of every file in a folder, and an ingest session that links them. */
  private async newIngestSession(paths: string[], folder = false): Promise<string> {
    const sources = folder ? await captureSources(this.vault, paths[0]!, SOURCES) : await Promise.all(paths.map((file) => captureSource(this.vault, file, SOURCES)));
    const first = sources[0]!;
    const name = sources.length === 1 ? first.slice(first.lastIndexOf("/") + 1, -3).replace(/ \(source( \d+)?\)$/, "") : `${paths[0]!.split("/").pop()} (${sources.length} files)`;
    const path = await createSession(this.vault, wikiModule, `Ingest ${name} ${timestamp().slice(0, 10)}`, { sources: sources.map(link) });
    await this.open(path);
    return `Created ${path} with ${sources.length} source(s).`;
  }

  private async runModuleSession(module: Module, agent: Agent, path: string): Promise<string> {
    new Notice(`Running ${path} with ${agent.harness}…`);
    const result = await runSession(this.vault, agent, module, path, {
      conversations: new ObsidianConversations(this.conversations, () => this.agents),
      wiki: this.wiki,
    });
    return `${path}: ${result.state} after ${result.iterations} iteration(s).`;
  }

  private async open(path: string): Promise<void> {
    const file = this.app.vault.getFileByPath(path);
    if (file) await this.app.workspace.getLeaf().openFile(file);
  }

  private newConversation(agent: ConversationAgent): void {
    this.notify(this.conversations.create(agent).then((file) => `Opened ${file.path}.`));
  }

  /** Shows the result of a command, unless it is empty, or its error, in a notice. */
  private notify(work: Promise<string>): void {
    work.then(
      (message) => message && new Notice(message),
      (error: Error) => {
        console.error(error);
        new Notice(`Yami: ${error.message}`, 10_000);
      },
    );
  }

  private activeFile(): TFile | undefined {
    return this.app.workspace.getActiveViewOfType(MarkdownView)?.file ?? undefined;
  }

  private updateStatus(): void {
    const working = this.conversations.working;
    const text = working.length === 1 ? `${working[0]!.agentName} working in ${working[0]!.file.basename}` : working.length ? `${working.length} agents working` : "";
    this.statusEl.setText(text);
    this.statusEl.toggleClass("is-working", working.length > 0);
  }
}
