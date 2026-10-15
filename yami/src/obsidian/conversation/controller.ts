import { type App, Notice, type TFile } from "obsidian";
import type {
  AgentEvent,
  AgentSession,
  ApprovalSetting,
  CommandOption,
  Harness,
  ModelOption,
  PermissionDecision,
  PermissionRequest,
  QuestionAnswers,
  QuestionRequest,
  SessionSettings,
  TurnStatus,
} from "../../agent/index.js";
import { availablePath, frontmatterEdit, isUnnamed, nameFrom, renderTurn, TurnTranscript, userBlock } from "../../conversation/index.js";
import { activity, type ConversationAgent, Presence } from "../agents.js";
import type { TurnEnd } from "../api.js";
import type { CollabHub, DiskWriter } from "../collab/hub.js";
import { LiveRegion } from "../collab/region.js";
import { LOCAL_ORIGIN, type SharedNote } from "../collab/shared-note.js";
import type { PermissionPrompts } from "../prompts/permission-modal.js";

const INSTRUCTIONS = `You are running inside Obsidian, the note-taking app, through Yami. Your working directory is the root of the user's vault.

This conversation happens in a note, the conversation note. Yami writes the user's messages and your replies into it as the conversation goes, so the note is the record of the conversation. Messages give its path.

What you can change:
- You can create, edit and delete any file in the vault with your own tools, such as your file-editing tools and the shell, when the user asks. This includes every note except the conversation note. The user's approval settings decide when you must ask first.
- The user sees your edits live in notes that are open, and may type in them at the same time.
- Do not edit the conversation note. Yami writes your replies into it, and an edit there would collide with your reply. To show the user something, put it in your reply.

How to answer:
- Write Markdown that reads well in Obsidian. Link notes as [[Note name]].
- When the user links notes with [[...]], the message lists their paths. Read them when the request needs them.
- Wait for commands to finish before you reply. Do not run work in the background.`;

/** A request that waits for the user in the composer: an approval or the agent's questions. */
export type PendingRequest =
  | { kind: "approval"; request: PermissionRequest; decide(decision: PermissionDecision): void }
  | { kind: "question"; request: QuestionRequest; answer(answers: QuestionAnswers | undefined): void };

export interface LocalCommand {
  name: string;
  description: string;
  argumentHint?: string;
}

export const LOCAL_COMMANDS: LocalCommand[] = [
  { name: "model", description: "Choose the model", argumentHint: "<model>" },
  { name: "effort", description: "Choose how much the model reasons", argumentHint: "<level>" },
  { name: "mode", description: "Choose when the agent asks before it acts", argumentHint: "ask | edits | plan" },
  { name: "new", description: "Start a new conversation note" },
  { name: "end", description: "End this conversation and keep the note as a record" },
];

const LOCAL_NAMES = new Set(LOCAL_COMMANDS.map((command) => command.name));

const MODES: Record<string, ApprovalSetting> = { ask: "ask", edits: "accept-edits", plan: "plan", auto: "auto", sandbox: "sandbox" };

interface Turn {
  transcript: TurnTranscript;
  region: LiveRegion;
  /** The agent as a writer of files, while the turn runs. */
  writer: DiskWriter;
  stopWriting: () => void;
  /** Files that the agent's tools may be changing now. */
  writing: Map<string, number>;
}

export interface ControllerOptions {
  animate: () => boolean;
  idleMinutes: () => number;
  newConversation: (agent: ConversationAgent) => void;
  onActivity: () => void;
  onTurnEnd: (turn: TurnEnd) => void;
}

/**
 * Runs one conversation note: its agent session, the transcript in the note, queued messages, approval
 * requests and the agent's questions. Composers show its state and send through it.
 */
export class ConversationController {
  phase: "idle" | "starting" | "working" = "idle";
  models: ModelOption[] = [];
  commands: CommandOption[] = [];
  /** Requests that wait for the user, oldest first. */
  readonly pending: PendingRequest[] = [];
  readonly queue: string[] = [];
  status: string | undefined;
  private session: AgentSession | undefined;
  private starting: Promise<AgentSession> | undefined;
  private note: SharedNote | undefined;
  private turn: Turn | undefined;
  private readonly presence: Presence;
  private readonly listeners = new Set<() => void>();
  private readonly holders = new Set<object>();
  private idleTimer: number | undefined;
  /** The path of the conversation note that the agent was last told. */
  private toldPath: string | undefined;
  /** Properties written to the note that the metadata cache may not show yet. */
  private readonly written: Record<string, string | undefined> = {};

  constructor(
    private readonly app: App,
    private readonly hub: CollabHub,
    readonly file: TFile,
    private readonly agents: () => ConversationAgent[],
    private readonly prompts: PermissionPrompts,
    private readonly options: ControllerOptions,
  ) {
    this.presence = new Presence(this.registered, options.animate);
  }

  get properties(): Record<string, unknown> {
    return { ...this.app.metadataCache.getFileCache(this.file)?.frontmatter, ...this.written };
  }

  /** A text property of the note. Undefined when it is missing or not text. */
  private property(key: string): string | undefined {
    const value = this.properties[key];
    return typeof value === "string" ? value : undefined;
  }

  /** The agent of the note, by its `agent` property, or the first agent. */
  get registered(): ConversationAgent {
    const agents = this.agents();
    const name = this.property("agent");
    const found = agents.find((candidate) => candidate.name === name) ?? agents[0];
    if (!found) throw new Error("Yami has no agents.");
    return found;
  }

  get harness(): Harness {
    return this.registered.agent.harness;
  }

  get agentName(): string {
    return this.registered.name;
  }

  get ended(): boolean {
    return this.properties.status === "ended";
  }

  get model(): string | undefined {
    return this.property("model") || this.registered.agent.preferences.model || undefined;
  }

  get effort(): string | undefined {
    return this.property("effort") || this.registered.agent.preferences.effort || undefined;
  }

  get approval(): ApprovalSetting {
    return (this.property("approval") as ApprovalSetting | undefined) ?? this.registered.agent.preferences.approval ?? "ask";
  }

  get working(): boolean {
    return this.phase !== "idle";
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** A composer shows the conversation. While one does, the note stays shared and the agent warm. */
  async attach(holder: object): Promise<void> {
    this.holders.add(holder);
    window.clearTimeout(this.idleTimer);
    this.note ??= await this.hub.acquire(this.file, this);
    if (!this.ended) void this.ensureSession().catch(() => undefined);
  }

  detach(holder: object): void {
    this.holders.delete(holder);
    if (this.holders.size || this.working) return;
    this.releaseNote();
    this.scheduleIdle();
  }

  async send(text: string): Promise<void> {
    const message = text.trim();
    if (!message) return;
    const command = /^\/(\S+)/.exec(message)?.[1];
    if (command && LOCAL_NAMES.has(command)) {
      await this.runLocal(message);
      return;
    }
    if (this.working) {
      this.queue.push(message);
      this.changed();
      return;
    }
    await this.run(message);
  }

  async interrupt(): Promise<void> {
    this.queue.length = 0;
    await this.session?.interrupt();
    this.changed();
  }

  async setModel(model: string | undefined): Promise<void> {
    await this.setProperty("model", model);
    await this.configure({ model: model ?? null });
    const efforts = this.models.find((option) => option.id === model)?.efforts ?? [];
    if (this.effort && efforts.length && !efforts.includes(this.effort)) await this.setEffort(undefined);
    this.changed();
  }

  async setEffort(effort: string | undefined): Promise<void> {
    await this.setProperty("effort", effort);
    await this.configure({ effort: effort ?? null });
    this.changed();
  }

  async setApproval(approval: ApprovalSetting): Promise<void> {
    const previous = this.property("approval");
    await this.setProperty("approval", approval === (this.registered.agent.preferences.approval ?? "ask") ? undefined : approval);
    if (!(await this.configure({ approval }))) await this.setProperty("approval", previous);
    this.changed();
  }

  /**
   * Applies settings to the session, also to one that is still starting. A session that starts later reads
   * them from the note. Returns false when the agent refuses them.
   */
  private async configure(settings: SessionSettings): Promise<boolean> {
    const session = this.session ?? (await this.starting?.catch(() => undefined));
    if (!session || session.closed) return true;
    try {
      await session.configure(settings);
      return true;
    } catch (error) {
      new Notice(`${this.agentName} could not change the setting: ${(error as Error).message}`);
      return false;
    }
  }

  /** Ends the conversation. The note stays as a record. */
  async end(): Promise<void> {
    if (this.working) await this.interrupt();
    await this.setProperty("status", "ended");
    await this.closeSession();
    this.changed();
  }

  async resume(): Promise<void> {
    await this.setProperty("status", "active");
    this.changed();
    void this.ensureSession().catch(() => undefined);
  }

  /** Efforts of the current model, or of the default model. */
  get efforts(): string[] {
    const model = this.models.find((option) => option.id === this.model) ?? this.models.find((option) => option.isDefault);
    return model?.efforts ?? [];
  }

  async destroy(): Promise<void> {
    window.clearTimeout(this.idleTimer);
    for (const pending of [...this.pending]) {
      if (pending.kind === "approval") pending.decide("deny");
      else pending.answer(undefined);
    }
    await this.closeSession();
    this.releaseNote();
  }

  private async run(message: string): Promise<void> {
    this.phase = "starting";
    this.status = "Starting";
    this.changed();
    let session: AgentSession;
    try {
      session = await this.ensureSession();
    } catch (error) {
      this.phase = "idle";
      this.status = undefined;
      new Notice(`${this.agentName} could not start: ${(error as Error).message}`);
      this.changed();
      this.turnEnded("failed", (error as Error).message);
      return;
    }
    const note = (this.note ??= await this.hub.acquire(this.file, this));
    // Name a new conversation first, so the agent learns the note's final path.
    if (!/\n> \[!user\]/.test(note.content)) await this.rename(message).catch(() => undefined);
    this.appendLocal(note, `${userBlock(message)}\n\n\n`);
    this.beginTurn(note);
    this.phase = "working";
    this.status = "Thinking";
    this.changed();
    await session.send(this.prompt(message)).catch(() => undefined);
  }

  private beginTurn(note: SharedNote): void {
    const peer = this.presence.peer(note);
    peer.beginTurn();
    // The turn goes before the note's last line break, so text the user types at the very end stays out of it.
    const at = note.content.length - 1;
    const writing = new Map<string, number>();
    const writer: DiskWriter = {
      name: this.agentName,
      writes: (path) => writing.has(path),
      peer: (target) => this.presence.peer(target),
    };
    this.turn = {
      transcript: new TurnTranscript(),
      region: new LiveRegion(peer, at, at),
      writing,
      writer,
      stopWriting: this.hub.addWriter(writer),
    };
    peer.setCursor(note.relative(at, -1));
  }

  private handle(event: AgentEvent): void {
    const status = activity(event);
    if (status) {
      this.status = status;
      this.presence.setStatus(status);
    }
    if (event.type === "turn-start" && !this.turn && this.note) {
      // A turn that the agent started on its own.
      this.appendLocal(this.note, "\n");
      this.beginTurn(this.note);
      this.phase = "working";
    }
    const turn = this.turn;
    if (turn) {
      turn.transcript.apply(event);
      if (event.type === "tool-start") for (const path of event.paths ?? []) turn.writing.set(path, (turn.writing.get(path) ?? 0) + 1);
      if (event.type === "tool-end") {
        // Disk changes from a tool can arrive just after it ends.
        window.setTimeout(() => {
          for (const [path, count] of turn.writing) count <= 1 ? turn.writing.delete(path) : turn.writing.set(path, count - 1);
        }, 1500);
      }
      turn.region.set(this.turnText(turn));
      if (event.type === "turn-end") void this.finishTurn(turn, event.result.status, event.result.error, event.result.text);
    }
    if (event.type === "closed") {
      this.session = undefined;
      this.starting = undefined;
      this.toldPath = undefined;
      if (this.turn) void this.finishTurn(this.turn, "failed", event.error ?? `${this.agentName} stopped.`);
    }
    this.changed();
  }

  private turnText(turn: Turn): string {
    const text = renderTurn(turn.transcript);
    return text ? `${text}\n` : "";
  }

  private async finishTurn(turn: Turn, status: TurnStatus, error?: string, text?: string): Promise<void> {
    if (this.turn !== turn) return;
    this.turn = undefined;
    turn.region.set(this.turnText(turn));
    await turn.region.settled();
    turn.region.close();
    turn.stopWriting();
    this.presence.setStatus(undefined);
    this.status = undefined;
    this.phase = "idle";
    window.setTimeout(() => {
      if (!this.working) this.presence.clear();
    }, 1200);
    this.changed();
    this.options.onActivity();
    // The next message starts before listeners hear of the end, so they see the conversation still working.
    const next = this.queue.shift();
    const running = next ? this.run(next) : undefined;
    this.turnEnded(status, error, text);
    if (running) await running;
    else if (!this.holders.size) {
      this.releaseNote();
      this.scheduleIdle();
    }
  }

  private turnEnded(status: TurnStatus, error?: string, text?: string): void {
    this.options.onTurnEnd({ path: this.file.path, status, ...(text && { text }), ...(error && { error }) });
  }

  private releaseNote(): void {
    if (this.note) this.hub.release(this.note, this);
    this.note = undefined;
  }

  private prompt(message: string): string {
    const linked = new Set<string>();
    for (const match of message.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) {
      const file = this.app.metadataCache.getFirstLinkpathDest(match[1]!.trim(), this.file.path);
      if (file) linked.add(file.path);
    }
    const context = [
      ...(this.toldPath !== this.file.path ? [`Conversation note: ${this.file.path} (do not edit it)`] : []),
      ...(linked.size ? [`Linked notes: ${[...linked].join(", ")}`] : []),
    ];
    this.toldPath = this.file.path;
    return context.length ? `${message}\n\n${context.join("\n")}` : message;
  }

  private ensureSession(): Promise<AgentSession> {
    if (this.session && !this.session.closed) return Promise.resolve(this.session);
    this.starting ??= this.startAgent()
      .then(async (session) => {
        this.session = session;
        session.on((event) => this.handle(event));
        if (this.properties.session !== session.id) await this.setProperty("session", session.id);
        void Promise.all([session.models(), session.commands()])
          .then(([models, commands]) => {
            this.models = models;
            this.commands = commands;
            this.changed();
          })
          .catch(() => undefined);
        return session;
      })
      .finally(() => {
        this.starting = undefined;
      });
    return this.starting;
  }

  /** Starts the agent's session. When the stored conversation is gone, starts a new one. */
  private async startAgent(): Promise<AgentSession> {
    const start = (resume?: string) =>
      this.registered.agent.startSession({
        instructions: INSTRUCTIONS,
        resume,
        model: this.property("model"),
        effort: this.property("effort"),
        approval: this.approval,
        access: this.property("access") as "edit" | "read-only" | undefined,
        onPermission: (request) => this.ask(request),
        onQuestion: (request) => this.question(request),
        // Shares a note before the agent's tool changes it, so the change merges as the agent's edit.
        beforeFileChange: (paths) => this.turn && this.hub.prepare(this.turn.writer, paths),
      });
    const resume = this.property("session");
    if (!resume) return start();
    try {
      return await start(resume);
    } catch {
      // The stored conversation is gone, for example after the harness cleaned up old sessions.
      return start();
    }
  }

  /** Closes the agent session. The next message resumes it from the note. */
  async closeSession(): Promise<void> {
    const session = this.session ?? (await this.starting?.catch(() => undefined));
    this.session = undefined;
    // A resumed session hears the path again; the note can be renamed while it is closed.
    this.toldPath = undefined;
    this.presence.clear();
    await session?.close();
  }

  private scheduleIdle(): void {
    window.clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => {
      if (!this.working && !this.holders.size) void this.closeSession();
    }, this.options.idleMinutes() * 60_000);
  }

  /** Shows an approval request in the composer, or in a dialog when no composer is open. */
  private ask(request: PermissionRequest): Promise<PermissionDecision> {
    if (!this.holders.size) return this.prompts.ask(request, { agent: this.agentName, notePath: this.file.path });
    return this.wait(request.signal, "deny", (decide) => ({ kind: "approval", request, decide }));
  }

  /** Shows the agent's questions in the composer, or in a dialog when no composer is open. */
  private question(request: QuestionRequest): Promise<QuestionAnswers | undefined> {
    if (!this.holders.size) return this.prompts.question(request, { agent: this.agentName, notePath: this.file.path });
    return this.wait(request.signal, undefined as QuestionAnswers | undefined, (answer) => ({ kind: "question", request, answer }));
  }

  /** Adds a request to `pending` until the user settles it or the agent no longer needs it. */
  private wait<T>(signal: AbortSignal, fallback: T, make: (settle: (value: T) => void) => PendingRequest): Promise<T> {
    return new Promise((resolve) => {
      const settle = (value: T) => {
        const index = this.pending.indexOf(pending);
        if (index < 0) return;
        this.pending.splice(index, 1);
        resolve(value);
        this.changed();
      };
      const pending = make(settle);
      this.pending.push(pending);
      signal.addEventListener("abort", () => settle(fallback));
      if (signal.aborted) settle(fallback);
      this.changed();
    });
  }

  private async runLocal(message: string): Promise<void> {
    const [, name, argument = ""] = message.match(/^\/(\S+)\s*([\s\S]*)$/) ?? [];
    const value = argument.trim();
    switch (name) {
      case "model": {
        const model = this.models.find((option) => [option.id, option.name].some((candidate) => candidate.toLowerCase() === value.toLowerCase()));
        if (!model) new Notice(value ? `No model named ${value}.` : "Write /model and a model name, or pick one from the model menu.");
        else await this.setModel(model.isDefault ? undefined : model.id);
        return;
      }
      case "effort":
        if (!this.efforts.includes(value.toLowerCase())) new Notice(`Effort levels: ${this.efforts.join(", ") || "none for this model"}.`);
        else await this.setEffort(value.toLowerCase());
        return;
      case "mode":
        if (!MODES[value.toLowerCase()]) new Notice("Modes: ask, edits, plan, auto, sandbox.");
        else await this.setApproval(MODES[value.toLowerCase()]!);
        return;
      case "new":
        this.options.newConversation(this.registered);
        return;
      case "end":
        await this.end();
    }
  }

  private appendLocal(note: SharedNote, text: string): void {
    const content = note.content;
    const separator = content.endsWith("\n\n") || !content ? "" : content.endsWith("\n") ? "\n" : "\n\n";
    note.applyOps([{ from: content.length, to: content.length, insert: separator + text }], LOCAL_ORIGIN);
  }

  private async setProperty(key: string, value: string | undefined): Promise<void> {
    this.written[key] = value;
    const note = this.note;
    if (note) {
      const edit = frontmatterEdit(note.content, key, value);
      if (edit) note.applyOps([edit], LOCAL_ORIGIN);
      return;
    }
    await this.app.fileManager.processFrontMatter(this.file, (frontmatter: Record<string, unknown>) => {
      if (value === undefined) delete frontmatter[key];
      else frontmatter[key] = value;
    });
  }

  /** Names a new conversation after its first message. A note that has a chosen name keeps it. */
  private async rename(message: string): Promise<void> {
    if (!isUnnamed(this.file.basename)) return;
    const path = availablePath(this.file.parent?.path ?? "", nameFrom(message), (candidate) => Boolean(this.app.vault.getAbstractFileByPath(candidate)));
    await this.app.fileManager.renameFile(this.file, path);
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }
}
