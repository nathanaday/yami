import { FileSystemAdapter, Notice, Plugin } from "obsidian";
import { createYami } from "yami";
import { ClaudeAgent } from "yami/agent/claude";
import { CodexAgent } from "yami/agent/codex";
import { TEST_VIEW, TestView } from "./test-view";

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

  async onload() {

    console.log("Loaded!");

    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error("Yami needs a vault on the local file system.");
    }
    const cwd = adapter.getBasePath();
    this.claude = new ClaudeAgent({ preferences: { cwd } });
    this.codex = new CodexAgent({ preferences: { cwd } });
    window.yami = { claude: this.claude, codex: this.codex, ClaudeAgent, CodexAgent };

    this.registerView(TEST_VIEW, (leaf) => new TestView(leaf, { claude: this.claude, codex: this.codex }));
    this.addCommand({
      id: "open-test-view",
      name: "Open test view",
      callback: () => this.openTestView(),
    });

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
