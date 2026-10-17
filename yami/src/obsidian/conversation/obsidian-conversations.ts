import type { App } from "obsidian";
import type { Conversation, Conversations, OpenConversation } from "../../conversation/index.js";
import type { ConversationAgent } from "../agents.js";
import type { ConversationManager } from "./manager.js";

/**
 * Conversations as notes with the message box: a session's run shows up as a conversation note, and a
 * person can watch it, answer its approvals, and continue it. The agent must be one that the host
 * registered. A resumed conversation goes on with the agent that its note names.
 */
export class ObsidianConversations implements Conversations {
  constructor(
    private readonly app: App,
    private readonly manager: ConversationManager,
    private readonly agents: () => ConversationAgent[],
  ) {}

  async open(options: OpenConversation): Promise<Conversation> {
    const earlier = options.resume ? this.app.vault.getFileByPath(options.resume) : null;
    let file = earlier;
    if (!file) {
      const registered = this.agents().find((candidate) => candidate.agent === options.agent);
      if (!registered) throw new Error("The agent is not registered for conversations.");
      file = await this.manager.create(registered, { name: options.name, folder: options.folder, open: false, module: options.module, approval: options.approval, access: options.access });
    }
    const controller = this.manager.conversation(file);
    controller.tools = options.tools;
    if (controller.ended) await controller.resume();
    // A resumed note continues its agent session when the harness still has it; the run learns which.
    const continued = earlier ? await controller.connect() : false;
    return {
      path: file.path,
      continued,
      send: async (message) => {
        const turn = await controller.sendForTurn(message);
        return { status: turn.status, text: turn.text ?? "", error: turn.error };
      },
      interrupt: () => controller.interrupt(),
      close: () => controller.closeSession(),
    };
  }
}
