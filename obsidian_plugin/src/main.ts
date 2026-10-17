import { Plugin, type WorkspaceLeaf } from "obsidian";
import { ClaudeAgent } from "yami/agent/claude";
import { CodexAgent } from "yami/agent/codex";
import { createYami, type ObsidianYami } from "yami/obsidian";
import { Hello } from "./modules/hello";
import { Journals } from "./modules/journals";
import { Librarian } from "./modules/librarian";
import { Threads } from "./modules/threads";
import { PANEL_VIEW, YamiPanel } from "./panel/view";

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

    // The panel is this plugin's own view over the library: modules, their sessions, and one session.
    this.registerView(PANEL_VIEW, (leaf) => new YamiPanel(leaf, this.yami));
    this.addRibbonIcon("blocks", "Open the Yami panel", () => void this.openPanel());
    this.addCommand({ id: "open-panel", name: "Open the Yami panel", callback: () => void this.openPanel() });
  }

  /** Shows the panel in the right sidebar, where it is or in a new tab of the sidebar. */
  async openPanel(): Promise<void> {
    const workspace = this.app.workspace;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(PANEL_VIEW)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf?.setViewState({ type: PANEL_VIEW, active: true });
    }
    if (leaf) await workspace.revealLeaf(leaf);
  }
}
