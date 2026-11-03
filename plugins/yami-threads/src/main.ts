import { Plugin } from "obsidian";
import { ClaudeAgent } from "yami/agent/claude";
import { CodexAgent } from "yami/agent/codex";
import { createYami, PANEL_VIEW, revealView, YamiPanel, type ObsidianYami } from "yami/obsidian";

/**
 * The threads plugin: the library's threads module, with the panel over it. The wiki module is left to the
 * wiki plugin, so this one installs no wiki files and adds no wiki commands; the vault's wiki index still
 * serves the links and the checks. `app.plugins.getPlugin("yami-threads").yami` is the Yami, for the console.
 */
export default class YamiThreadsPlugin extends Plugin {
  yami!: ObsidianYami;

  onload() {
    this.yami = createYami(this, { agents: [new ClaudeAgent(), new CodexAgent()], wikiModule: false, commands: { modules: false } });

    this.registerView(PANEL_VIEW, (leaf) => new YamiPanel(leaf, this.yami, { name: "Threads", icon: "spool" }));
    this.addRibbonIcon("spool", "Open the threads panel", () => void revealView(this.app, PANEL_VIEW));
    this.addCommand({ id: "open-panel", name: "Open the threads panel", callback: () => void revealView(this.app, PANEL_VIEW) });
  }
}
