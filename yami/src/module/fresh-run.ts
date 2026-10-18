import type { Agent } from "../agent/agent.js";
import type { ApprovalSetting, ToolSet } from "../agent/types.js";
import type { Conversation, ConversationTurn } from "../conversation/conversations.js";
import type { Yami } from "./yami.js";

/** The reason of an abort that kills a run: its conversations close at once, and no turn is interrupted. */
export const KILL = "kill";

/**
 * Stops a run's live conversation when `signal` aborts: a kill closes it at once, any other abort
 * interrupts its turn. Returns the function that stops listening.
 */
export function stopOnAbort(signal: AbortSignal | undefined, live: () => Conversation | undefined): () => void {
  if (!signal) return () => undefined;
  const stop = () => void (signal.reason === KILL ? live()?.close() : live()?.interrupt())?.catch(() => undefined);
  signal.addEventListener("abort", stop, { once: true });
  return () => signal.removeEventListener("abort", stop);
}

/** One turn of an agent in a new conversation, with nothing of its caller's context: a review, or a run of the agent tool. */
export interface FreshRun {
  /** The agent that runs it: the caller's, with its harness and preferences. */
  agent: Agent;
  /** The name of its conversation note. */
  name: string;
  /** The session document that the run belongs to, which the note links. */
  session?: string;
  approval?: ApprovalSetting;
  access: "edit" | "read-only";
  /** Its tools, in place of the agent's. */
  tools: ToolSet;
  /** The first and only message. */
  prompt: string;
  /** Stops the turn when it aborts, as `stopOnAbort` does. A run whose signal aborted before the turn has no turn. */
  signal?: AbortSignal;
  /** Called when the conversation is open, before the turn. */
  opened?: (conversation: Conversation) => Promise<void> | void;
}

/**
 * Runs one turn in a new conversation, records it as a conversation note, and closes the conversation.
 * Resolves with the note and the turn: its final message, or why it failed or was interrupted.
 */
export async function freshRun(yami: Yami, run: FreshRun): Promise<{ note: string; result: ConversationTurn }> {
  const conversation = await yami.openConversation({
    agent: run.agent,
    name: run.name,
    folder: yami.conversationFolder,
    module: run.session,
    approval: run.approval,
    access: run.access,
    tools: run.tools,
  });
  let unlisten: () => void = () => undefined;
  try {
    await run.opened?.(conversation);
    // An abort that came while the conversation opened found no turn to stop.
    if (run.signal?.aborted) return { note: conversation.path, result: { status: "interrupted", text: "" } };
    unlisten = stopOnAbort(run.signal, () => conversation);
    return { note: conversation.path, result: await conversation.send(run.prompt) };
  } finally {
    unlisten();
    await conversation.close();
  }
}
