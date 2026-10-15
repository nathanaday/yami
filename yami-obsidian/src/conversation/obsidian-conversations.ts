import type { Conversation, Conversations, OpenConversation } from "yami/conversation";
import type { ConversationAgent } from "../agents.js";
import type { ConversationManager } from "./manager.js";

/**
 * Conversations as notes with the message box: a module run shows up as a
 * conversation note, and a person can watch it, answer its approvals, and
 * continue it. The agent must be one that the host registered.
 */
export class ObsidianConversations implements Conversations {
  constructor(
    private readonly manager: ConversationManager,
    private readonly agents: () => ConversationAgent[],
  ) {}

  async open(options: OpenConversation): Promise<Conversation> {
    const registered = this.agents().find((candidate) => candidate.agent === options.agent);
    if (!registered) throw new Error("The agent is not registered for conversations.");
    const file = await this.manager.create(registered, { name: options.name, folder: options.folder, open: false, module: options.module, approval: options.approval });
    const controller = this.manager.conversation(file);
    const manager = this.manager;
    return {
      path: file.path,
      send: (message) =>
        new Promise((resolve) => {
          const stop = manager.onTurnEnd(file.path, (turn) => {
            stop();
            resolve({ status: turn.status, text: turn.text ?? "", error: turn.error });
          });
          void controller.send(message);
        }),
      close: () => controller.closeSession(),
    };
  }
}
