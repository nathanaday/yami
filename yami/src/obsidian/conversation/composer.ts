import type { EditorView } from "@codemirror/view";
import { type App, type MarkdownView, Menu, prepareFuzzySearch, Scope, setIcon, setTooltip, type TFile } from "obsidian";
import type { ApprovalSetting, PermissionDecision } from "../../agent/index.js";
import { renderQuestions } from "../prompts/question-form.js";
import { type ConversationController, LOCAL_COMMANDS, type PendingRequest } from "./controller.js";

const APPROVAL_NAMES: Record<ApprovalSetting, string> = { ask: "Ask first", "accept-edits": "Accept edits", plan: "Plan only", auto: "Auto", sandbox: "Sandbox" };
const CLAUDE_MODES: ApprovalSetting[] = ["ask", "accept-edits", "auto", "plan"];
const CODEX_MODES: ApprovalSetting[] = ["ask", "accept-edits", "sandbox"];
const FILE_TOOLS = new Set(["Edit", "Write", "NotebookEdit", "fileChange"]);
/** How close to the end the user must be scrolled for the note to follow new text. */
const FOLLOW_PX = 120;

interface Suggestion {
  label: string;
  detail?: string;
  insert: string;
}

/**
 * The message box at the bottom of a conversation note. It sends messages, shows what the agent does,
 * answers approval requests and the agent's questions, and changes the model, effort and approval mode. It suggests slash commands
 * after "/" and notes after "[[".
 */
export class Composer {
  private readonly root: HTMLElement;
  private readonly approvalEl: HTMLElement;
  private readonly card: HTMLElement;
  private readonly input: HTMLTextAreaElement;
  private readonly statusEl: HTMLElement;
  private readonly modelButton: HTMLButtonElement;
  private readonly effortButton: HTMLButtonElement;
  private readonly modeButton: HTMLButtonElement;
  private readonly sendButton: HTMLButtonElement;
  private readonly endedEl: HTMLElement;
  private readonly suggestEl: HTMLElement;
  private suggestions: Suggestion[] = [];
  private selected = 0;
  private history: string[] = [];
  private historyIndex = -1;
  private follow = true;
  private readonly cleanup: (() => void)[] = [];
  /** The request that `approvalEl` shows. It is drawn again only when it changes, so a half-filled answer stays. */
  private shown: PendingRequest | undefined;

  constructor(
    private readonly app: App,
    readonly view: MarkdownView,
    readonly controller: ConversationController,
  ) {
    const container = view.containerEl;
    container.addClass("yami-has-composer");
    this.root = view.contentEl.createDiv({ cls: "yami-composer" });
    this.suggestEl = this.root.createDiv({ cls: "yami-suggest" });
    this.approvalEl = this.root.createDiv({ cls: "yami-approval" });
    this.endedEl = this.root.createDiv({ cls: "yami-ended" });
    this.card = this.root.createDiv({ cls: "yami-composer-card" });
    this.input = this.card.createEl("textarea", { cls: "yami-input", attr: { rows: "1", spellcheck: "true" } });
    const bar = this.card.createDiv({ cls: "yami-composer-bar" });
    this.modelButton = this.chip(bar, "cpu", "Model", (event) => this.modelMenu(event));
    this.effortButton = this.chip(bar, "gauge", "Effort", (event) => this.effortMenu(event));
    this.modeButton = this.chip(bar, "shield-check", "When the agent asks first", (event) => this.modeMenu(event));
    const link = bar.createEl("button", { cls: "yami-icon-button clickable-icon", attr: { "aria-label": "Link a note" } });
    setIcon(link, "link");
    link.addEventListener("click", () => this.insertAtCursor("[["));
    this.statusEl = bar.createDiv({ cls: "yami-composer-status" });
    this.sendButton = bar.createEl("button", { cls: "yami-send" });
    this.sendButton.addEventListener("click", () => (this.controller.working && !this.input.value.trim() ? void this.controller.interrupt() : this.submit()));

    this.input.addEventListener("input", () => {
      this.autosize();
      this.updateSuggestions();
      this.render();
    });
    this.input.addEventListener("keydown", (event) => this.onKey(event));
    // Obsidian handles some keys, such as Escape, for the whole window before the text box sees them.
    const scope = new Scope(this.app.scope);
    scope.register([], "Escape", (event) => {
      this.onKey(event);
      return false;
    });
    this.input.addEventListener("focus", () => this.app.keymap.pushScope(scope));
    this.input.addEventListener("blur", () => {
      this.app.keymap.popScope(scope);
      window.setTimeout(() => this.hideSuggestions(), 120);
    });
    this.cleanup.push(() => this.app.keymap.popScope(scope));

    const resize = new ResizeObserver(() => container.style.setProperty("--yami-composer-height", `${this.root.offsetHeight}px`));
    resize.observe(this.root);
    this.cleanup.push(() => resize.disconnect());
    this.cleanup.push(controller.subscribe(() => this.render()));
    this.watchScroll();
    void controller.attach(this);
    this.render();
  }

  focus(): void {
    this.input.focus();
  }

  destroy(): void {
    for (const dispose of this.cleanup.splice(0)) dispose();
    this.controller.detach(this);
    this.root.remove();
    this.view.containerEl.removeClass("yami-has-composer");
    this.view.containerEl.style.removeProperty("--yami-composer-height");
  }

  private chip(parent: HTMLElement, icon: string, tooltip: string, onClick: (event: MouseEvent) => void): HTMLButtonElement {
    const button = parent.createEl("button", { cls: "yami-chip" });
    setIcon(button.createSpan({ cls: "yami-chip-icon" }), icon);
    button.createSpan({ cls: "yami-chip-label" });
    setTooltip(button, tooltip, { placement: "top" });
    button.addEventListener("click", (event) => {
      // The menu closes on a click outside it, and this click would count as one.
      event.stopPropagation();
      onClick(event);
    });
    return button;
  }

  private render(): void {
    const { controller } = this;
    const ended = controller.ended;
    this.root.toggleClass("is-ended", ended);
    this.root.toggleClass("is-working", controller.working);
    this.root.style.setProperty("--yami-agent", controller.registered.color);
    this.input.placeholder = `Message ${controller.agentName}   /  for commands   [[  to link notes`;

    this.endedEl.empty();
    if (ended) {
      this.endedEl.createSpan({ text: "This conversation has ended. The note keeps it as a record." });
      const resume = this.endedEl.createEl("button", { text: "Continue it" });
      resume.addEventListener("click", () => void controller.resume().then(() => this.focus()));
    }

    const model = controller.models.find((option) => (controller.model ? option.id === controller.model : option.isDefault));
    this.label(this.modelButton, model?.name ?? controller.model ?? "Default model");
    const efforts = controller.efforts;
    this.effortButton.toggleClass("is-hidden", !efforts.length && !controller.effort);
    this.label(this.effortButton, capitalize(controller.effort ?? "Default effort"));
    this.label(this.modeButton, APPROVAL_NAMES[controller.approval]);

    const queued = controller.queue.length;
    this.statusEl.setText(controller.working ? `${controller.status ?? "Working"}${queued ? ` · ${queued} queued` : ""}` : "");
    const stop = controller.working && !this.input.value.trim();
    this.sendButton.empty();
    setIcon(this.sendButton, stop ? "square" : "arrow-up");
    this.sendButton.toggleClass("is-stop", stop);
    this.sendButton.disabled = !stop && !this.input.value.trim();
    setTooltip(this.sendButton, stop ? "Stop (Esc)" : "Send (Enter)", { placement: "top" });
    this.renderPending(controller.pending[0]);
  }

  private label(button: HTMLButtonElement, text: string): void {
    button.querySelector(".yami-chip-label")!.textContent = text;
  }

  private renderPending(pending: PendingRequest | undefined): void {
    if (pending === this.shown) return;
    this.shown = pending;
    this.approvalEl.empty();
    this.root.toggleClass("has-approval", Boolean(pending));
    if (pending?.kind === "approval") this.renderApproval(pending);
    else if (pending?.kind === "question") this.renderQuestion(pending);
  }

  private renderQuestion(pending: Extract<PendingRequest, { kind: "question" }>): void {
    const head = this.approvalEl.createDiv({ cls: "yami-approval-head" });
    setIcon(head.createSpan({ cls: "yami-approval-icon" }), "message-circle-question");
    head.createSpan({ cls: "yami-approval-title", text: `${this.controller.agentName} asks you` });
    const typing = document.activeElement === this.input;
    const form = renderQuestions(this.approvalEl, pending.request.questions, "yami-approval-choices", (answers) => {
      pending.answer(answers);
      if (typing) this.focus();
    });
    if (typing) form.focus();
  }

  private renderApproval(approval: Extract<PendingRequest, { kind: "approval" }>): void {
    const { request } = approval;
    const head = this.approvalEl.createDiv({ cls: "yami-approval-head" });
    setIcon(head.createSpan({ cls: "yami-approval-icon" }), FILE_TOOLS.has(request.tool) ? "file-pen" : "terminal");
    head.createSpan({ cls: "yami-approval-title", text: `${this.controller.agentName} wants to ${actionOf(request.tool)}` });
    this.approvalEl.createDiv({ cls: "yami-approval-subject", text: request.title });
    if (request.detail && !request.title.includes(request.detail)) {
      const pre = this.approvalEl.createEl("pre", { cls: "yami-approval-detail" });
      const diff = FILE_TOOLS.has(request.tool);
      for (const line of request.detail.split("\n")) {
        const kind = !diff ? "" : line.startsWith("+") ? "is-add" : line.startsWith("-") ? "is-remove" : line.startsWith("@@") ? "is-hunk" : "";
        pre.createSpan({ cls: `yami-line ${kind}`, text: line || " " });
      }
    }
    const choices = this.approvalEl.createDiv({ cls: "yami-approval-choices" });
    const choice = (label: string, key: string, decision: PermissionDecision, primary = false) => {
      const button = choices.createEl("button", { cls: primary ? "mod-cta" : "" });
      button.createSpan({ text: label });
      button.createEl("kbd", { text: key });
      button.addEventListener("click", () => approval.decide(decision));
    };
    choice("Allow once", "Y", "allow", true);
    choice("Allow for this conversation", "A", "allow-session");
    choice("Deny", "N", "deny");
  }

  private onKey(event: KeyboardEvent): void {
    const approval = this.controller.pending[0];
    if (approval?.kind === "approval" && !this.input.value && !event.metaKey && !event.ctrlKey) {
      const decision = { y: "allow", a: "allow-session", n: "deny" }[event.key.toLowerCase()] as PermissionDecision | undefined;
      if (decision) {
        event.preventDefault();
        approval.decide(decision);
        return;
      }
    }
    if (this.suggestions.length) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        this.selected = (this.selected + (event.key === "ArrowDown" ? 1 : -1) + this.suggestions.length) % this.suggestions.length;
        this.renderSuggestions();
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        this.accept(this.suggestions[this.selected]!);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        this.hideSuggestions();
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      this.submit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (this.controller.working) void this.controller.interrupt();
    } else if (event.key === "ArrowUp" && !this.input.value && this.history.length) {
      event.preventDefault();
      this.historyIndex = Math.min(this.historyIndex + 1, this.history.length - 1);
      this.setInput(this.history[this.history.length - 1 - this.historyIndex]!);
    }
  }

  private submit(): void {
    const text = this.input.value.trim();
    if (!text) return;
    if (/^\/(model|effort|mode)$/.test(text)) {
      this.setInput("");
      const target = text === "/model" ? this.modelButton : text === "/effort" ? this.effortButton : this.modeButton;
      target.click();
      return;
    }
    this.history.push(text);
    this.historyIndex = -1;
    this.setInput("");
    this.follow = true;
    this.scrollToEnd();
    void this.controller.send(text);
  }

  private setInput(text: string): void {
    this.input.value = text;
    this.input.setSelectionRange(text.length, text.length);
    this.autosize();
    this.updateSuggestions();
    this.render();
  }

  private insertAtCursor(text: string): void {
    const { selectionStart, selectionEnd, value } = this.input;
    this.input.value = value.slice(0, selectionStart) + text + value.slice(selectionEnd);
    this.input.setSelectionRange(selectionStart + text.length, selectionStart + text.length);
    this.input.focus();
    this.autosize();
    this.updateSuggestions();
  }

  private autosize(): void {
    this.input.setCssProps({ "--yami-input-height": "auto" });
    this.input.setCssProps({ "--yami-input-height": `${this.input.scrollHeight}px` });
  }

  private updateSuggestions(): void {
    const before = this.input.value.slice(0, this.input.selectionStart);
    const command = before.match(/^\/([\w:-]*)$/);
    const link = before.match(/\[\[([^\]\n]*)$/);
    let suggestions: Suggestion[] = [];
    if (command) {
      const query = command[1]!.toLowerCase();
      const all = [
        ...LOCAL_COMMANDS.map((item) => ({ ...item, local: true })),
        ...this.controller.commands.filter((item) => !LOCAL_COMMANDS.some((local) => local.name === item.name)),
      ];
      suggestions = all
        .filter((item) => item.name.toLowerCase().includes(query))
        .sort((a, b) => Number(!a.name.toLowerCase().startsWith(query)) - Number(!b.name.toLowerCase().startsWith(query)))
        .slice(0, 8)
        .map((item) => ({ label: `/${item.name}`, detail: firstSentence(item.description), insert: `/${item.name} ` }));
    } else if (link) {
      const query = link[1]!;
      const search = prepareFuzzySearch(query);
      const files = this.app.vault.getMarkdownFiles().filter((file) => file !== this.controller.file);
      const ranked = query
        ? files
            .map((file) => ({ file, score: search(file.path)?.score }))
            .filter((item): item is { file: TFile; score: number } => item.score !== undefined)
            .sort((a, b) => b.score - a.score)
            .map((item) => item.file)
        : files.sort((a, b) => b.stat.mtime - a.stat.mtime);
      suggestions = ranked.slice(0, 8).map((file) => ({
        label: file.basename,
        detail: file.parent?.path && file.parent.path !== "/" ? file.parent.path : undefined,
        insert: `[[${this.app.metadataCache.fileToLinktext(file, this.controller.file.path)}]]`,
      }));
    }
    const changed = suggestions.map((item) => item.label).join() !== this.suggestions.map((item) => item.label).join();
    this.suggestions = suggestions;
    if (changed) this.selected = 0;
    this.renderSuggestions();
  }

  private renderSuggestions(): void {
    this.suggestEl.empty();
    this.suggestEl.toggleClass("is-shown", this.suggestions.length > 0);
    this.suggestions.forEach((item, index) => {
      const row = this.suggestEl.createDiv({ cls: `yami-suggest-item${index === this.selected ? " is-selected" : ""}` });
      row.createSpan({ cls: "yami-suggest-label", text: item.label });
      if (item.detail) row.createSpan({ cls: "yami-suggest-detail", text: item.detail });
      row.addEventListener("mousedown", (event) => {
        event.preventDefault();
        this.accept(item);
      });
    });
    this.suggestEl.querySelector(".is-selected")?.scrollIntoView({ block: "nearest" });
  }

  private accept(item: Suggestion): void {
    const { selectionStart, value } = this.input;
    const before = value.slice(0, selectionStart);
    const start = item.insert.startsWith("/") ? 0 : before.lastIndexOf("[[");
    const rest = value.slice(selectionStart).replace(/^\]\]/, "");
    this.input.value = before.slice(0, start) + item.insert + rest;
    const caret = start + item.insert.length;
    this.input.setSelectionRange(caret, caret);
    this.hideSuggestions();
    this.autosize();
    this.render();
    this.input.focus();
  }

  private hideSuggestions(): void {
    this.suggestions = [];
    this.renderSuggestions();
  }

  private modelMenu(event: MouseEvent): void {
    const { controller } = this;
    const menu = new Menu();
    if (!controller.models.length) menu.addItem((item) => item.setTitle("Models load when the agent starts").setDisabled(true));
    for (const model of controller.models) {
      const current = model.isDefault ? !controller.model || controller.model === model.id : controller.model === model.id;
      menu.addItem((item) =>
        item
          .setTitle(model.name)
          .setChecked(current)
          .onClick(() => void controller.setModel(model.isDefault ? undefined : model.id)),
      );
    }
    this.showMenu(menu, event);
  }

  private effortMenu(event: MouseEvent): void {
    const { controller } = this;
    const menu = new Menu();
    menu.addItem((item) => item.setTitle("Default").setChecked(!controller.effort).onClick(() => void controller.setEffort(undefined)));
    for (const effort of controller.efforts) {
      menu.addItem((item) =>
        item
          .setTitle(capitalize(effort))
          .setChecked(controller.effort === effort)
          .onClick(() => void controller.setEffort(effort)),
      );
    }
    this.showMenu(menu, event);
  }

  private modeMenu(event: MouseEvent): void {
    const { controller } = this;
    const menu = new Menu();
    for (const mode of controller.harness === "claude" ? CLAUDE_MODES : CODEX_MODES) {
      menu.addItem((item) =>
        item
          .setTitle(APPROVAL_NAMES[mode])
          .setChecked(controller.approval === mode)
          .onClick(() => void controller.setApproval(mode)),
      );
    }
    this.showMenu(menu, event);
  }

  private showMenu(menu: Menu, event: MouseEvent): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.top - 6 });
  }

  /** Keeps the newest text in view while the agent writes, unless the user scrolled up to read. */
  private watchScroll(): void {
    const scroller = this.scroller();
    if (!scroller) return;
    const onScroll = () => {
      this.follow = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < FOLLOW_PX;
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    let frame: number | undefined;
    const observer = new MutationObserver(() => {
      if (!this.follow || !this.controller.working || frame !== undefined) return;
      frame = window.requestAnimationFrame(() => {
        frame = undefined;
        this.scrollToEnd("auto");
      });
    });
    observer.observe(scroller, { childList: true, subtree: true, characterData: true });
    this.cleanup.push(() => {
      scroller.removeEventListener("scroll", onScroll);
      observer.disconnect();
    });
  }

  /** Scrolls so the end of the note sits just above the message box. */
  private scrollToEnd(behavior: ScrollBehavior = "smooth"): void {
    const scroller = this.scroller();
    if (!scroller) return;
    const content = this.view.getMode() === "preview" ? scroller.querySelector(".markdown-preview-sizer") : scroller.querySelector(".cm-content");
    if (!content) return;
    const lastLine = content.lastElementChild?.getBoundingClientRect();
    const box = this.root.querySelector(".yami-composer-card")!.getBoundingClientRect();
    if (!lastLine) return;
    const delta = lastLine.bottom - (box.top - 24);
    if (delta > 1 || delta < -scroller.clientHeight / 2) scroller.scrollBy({ top: delta, behavior });
  }

  private scroller(): HTMLElement | undefined {
    const cm = (this.view.editor as unknown as { cm?: EditorView }).cm;
    return this.view.getMode() === "preview" ? (this.view.contentEl.querySelector<HTMLElement>(".markdown-preview-view") ?? undefined) : cm?.scrollDOM;
  }
}

function actionOf(tool: string): string {
  if (tool === "Bash" || tool === "command") return "run a command";
  if (FILE_TOOLS.has(tool)) return "change a file";
  if (tool === "permissions") return "get more access";
  if (tool === "ExitPlanMode") return "start working on its plan";
  return `use ${tool}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function firstSentence(text: string): string {
  const sentence = /^.*?\.(?=\s)/s.exec(text)?.[0] ?? text;
  return sentence.length > 90 ? `${sentence.slice(0, 89)}…` : sentence;
}
