import { Plugin } from "obsidian";
import { ClaudeAgent } from "yami/agent/claude";
import { CodexAgent } from "yami/agent/codex";
import { createYami, NAVIGATOR_VIEW, PANEL_VIEW, revealView, WikiNavigator, YamiPanel, type ObsidianYami } from "yami/obsidian";

/**
 * The wiki plugin: the library's wiki module, with the panel and the navigator over it. Threads is left to
 * the threads plugin, and the conversation commands to Duet when it is on; this plugin still runs its own
 * agents for the wiki's sessions. `app.plugins.getPlugin("yami-wiki").yami` is the Yami, for the console.
 */
export default class YamiWikiPlugin extends Plugin {
  yami!: ObsidianYami;

  onload() {
    this.yami = createYami(this, { agents: [new ClaudeAgent(), new CodexAgent()], threads: false });

    this.registerView(PANEL_VIEW, (leaf) => new YamiPanel(leaf, this.yami, { name: "Wiki", icon: "book-open" }));
    this.addRibbonIcon("book-open", "Open the wiki panel", () => void revealView(this.app, PANEL_VIEW));
    this.addCommand({ id: "open-panel", name: "Open the wiki panel", callback: () => void revealView(this.app, PANEL_VIEW) });

    this.registerView(NAVIGATOR_VIEW, (leaf) => new WikiNavigator(leaf, this.yami));
    this.addCommand({ id: "open-wiki-navigator", name: "Open the wiki navigator", callback: () => void revealView(this.app, NAVIGATOR_VIEW) });
  }
}
