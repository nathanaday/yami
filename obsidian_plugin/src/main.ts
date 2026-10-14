import { FileSystemAdapter, Notice, Plugin } from "obsidian";
import { createYami } from "yami";
import { type Agent, claude, createAgent } from "yami/agent";

declare global {
  interface Window {
    yami?: { agent: Agent; createAgent: typeof createAgent; claude: typeof claude };
  }
}

export default class YamiPlugin extends Plugin {
  private yami = createYami();
  agent!: Agent;

  async onload() {

    console.log("Loaded!");

    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error("Yami needs a vault on the local file system.");
    }
    this.agent = createAgent(claude(), { cwd: adapter.getBasePath() });
    window.yami = { agent: this.agent, createAgent, claude };

    this.addRibbonIcon("hand", "HeelllooOOoOoOOOOoooo", () => this.sayHello());

    this.addCommand({
      id: "say-hello",
      name: "Say hello",
      callback: () => this.sayHello(),
    });
  }

  onunload() {
    this.agent.closeAll();
    delete window.yami;
  }

  private sayHello() {
    new Notice(this.yami.sayHello());
  }
}
