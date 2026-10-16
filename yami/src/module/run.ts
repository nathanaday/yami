import type { Agent } from "../agent/agent.js";
import type { Conversation } from "../conversation/conversations.js";
import {
  basename,
  documentName,
  link,
  linksOf,
  parseDocument,
  readDocument,
  replaceSection,
  resolveLink,
  sectionText,
  updateDocument,
  type Document,
} from "../document/document.js";
import { timestamp, type SessionState } from "../document/schema.js";
import type { Vault } from "../document/vault.js";
import type { Wiki } from "../wiki/wiki.js";
import { runCheck, type CheckResult } from "./checks.js";
import { skillCommand, skillPath, type Layout, type LinkedKind, type SessionTemplate, type YamiModule } from "./module.js";
import type { Yami } from "./yami.js";

export interface RunResult {
  path: string;
  /** The state the run left in the session document. */
  state: SessionState;
  /** The agent turns of this run. */
  iterations: number;
  /** The conversation note that records the run. None when the run ended before it opened one. */
  conversation?: string;
}

/** How a session handle and its run talk: the run reports its phase, and the handle asks it to stop. */
export interface RunControl {
  /** Set by stop and kill. The run ends at its next step and records `stopped`. */
  stopping: boolean;
  /** The conversation of the run, while it is open. */
  conversation?: Conversation;
  phase(phase: "working" | "checking"): void;
}

type Linked = Record<LinkedKind, Document[]>;

interface Verification {
  results: { promise: Document; result: CheckResult }[];
  met: string[];
  unmet: string[];
  review: string[];
}

/** The module and the template of a session document. */
export function sessionParts(yami: Yami, doc: Document): { module: YamiModule; template: SessionTemplate | undefined } {
  if (doc.properties.type !== "session") throw new Error(`${doc.path} is not a session document.`);
  const module = yami.module(String(doc.properties.module ?? ""));
  if (!module) throw new Error(`${doc.path} is a session of the module "${String(doc.properties.module)}", which this Yami does not have.`);
  if (module.sessionsIn === "none") throw new Error(`The ${module.id} module has no sessions.`);
  const template = module.templateOf(doc.properties.template);
  if (doc.properties.template && !template) throw new Error(`${doc.path} names the template "${String(doc.properties.template)}", which the ${module.id} module does not have.`);
  return { module, template };
}

/**
 * Runs the agent loop on a session document until every promise is met, the iterations run out, the
 * harness fails, or the person stops it. Each iteration is one agent turn and one verification, and the
 * document shows the state after each one. The exchange goes to a conversation note, linked from the
 * document. A resumed run checks the promises first, and continues the session's conversation.
 */
export async function runSession(
  yami: Yami,
  path: string,
  agent: Agent,
  control: RunControl,
  options: { resume: boolean; maxIterations?: number },
): Promise<RunResult> {
  const vault = yami.vault;
  let doc = await readDocument(vault, path);
  const { module, template } = sessionParts(yami, doc);
  const linked = await loadLinked(vault, module.layout, doc);
  const turns = options.maxIterations ?? template?.maxIterations ?? 3;
  if (!Number.isInteger(turns) || turns < 1) throw new Error(`A run takes one iteration or more, not ${turns}.`);
  const start = Math.max(0, Math.trunc(Number(doc.properties.iteration)) || 0);
  const last = start + turns;
  const recorded = options.resume ? linksOf(doc.properties.conversation)[0] : undefined;
  const earlier = recorded ? await resolveLink(vault, recorded, []) : undefined;

  let feedback: string | undefined;
  if (earlier) {
    control.phase("checking");
    const verification = await verify(vault, yami.wiki, module, doc, linked.promises);
    if (!verification.unmet.length) {
      const state = verification.review.length ? "needs-attention" : "done";
      await record(vault, path, { iteration: start, line: `resumed: ${summary(verification)}`, verification, state });
      return { path, state, iterations: 0, conversation: earlier };
    }
    feedback = feedbackPrompt(verification);
  }

  const conversation = await yami.openConversation({
    agent,
    name: `${module.id} ${basename(path)}`,
    folder: yami.conversationFolder,
    module: path,
    approval: "accept-edits",
    access: template?.access,
    resume: earlier,
  });
  control.conversation = conversation;
  // A conversation that kept its harness session needs only the feedback; any other gets the whole context first.
  let prompt = conversation.continued && feedback ? feedback : [contextPrompt(vault, agent, module, template, doc, linked, path), feedback].filter(Boolean).join("\n\n");
  await updateDocument(vault, path, (d) => {
    d.properties.state = "running";
    d.properties.harness = agent.harness;
    d.properties.conversation = link(conversation.path);
  });

  let state: SessionState = "needs-attention";
  let iteration = start;
  try {
    while (iteration < last) {
      if (control.stopping) {
        state = "stopped";
        await record(vault, path, { iteration, line: "stopped", state });
        break;
      }
      iteration += 1;
      control.phase("working");
      const result = await conversation.send(prompt);
      if (result.status === "failed" && !control.stopping) {
        state = "failed";
        await record(vault, path, { iteration, line: `iteration ${iteration}: turn failed: ${result.error ?? "no details"}`, state });
        break;
      }
      control.phase("checking");
      // The agent's tools change the session's properties, for example its changes, so the checks read it again.
      doc = await readDocument(vault, path);
      const verification = await verify(vault, yami.wiki, module, doc, linked.promises);
      const line = `iteration ${iteration}: ${summary(verification)}`;
      if (verification.unmet.length === 0) {
        state = verification.review.length === 0 ? "done" : "needs-attention";
        await record(vault, path, { iteration, line, verification, state });
        break;
      }
      if (control.stopping || result.status === "interrupted") {
        state = "stopped";
        await record(vault, path, { iteration, line: `${line}; stopped`, verification, state });
        break;
      }
      await record(vault, path, { iteration, line, verification, state: iteration < last ? "running" : "needs-attention" });
      prompt = feedbackPrompt(verification);
    }
  } catch (error) {
    // A run never leaves its document running: a kill can close the conversation in the middle of a step.
    state = control.stopping ? "stopped" : "failed";
    await record(vault, path, { iteration, line: state === "stopped" ? "stopped" : `failed: ${error instanceof Error ? error.message : String(error)}`, state });
  } finally {
    control.conversation = undefined;
    await conversation.close();
  }
  return { path, state, iterations: iteration - start, conversation: conversation.path };
}

async function loadLinked(vault: Vault, lay: Layout, doc: Document): Promise<Linked> {
  const linked = { articles: [], policies: [], promises: [], skills: [] } as Linked;
  for (const kind of Object.keys(linked) as LinkedKind[]) {
    for (const target of linksOf(doc.properties[kind])) {
      const path =
        kind === "skills" && (await vault.exists(skillPath(lay, target)))
          ? skillPath(lay, target)
          : await resolveLink(vault, target, [lay.folders[kind], lay.internal]);
      if (!path) throw new Error(`The session links to ${kind} "${target}", which is not in the vault.`);
      linked[kind].push(parseDocument(vault, path, await vault.read(path)));
    }
  }
  return linked;
}

/** Runs every check. The wiki reads the vault again first, so the checks see what the agent wrote. */
async function verify(vault: Vault, wiki: Wiki, module: YamiModule, doc: Document, promises: Document[]): Promise<Verification> {
  const verification: Verification = { results: [], met: [], unmet: [], review: [] };
  if (promises.length) await wiki.refresh();
  for (const promise of promises) {
    const result = await runCheck(promise, { vault, wiki, path: doc.path, properties: doc.properties }, module.checks);
    verification.results.push({ promise, result });
    verification[result.status].push(link(promise.path));
  }
  return verification;
}

function summary(verification: Verification): string {
  return `${verification.met.length} met, ${verification.unmet.length} unmet${verification.review.length ? `, ${verification.review.length} for review` : ""}`;
}

/** Writes an outcome to the session document: the state, the deliverables, and a line of progress. */
async function record(vault: Vault, path: string, outcome: { iteration: number; line: string; verification?: Verification; state: SessionState }) {
  await updateDocument(vault, path, (doc) => {
    doc.properties.iteration = outcome.iteration;
    doc.properties.state = outcome.state;
    const verification = outcome.verification;
    if (verification) {
      doc.properties.met = verification.met;
      doc.properties.unmet = [...verification.unmet, ...verification.review];
      const deliverables = verification.results
        .map(({ promise, result }) => `- [${result.status === "met" ? "x" : " "}] ${link(promise.path)} — ${result.detail}`)
        .join("\n");
      doc.body = replaceSection(doc.body, "Deliverables", deliverables);
    }
    const progress = sectionText(doc.body, "Progress");
    const line = `- ${timestamp().slice(11, 16)} ${outcome.line}`;
    doc.body = replaceSection(doc.body, "Progress", progress ? `${progress}\n${line}` : line);
  });
}

/**
 * The first prompt. A linked skill that the agent has as a skill set goes by its command: the prompt
 * starts with the first one, so the harness loads it, and names the others to load. A skill the agent
 * does not have is inlined.
 */
function contextPrompt(vault: Vault, agent: Agent, module: YamiModule, template: SessionTemplate | undefined, doc: Document, linked: Linked, path: string): string {
  const fields = Object.keys(module.schema ?? {})
    .map((field) => `- ${field}: ${String(doc.properties[field] ?? "")}`)
    .join("\n");
  const section = (title: string, docs: Document[], render: (d: Document) => string) =>
    docs.length ? `## ${title}\n\n${docs.map((d) => `### ${documentName(d.path)}\n\n${render(d)}`).join("\n\n")}` : "";
  const promise = (d: Document) =>
    Object.entries(d.properties)
      .filter(([key]) => !["type", "module"].includes(key))
      .map(([key, value]) => `- ${key}: ${String(value)}`)
      .join("\n") + `\n\n${d.body.trim()}`;
  const sets = new Set((agent.preferences.skills ?? []).map((root) => root.replace(/\/$/, "")));
  const attached: { command: string; doc: Document }[] = [];
  const inlined: Document[] = [];
  for (const skill of linked.skills) {
    const named = skillCommand(skill.path);
    if (named && sets.has(`${vault.root.replace(/\/$/, "")}/${named.root}`)) attached.push({ command: named.command, doc: skill });
    else inlined.push(skill);
  }
  const listed = attached.length
    ? `## Skills\n\nThis session's skills, which you have as skills of your own. The first is loaded for you; load the others when you need them.\n\n${attached
        .map(({ command, doc }) => `- \`${command}\`: ${String(doc.properties.description ?? "")} Its folder: ${doc.path.slice(0, doc.path.lastIndexOf("/"))}/`)
        .join("\n")}`
    : "";
  const kind = template ? `a "${template.name}" session of the module "${module.name}"` : `a session of the module "${module.name}"`;
  const body = [
    `You are running the Yami session "${basename(path)}", ${kind}.\n` +
      `The working directory is the vault. Paths are relative to it. The session document is ${path}; Yami maintains its properties and its Deliverables and Progress sections, so do not edit that file.\n` +
      `Follow every policy. The session ends when every promise is met. After each of your turns, Yami checks the promises and tells you what is still unmet.`,
    module.instructions,
    template?.instructions,
    fields && `## Session properties\n\n${fields}`,
    `## Session\n\n${doc.body.trim()}`,
    section("Policies", linked.policies, (d) => d.body.trim()),
    section("Promises", linked.promises, promise),
    listed,
    section(attached.length ? "Other skills" : "Skills", inlined, (d) => d.body.trim()),
    section("Articles", linked.articles, (d) => d.body.trim()),
  ]
    .filter(Boolean)
    .join("\n\n");
  return attached.length ? `/${attached[0]!.command} ${body}` : body;
}

function feedbackPrompt(verification: Verification): string {
  const lines = verification.results
    .filter(({ result }) => result.status !== "met")
    .map(({ promise, result }) => `- ${documentName(promise.path)}: ${result.status}, ${result.detail}`);
  return `Yami checked the promises after your last turn.\n\n${lines.join("\n")}\n\nMeet the unmet promises. Follow the policies.`;
}
