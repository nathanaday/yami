import type { Agent } from "../agent/agent.js";
import type { AgentSession, ApprovalSetting, PermissionHandler, ToolSet, TurnStatus } from "../agent/types.js";
import { link, readDocument, updateDocument, writeDocument } from "../document/document.js";
import { timestamp } from "../document/schema.js";
import type { Vault } from "../document/vault.js";
import { availablePath, newConversation, noteName, renderTurn, stamp, userBlock } from "./format.js";
import { TurnTranscript } from "./transcript.js";

export const CONVERSATION_FOLDER = "conversations";

export interface ConversationTurn {
  status: TurnStatus;
  /** The agent's final message for the turn. */
  text: string;
  error?: string;
}

/** A conversation note with a running agent session behind it. */
export interface Conversation {
  readonly path: string;
  /** Whether the agent continued the harness session that a resumed note records. False for a new note, and for a note whose session the harness no longer has. */
  readonly continued: boolean;
  /** Sends a message and resolves when the agent's turn ends. */
  send(message: string): Promise<ConversationTurn>;
  /** Stops the current turn, also one that `send` is about to start. Its `send` resolves as interrupted. */
  interrupt(): Promise<void>;
  /** Closes the agent session, also in the middle of a turn. The note stays, and a person can continue it later. */
  close(): Promise<void>;
}

export interface OpenConversation {
  agent: Agent;
  /** The name of the note. A number follows it when a note has that name. */
  name: string;
  /** Default: `conversations`. */
  folder?: string;
  /** The module session document that the conversation runs, as a vault path. */
  module?: string;
  approval?: ApprovalSetting;
  /** `read-only`: the agent changes nothing except through its tools. */
  access?: "edit" | "read-only";
  /**
   * The tools of the conversation's agent sessions, in place of the agent's own. Default: the agent's. A
   * `Conversations` must honor it: Yami's review gives its reviewer only the tools that change nothing.
   */
  tools?: ToolSet;
  /**
   * A conversation note to continue instead of a new one. The agent resumes the harness session that the
   * note records, so it keeps the conversation; when that session is gone, it starts a new one in the note.
   */
  resume?: string;
}

/** Opens conversation notes. The host decides how they show and who answers approvals. */
export interface Conversations {
  open(options: OpenConversation): Promise<Conversation>;
}

/**
 * Conversations written straight to the vault: each turn appends the user's
 * message and the agent's turn to the note when the turn ends. No editor
 * shows the typing. Approvals go to `onPermission`, or are denied.
 */
export class FileConversations implements Conversations {
  /** The paths of notes that open now: two conversations that open at the same time get two notes. */
  readonly #opening = new Set<string>();

  constructor(
    private readonly vault: Vault,
    private readonly onPermission?: PermissionHandler,
  ) {}

  async open(options: OpenConversation): Promise<Conversation> {
    const start = (resume?: string) =>
      options.agent.startSession({ resume, approval: options.approval, access: options.access, onPermission: this.onPermission, ...(options.tools && { tools: options.tools }) });
    let path: string;
    let session: AgentSession;
    let continued = false;
    if (options.resume && (await this.vault.exists(options.resume))) {
      path = options.resume;
      const recorded = (await readDocument(this.vault, path)).properties.session;
      try {
        if (typeof recorded !== "string") throw new Error("The note records no session.");
        session = await start(recorded);
        continued = true;
      } catch {
        // The recorded session can be gone, for example after the harness cleaned up old sessions.
        session = await start();
      }
      await updateDocument(this.vault, path, (doc) => {
        doc.properties.session = session.id;
        doc.properties.status = "active";
      });
    } else {
      const folder = options.folder ?? CONVERSATION_FOLDER;
      const existing = new Set(await this.vault.list(folder));
      path = availablePath(folder, noteName(options.name), (candidate) => existing.has(candidate) || this.#opening.has(candidate));
      this.#opening.add(path);
      try {
        session = await start();
        await this.vault.write(
          path,
          newConversation({
            agent: options.agent.harness,
            model: options.agent.preferences.model,
            effort: options.agent.preferences.effort,
            session: session.id,
            approval: options.approval,
            access: options.access,
            status: "active",
            created: stamp(new Date(), "YYYY-MM-DD HH:mm"),
            module: options.module ? link(options.module) : undefined,
          }),
        );
      } finally {
        this.#opening.delete(path);
      }
    }
    const vault = this.vault;
    let stopping = false;
    return {
      path,
      continued,
      async send(message) {
        const transcript = new TurnTranscript();
        const off = session.on((event) => transcript.apply(event));
        const doc = await readDocument(vault, path);
        doc.body = `${doc.body.replace(/\n*$/, "")}${doc.body.trim() ? "\n\n" : ""}${userBlock(message)}\n\n`;
        await writeDocument(vault, doc);
        try {
          const sent = session.send(message);
          // An interrupt that came while the note was written stops the turn that starts now.
          if (stopping) void session.interrupt();
          const result = await sent;
          const turn = renderTurn(transcript);
          await updateDocument(vault, path, (d) => {
            d.body = `${d.body.replace(/\n*$/, "")}\n\n${turn}\n\n`;
            d.properties.updated = timestamp();
          });
          return { status: result.status, text: result.text, error: result.error };
        } finally {
          off();
        }
      },
      interrupt: () => {
        stopping = true;
        return session.interrupt();
      },
      close: () => session.close(),
    };
  }
}
