import { ItemView, MarkdownRenderer, type WorkspaceLeaf } from "obsidian";
import type { Access, Agent, Session, SessionEvent } from "yami/agent";

export const TEST_VIEW = "yami-test";

/** A temporary chat panel for testing the agents in Obsidian. */
export class TestView extends ItemView {
  private session: Session | undefined;
  private log!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, private readonly agents: Record<string, Agent>) {
    super(leaf);
  }

  getViewType() {
    return TEST_VIEW;
  }

  getDisplayText() {
    return "Yami test";
  }

  getIcon() {
    return "bot";
  }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.setAttr("style", "display: flex; flex-direction: column; gap: 8px");

    const bar = root.createDiv({ attr: { style: "display: flex; gap: 4px" } });
    const harness = bar.createEl("select");
    for (const name of Object.keys(this.agents)) harness.createEl("option", { text: name });
    const access = bar.createEl("select");
    for (const name of ["read-only", "edit"]) access.createEl("option", { text: name });
    const reset = () => {
      this.session?.close();
      this.session = undefined;
    };
    harness.onchange = access.onchange = reset;
    bar.createEl("button", { text: "New session" }).onclick = reset;

    this.log = root.createDiv({ attr: { style: "flex: 1; min-height: 0; overflow-y: auto; user-select: text" } });
    const input = root.createEl("textarea", { attr: { rows: "4", placeholder: "Prompt. Cmd/Ctrl+Enter sends." } });
    const actions = root.createDiv({ attr: { style: "display: flex; gap: 4px" } });
    const send = actions.createEl("button", { text: "Send", cls: "mod-cta" });
    actions.createEl("button", { text: "Stop" }).onclick = () => void this.session?.interrupt();

    const submit = async () => {
      const prompt = input.value.trim();
      if (!prompt || send.disabled) return;
      input.value = "";
      send.disabled = true;
      this.line(`> ${prompt}`);
      try {
        this.session ??= this.start(this.agents[harness.value], access.value as Access);
        await this.session.send(prompt);
      } catch (error) {
        this.line(String(error), "error");
      } finally {
        send.disabled = false;
      }
    };
    send.onclick = submit;
    input.onkeydown = (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void submit();
      }
    };
  }

  async onClose() {
    this.session?.close();
  }

  private start(agent: Agent, access: Access): Session {
    const session = agent.startSession({ access });
    session.subscribe((event) => {
      if (event.type === "closed" && this.session === session) this.session = undefined;
      this.render(event);
    });
    return session;
  }

  private render(event: SessionEvent) {
    switch (event.type) {
      case "ready":
        return this.line(`session ${event.sessionId}${event.model ? ` · ${event.model}` : ""}`, "muted");
      case "text":
        void MarkdownRenderer.render(this.app, event.text, this.log.createDiv(), "", this);
        return this.scroll();
      case "tool-call":
        return this.line(`→ ${event.name} ${JSON.stringify(event.input)}`, "muted");
      case "tool-result":
        return this.line(`← ${event.output.slice(0, 300)}`, event.isError ? "error" : "muted");
      case "turn-end": {
        const { status, durationMs, usage, costUsd, errors } = event.result;
        const cost = costUsd === undefined ? "" : ` · $${costUsd.toFixed(4)}`;
        this.line(`${status} · ${(durationMs / 1000).toFixed(1)}s · ${usage.inputTokens} in / ${usage.outputTokens} out${cost}`, "muted");
        for (const error of errors) this.line(error, "error");
        return;
      }
      case "closed":
        return this.line(`session closed${event.error ? `: ${event.error.message}` : ""}`, event.error ? "error" : "muted");
    }
  }

  private line(text: string, tone?: "muted" | "error") {
    const color = tone === "error" ? "var(--text-error)" : tone === "muted" ? "var(--text-muted)" : "inherit";
    this.log.createDiv({ text, attr: { style: `white-space: pre-wrap; margin: 4px 0; color: ${color}` } });
    this.scroll();
  }

  private scroll() {
    this.log.scrollTop = this.log.scrollHeight;
  }
}
