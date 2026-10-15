import type { Agent } from "../agent/agent.js";
import type { ApprovalSetting, PermissionHandler, TurnStatus } from "../agent/types.js";
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
  /** Sends a message and resolves when the agent's turn ends. */
  send(message: string): Promise<ConversationTurn>;
  /** Closes the agent session. The note stays, and a person can continue it later. */
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
  constructor(
    private readonly vault: Vault,
    private readonly onPermission?: PermissionHandler,
  ) {}

  async open(options: OpenConversation): Promise<Conversation> {
    const folder = options.folder ?? CONVERSATION_FOLDER;
    const existing = new Set(await this.vault.list(folder));
    const path = availablePath(folder, noteName(options.name), (candidate) => existing.has(candidate));
    const session = await options.agent.startSession({
      approval: options.approval,
      onPermission: this.onPermission,
    });
    await this.vault.write(
      path,
      newConversation({
        agent: options.agent.harness,
        model: options.agent.preferences.model,
        effort: options.agent.preferences.effort,
        session: session.id,
        approval: options.approval,
        status: "active",
        created: stamp(new Date(), "YYYY-MM-DD HH:mm"),
        module: options.module ? link(options.module) : undefined,
      }),
    );
    const vault = this.vault;
    return {
      path,
      async send(message) {
        const transcript = new TurnTranscript();
        const off = session.on((event) => transcript.apply(event));
        const doc = await readDocument(vault, path);
        doc.body = `${doc.body.replace(/\n*$/, "")}${doc.body.trim() ? "\n\n" : ""}${userBlock(message)}\n\n`;
        await writeDocument(vault, doc);
        try {
          const result = await session.send(message);
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
      close: () => session.close(),
    };
  }
}
