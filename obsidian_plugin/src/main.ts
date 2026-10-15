import { MarkdownView, Notice, Plugin, type TFile } from "obsidian";
import { createYami } from "yami";
import type { Agent } from "yami/agent";
import { ClaudeAgent } from "yami/agent/claude";
import { CodexAgent } from "yami/agent/codex";
import { timestamp } from "yami/document";
import { createSession, enableModule, moduleTools, runSession } from "yami/module";
import { hello } from "yami/modules/hello";
import {
  type CollabHub,
  type ConversationAgent,
  ConversationManager,
  installCollab,
  ObsidianConversations,
  ObsidianVault,
  PermissionPrompts,
  uninstallCollab,
  vaultRoot,
} from "yami-obsidian";

const MODULES = [hello];
const CONVERSATION_FOLDER = "conversations";
const IDLE_MINUTES = 15;
const COLORS = { claude: "#d97757", codex: "#4f8cf7" };

declare global {
  interface Window {
    yami?: {
      claude: ClaudeAgent;
      codex: CodexAgent;
      conversations: ConversationManager;
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
  hub!: CollabHub;
  conversations!: ConversationManager;
  private statusEl!: HTMLElement;

  async onload() {
    const cwd = vaultRoot(this.app);
    this.vault = new ObsidianVault(this.app, cwd);
    const tools = moduleTools(this.vault, MODULES);
    this.claude = new ClaudeAgent({ preferences: { cwd, tools } });
    this.codex = new CodexAgent({ preferences: { cwd, tools } });
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
    window.yami = { claude: this.claude, codex: this.codex, conversations: this.conversations, ClaudeAgent, CodexAgent };

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
    for (const [name, agent] of [["Claude", () => this.claude], ["Codex", () => this.codex]] as const) {
      this.addCommand({
        id: `hello-run-${name.toLowerCase()}`,
        name: `Hello: run this session with ${name}`,
        checkCallback: (checking) => {
          const file = this.app.workspace.getActiveFile();
          if (!file || !file.path.startsWith(`${hello.id}/`)) return false;
          if (!checking) this.notify(this.runHelloSession(agent(), file.path));
          return true;
        },
      });
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
    const file = this.app.vault.getFileByPath(path);
    if (file) await this.app.workspace.getLeaf().openFile(file);
    return `Created ${path}.`;
  }

  private async runHelloSession(agent: Agent, path: string): Promise<string> {
    new Notice(`Running ${path} with ${agent.harness}…`);
    const result = await runSession(this.vault, agent, hello, path, { conversations: new ObsidianConversations(this.conversations, () => this.agents) });
    return `${path}: ${result.state} after ${result.iterations} iteration(s).`;
  }

  private newConversation(agent: ConversationAgent): void {
    this.notify(this.conversations.create(agent).then((file) => `Opened ${file.path}.`));
  }

  /** Shows the result of a command, or its error, in a notice. */
  private notify(work: Promise<string>): void {
    work.then(
      (message) => new Notice(message),
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
