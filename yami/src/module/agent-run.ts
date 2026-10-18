import type { Agent } from "../agent/agent.js";
import type { ApprovalSetting, ToolSet } from "../agent/types.js";
import { parseDocument, PropertiesError } from "../document/document.js";
import { AGENT, FORMS, validate, withDefaults } from "../document/schema.js";
import { freshRun } from "./fresh-run.js";
import { nameOf, parseName } from "./links.js";
import { formPath, INTERNAL } from "./module.js";
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
    `A caller gave you the task below. You work in a fresh context: you know only this message and what you read. The working directory is the vault, and paths are relative to it.${access === "read-only" ? " You are read-only: change no file." : ""} When you are done, end your turn. Your last message is your answer: the caller gets it, and nothing else.`,
    `## Brief\n\n${doc.body.trim()}`,
    `## Task\n\n${task.trim()}`,
  ].join("\n\n");
  const own = { ...tools, tools: tools.tools.filter((tool) => tool.name !== AGENT_TOOL && (access === "edit" || tool.readOnly)) };
  const { note, result } = await freshRun(yami, {
    agent,
    name: `${named!.module} ${named!.name}`,
    session: caller.session,
    approval: caller.approval ?? agent.preferences.approval,
    access,
    tools: own,
    prompt,
    signal,
  });
  if (result.status === "interrupted") throw new AgentError(`The agent ${full} was stopped. Its conversation note: ${note}.`);
  if (result.status === "failed") throw new AgentError(`The agent ${full} failed: ${result.error ?? "no details"}. Its conversation note: ${note}.`);
  return { agent: full, conversation: note, message: result.text };
}
