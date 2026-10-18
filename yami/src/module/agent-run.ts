import type { Agent } from "../agent/agent.js";
import { errorText, type ApprovalSetting, type ToolSet } from "../agent/types.js";
import { basename, link, parseDocument, PropertiesError, updateDocument } from "../document/document.js";
import { AGENT, FORMS, validate, withDefaults } from "../document/schema.js";
import { freshRun } from "./fresh-run.js";
import { nameOf, parseName } from "./links.js";
import { formPath, INTERNAL } from "./module.js";
import { addProgress } from "./progress.js";
import type { Yami } from "./yami.js";

/** The name of the tool that runs an agent. */
export const AGENT_TOOL = "yami_agent";

/** Who calls an agent: a session's worker, or a conversation. The agents it runs take their harness, preferences, and limits from it. */
export interface AgentCaller {
  /** The caller's agent. The agents that it calls run on it. Default: the Yami's first agent. */
  agent?: Agent;
  /** The module whose agents a bare name names: the session's module. A conversation has none. */
  module?: string;
  /** The session document that calls, which the agents' conversation notes link. */
  session?: string;
  /** The caller's access. A `read-only` caller runs only `read-only` agents. Default: the agent's preference. */
  access?: "edit" | "read-only";
  /** The caller's approval, which its agents take. Default: the agent's preference. */
  approval?: ApprovalSetting;
}

/** What a run of an agent gives its caller. */
export interface AgentReply {
  /** The agent, as `<module>:<name>`. */
  agent: string;
  /** The conversation note that records the run. */
  conversation: string;
  /** The agent's final message. */
  message: string;
}

/**
 * What a run of an agent for a session is now: `working` while it is live in this Yami, then `done`,
 * `failed`, or `stopped`. A run that recorded its start and no end, and is not live, reads as `stopped`:
 * it ended without recording its end, for example when the app quit.
 */
export type AgentRunStatus = "working" | "done" | "failed" | "stopped";

/** One run of an agent that a session called, as `session.details()` lists it. */
export interface AgentRun {
  /** The agent, as `<module>:<name>`. */
  agent: string;
  /** The conversation note that records the run. */
  conversation: string;
  status: AgentRunStatus;
}

/** The conversation notes of the runs that are live in each Yami. */
const live = new WeakMap<Yami, Set<string>>();

/** Whether the run of an agent that a conversation note records is live in this Yami. */
export function isLiveRun(yami: Yami, note: string): boolean {
  return live.get(yami)?.has(note) ?? false;
}

/** A Progress line of a session that records a run of an agent: `agent <module>:<name> <state>: <note link>`, and ` — <reason>` for a failure. */
export const AGENT_RUN_LINE = /^agent (\S+) (started|done|failed|stopped): (\[\[[^\]]+\]\])/;

/** An error of the agent tool, for the caller to read and act on. */
export class AgentError extends Error {
  override name = "AgentError";
}

/** The agents that a caller can name, as it names them: bare names of its module first, then `<module>:<name>`. */
export async function callableAgents(yami: Yami, module: string | undefined): Promise<string[]> {
  const file = FORMS.agent.file;
  const paths = (await yami.vault.list(INTERNAL)).filter((path) => {
    const parts = path.split("/");
    return parts.length === 5 && parts[2] === FORMS.agent.folder && parts[4] === file && yami.module(parts[1]!) !== undefined;
  });
  const names = paths.map((path) => nameOf(path, module));
  return [...names.filter((n) => !n.includes(":")).sort(), ...names.filter((n) => n.includes(":")).sort()];
}

/**
 * Runs an agent in a fresh context on the caller's agent: a new conversation with the agent's brief and
 * the task, the skill sets, the vault as the working directory, and the tools that its access allows. A
 * `read-only` agent gets only the tools that change nothing; no agent gets the agent tool, so agents do
 * not nest. An abort of `signal`, as when the caller's turn stops, stops the agent. Throws an `AgentError`
 * that says what to do for a name that finds no agent, an agent document that is not valid, or an `edit`
 * agent of a `read-only` caller.
 */
export async function runAgent(yami: Yami, caller: AgentCaller, name: string, task: string, tools: ToolSet, signal?: AbortSignal): Promise<AgentReply> {
  const named = parseName(name, caller.module);
  const path = named && yami.module(named.module) ? formPath(yami.module(named.module)!.layout, "agent", named.name) : undefined;
  if (!path || !(await yami.vault.exists(path))) {
    const agents = await callableAgents(yami, caller.module);
    const bare = !name.includes(":") && !caller.module ? ` A conversation has no module, so name an agent as <module>:<name>.` : "";
    throw new AgentError(`No agent is named "${name}".${bare} ${agents.length ? `The agents: ${agents.join(", ")}.` : "No module of this vault has an agent."}`);
  }
  let doc;
  try {
    doc = parseDocument(yami.vault, path, await yami.vault.read(path));
  } catch (error) {
    if (error instanceof PropertiesError) throw new AgentError(`The agent ${name} cannot run: ${error.message}. Fix ${path}.`);
    throw error;
  }
  const properties = withDefaults(doc.properties, AGENT);
  const errors = validate(properties, AGENT);
  if (errors.length) throw new AgentError(`The agent ${name} cannot run: in ${path}, ${errors.join("; ")}.`);
  const access = properties.access as "edit" | "read-only";
  const agent = yami.agent(caller.agent);
  const callerAccess = caller.access ?? agent.preferences.access ?? "edit";
  if (callerAccess === "read-only" && access === "edit") throw new AgentError(`The agent ${name} edits files, and its caller is read-only. Call a read-only agent.`);

  const full = `${named!.module}:${named!.name}`;
  const prompt = [
    `You are the agent "${full}" of Yami: ${String(properties.description)}`,
    `A caller gave you the task below. You work in a fresh context: you know only this message and what you read. The working directory is the vault, and paths are relative to it.${access === "read-only" ? " You are read-only: change no file. You can run commands that only read or check, such as git log or the tests." : ""} When you are done, end your turn. Your last message is your answer: the caller gets it, and nothing else.`,
    `## Brief\n\n${doc.body.trim()}`,
    `## Task\n\n${task.trim()}`,
  ].join("\n\n");
  const own = { ...tools, tools: tools.tools.filter((tool) => tool.name !== AGENT_TOOL && (access === "edit" || tool.readOnly)) };
  const { session } = caller;
  // A session's progress records each run, so its document lists them while they work and after. A
  // document that cannot take the line, such as one a person removed, does not cost the caller its answer.
  const progress = async (state: string, note: string, reason?: string) => {
    if (session) await updateDocument(yami.vault, session, (doc) => addProgress(doc, `agent ${full} ${state}: ${link(note)}${reason ? ` — ${reason}` : ""}`)).catch(() => undefined);
  };
  const runs = live.get(yami) ?? new Set<string>();
  live.set(yami, runs);
  let opened: string | undefined;
  let closed: Promise<void> | undefined;
  try {
    const { note, result } = await freshRun(yami, {
      agent,
      name: session ? `${caller.module ?? named!.module} ${basename(session)} ${nameOf(path, caller.module)}` : `${named!.module} ${named!.name}`,
      session,
      approval: caller.approval ?? agent.preferences.approval,
      access,
      tools: own,
      prompt,
      signal,
      opened: async (conversation) => {
        opened = conversation.path;
        runs.add(opened);
        await progress("started", opened);
      },
      closing: (close) => void (closed = close).catch(() => undefined),
    });
    if (result.status === "interrupted") {
      await progress("stopped", note);
      throw new AgentError(`The agent ${full} was stopped. Its conversation note: ${note}.`);
    }
    if (result.status === "failed") {
      await progress("failed", note, result.error ?? "no details");
      throw new AgentError(`The agent ${full} failed: ${result.error ?? "no details"}. Its conversation note: ${note}.`);
    }
    await progress("done", note);
    return { agent: full, conversation: note, message: result.text };
  } catch (error) {
    if (opened && !(error instanceof AgentError)) await progress("failed", opened, errorText(error));
    throw error;
  } finally {
    // The run is live until its end is recorded, so a view never reads a run as stopped in between. The harness closes after.
    if (opened) runs.delete(opened);
    await closed;
  }
}
