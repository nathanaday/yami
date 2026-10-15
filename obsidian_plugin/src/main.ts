import { FileSystemAdapter, Notice, Plugin } from "obsidian";
import { createYami } from "yami";
import type { Agent } from "yami/agent";
import { ClaudeAgent } from "yami/agent/claude";
import { CodexAgent } from "yami/agent/codex";
import { timestamp } from "yami/document";
import { createSession, enableModule, runSession } from "yami/module";
import { hello } from "yami/modules/hello";
import { TEST_VIEW, TestView } from "./test-view";
import { ObsidianVault } from "./vault";

declare global {
  interface Window {
    yami?: {
      claude: ClaudeAgent;
      codex: CodexAgent;
      ClaudeAgent: typeof ClaudeAgent;
      CodexAgent: typeof CodexAgent;
    };
  }
}

export default class YamiPlugin extends Plugin {
  private yami = createYami();
  private claude!: ClaudeAgent;
  private codex!: CodexAgent;
  private vault!: ObsidianVault;

  async onload() {

    console.log("Loaded!");

    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error("Yami needs a vault on the local file system.");
    }
    const cwd = adapter.getBasePath();
    this.vault = new ObsidianVault(this.app, cwd);
    this.claude = new ClaudeAgent({ preferences: { cwd } });
    this.codex = new CodexAgent({ preferences: { cwd } });
    window.yami = { claude: this.claude, codex: this.codex, ClaudeAgent, CodexAgent };

    this.registerView(TEST_VIEW, (leaf) => new TestView(leaf, { claude: this.claude, codex: this.codex }));
    this.addCommand({
      id: "open-test-view",
      name: "Open test view",
      callback: () => this.openTestView(),
    });

    this.addCommand({
      id: "hello-enable",
      name: "Hello: enable module",
      callback: () => this.notify(enableModule(this.vault, hello).then(() => "Hello module enabled.")),
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

    this.addRibbonIcon("hand", "HeelllooOOoOoOOOOoooo", () => this.sayHello());

    this.addCommand({
      id: "say-hello",
      name: "Say hello",
      callback: () => this.sayHello(),
    });
  }

  onunload() {
    this.claude.closeAll();
    this.codex.closeAll();
    delete window.yami;
  }

  private async newHelloSession(): Promise<string> {
    const path = await createSession(this.vault, hello, `Session ${timestamp().slice(0, 16).replace("T", " ").replace(":", "-")}`);
    const file = this.app.vault.getFileByPath(path);
    if (file) await this.app.workspace.getLeaf().openFile(file);
    return `Created ${path}.`;
  }

  private async runHelloSession(agent: Agent, path: string): Promise<string> {
    new Notice(`Running ${path} with ${agent.harness}…`);
    const result = await runSession(this.vault, agent, hello, path);
    return `${path}: ${result.state} after ${result.iterations} iteration(s).`;
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

  private async openTestView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(TEST_VIEW)[0];
    if (!leaf) {
      const right = workspace.getRightLeaf(false);
      if (!right) return;
      leaf = right;
      await leaf.setViewState({ type: TEST_VIEW, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  private sayHello() {
    new Notice(this.yami.sayHello());
  }
}
