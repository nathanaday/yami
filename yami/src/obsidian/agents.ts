import { type App, FileSystemAdapter } from "obsidian";
import type { Agent, AgentEvent } from "../agent/index.js";
import { AgentPeer, type AgentIdentity } from "./collab/agent-peer.js";
import type { SharedNote } from "./collab/shared-note.js";

/** An agent that the host offers for conversations, with its name and color in the vault. */
export interface ConversationAgent extends AgentIdentity {
  agent: Agent;
}

export function vaultRoot(app: App): string {
  const adapter = app.vault.adapter;
  if (!(adapter instanceof FileSystemAdapter)) throw new Error("Yami needs a vault on the local file system.");
  return adapter.getBasePath();
}

/** The agent's cursors, one for each shared note that it works in. */
export class Presence {
  private readonly peers = new Map<SharedNote, AgentPeer>();
  private status: string | undefined;

  /** A function for `identity` is read for each new cursor, so a cursor shows the agent's name and color as they are then. */
  constructor(
    private readonly identity: AgentIdentity | (() => AgentIdentity),
    private readonly animate: () => boolean,
  ) {}

  peer(note: SharedNote): AgentPeer {
    let peer = this.peers.get(note);
    if (!peer) {
      const { name, color } = typeof this.identity === "function" ? this.identity() : this.identity;
      peer = new AgentPeer(note, { name, color }, this.animate);
      peer.setStatus(this.status);
      this.peers.set(note, peer);
    }
    return peer;
  }

  /** Shows what the agent does now, next to each of its cursors. */
  setStatus(status: string | undefined): void {
    this.status = status;
    for (const peer of this.peers.values()) peer.setStatus(status);
  }

  /** Starts a new undo step in every note. */
  beginTurn(): void {
    for (const peer of this.peers.values()) peer.beginTurn();
  }

  /** Removes the cursors. */
  clear(): void {
    for (const peer of this.peers.values()) peer.dispose();
    this.peers.clear();
  }
}

/** A short status for the agent's cursor, from an event. Undefined keeps the current status. */
export function activity(event: AgentEvent): string | undefined {
  switch (event.type) {
    case "turn-start":
    case "thinking-delta":
    case "tool-end":
      return "Thinking";
    case "text-delta":
      return "Writing";
    case "tool-start":
      return toolActivity(event.tool, event.title, event.paths);
    default:
      return undefined;
  }
}

function toolActivity(tool: string, title: string, paths: string[] | undefined): string {
  const file = paths?.[0]?.split("/").pop();
  if (tool.endsWith("read_note")) return "Reading the note";
  if (tool.endsWith("edit_note")) return "Editing the note";
  if (tool.endsWith("write_note")) return "Rewriting the note";
  switch (tool) {
    case "Read":
      return file ? `Reading ${file}` : "Reading";
    case "Edit":
    case "Write":
    case "NotebookEdit":
    case "fileChange":
      return file ? `Editing ${file}` : "Editing";
    case "Grep":
    case "Glob":
      return "Searching";
    case "WebSearch":
    case "webSearch":
      return "Searching the web";
    case "WebFetch":
      return "Reading a web page";
    case "Bash":
    case "commandExecution":
      return `Running ${title.replace(/^Bash /, "").slice(0, 40)}`;
    default:
      return title.slice(0, 48);
  }
}
