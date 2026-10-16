import { Plugin } from "obsidian";
import { ClaudeAgent } from "yami/agent/claude";
import { CodexAgent } from "yami/agent/codex";
import { createYami, type ObsidianYami } from "yami/obsidian";
import { Hello } from "./modules/hello";
import { Journals } from "./modules/journals";
import { Librarian } from "./modules/librarian";
import { Threads } from "./modules/threads";

declare global {
  interface Window {
    /** The plugin's Yami, for the developer console. */
    yami?: ObsidianYami;
  }
}

export default class YamiPlugin extends Plugin {
  yami!: ObsidianYami;

  onload() {
    this.yami = createYami(this, {
      agents: [new ClaudeAgent(), new CodexAgent()],
      modules: [new Hello(), new Threads(), new Librarian(), new Journals()],
    });
    window.yami = this.yami;
    this.register(() => delete window.yami);
  }
}
