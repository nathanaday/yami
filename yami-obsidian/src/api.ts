/** The types that a host offers other plugins. This file imports nothing, so another plugin can copy it. */

export interface NewConversationOptions {
  /** The first message. A message that starts with `/` runs an agent command, such as a Claude Code skill. */
  message: string;
  /** The name of a registered agent. Default: the first agent. */
  agent?: string;
  /** The name of the note. Default: the date and the first words of the message. */
  title?: string;
  /** The folder of the note. Default: the conversation folder. */
  folder?: string;
  /** Opens the note in a new tab. Default: true. */
  open?: boolean;
  /** The module session document that this conversation runs, as a vault path. */
  module?: string;
}

/**
 * - `working`: the agent works on a turn, or starts to.
 * - `active`: the conversation waits for a message.
 * - `ended`: the user ended the conversation. The note is a record.
 * - `none`: no conversation note has this path.
 */
export type ConversationStatus = "working" | "active" | "ended" | "none";

export interface TurnEnd {
  /** The path of the note now. The user can rename the note. */
  path: string;
  status: "completed" | "interrupted" | "failed";
  /** The agent's final message for the turn. */
  text?: string;
  error?: string;
}
