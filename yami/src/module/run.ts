import type { Agent } from "../agent/agent.js";
import { type Conversations, FileConversations } from "../conversation/conversations.js";
import {
  basename,
  documentName,
  link,
  linksOf,
  parseDocument,
  replaceSection,
  resolveLink,
  updateDocument,
  type Document,
} from "../document/document.js";
import { timestamp, type SessionState } from "../document/schema.js";
import type { Vault } from "../document/vault.js";
import { Wiki } from "../wiki/wiki.js";
import { runCheck, type CheckResult } from "./checks.js";
import { layout, readSession, skillCommand, skillPath, type Layout, type LinkedKind, type Module } from "./module.js";

export interface RunOptions {
  /** Turns the agent gets to meet every promise. Defaults to 3. */
  maxIterations?: number;
  /** Where the conversation note comes from. Defaults to notes written straight to the vault, with approvals denied. */
  conversations?: Conversations;
  /** The vault's wiki, for the checks. Defaults to a new one over the vault. */
  wiki?: Wiki;
}

export interface RunResult {
  path: string;
  state: SessionState;
  iterations: number;
  /** The conversation note that records the run. */
  conversation: string;
}

type Linked = Record<LinkedKind, Document[]>;

interface Verification {
  results: { promise: Document; result: CheckResult }[];
  met: string[];
  unmet: string[];
  review: string[];
}

/**
 * Runs the agent loop on a session document until every promise is met, the
 * iterations run out, or the harness fails. Each iteration is one agent turn
 * and one verification, and the document shows the state after each one. The
 * exchange goes to a conversation note, linked from the document.
 */
export async function runSession(vault: Vault, agent: Agent, module: Module, path: string, options: RunOptions = {}): Promise<RunResult> {
  const lay = layout(module);
  const name = basename(path);
  let doc = await readSession(vault, module, path);
  const linked = await loadLinked(vault, lay, doc);
  const start = Number(doc.properties.iteration ?? 0);
  const last = start + (options.maxIterations ?? 3);

  const conversations = options.conversations ?? new FileConversations(vault);
  const wiki = options.wiki ?? new Wiki(vault);
  const conversation = await conversations.open({
    agent,
    name: `${module.id} ${name}`,
    module: path,
    approval: "accept-edits",
    access: module.access,
  });
  doc = await updateDocument(vault, path, (d) => {
    d.properties.state = "running";
    d.properties.harness = agent.harness;
    d.properties.conversation = link(conversation.path);
  });

  let state: SessionState = "needs-attention";
  let iteration = start;
  try {
    let prompt = contextPrompt(vault, agent, module, doc, linked, path);
    while (iteration < last) {
      iteration += 1;
      const result = await conversation.send(prompt);
      if (result.status !== "completed") {
        state = "failed";
        await record(vault, path, iteration, `turn ${result.status}: ${result.error ?? "no details"}`, undefined, state);
        break;
      }
      // The agent's tools change the session's properties, for example its changes, so the checks read it again.
      doc = await readSession(vault, module, path);
      const verification = await verify(vault, wiki, name, doc, linked.promises);
      const summary = `${verification.met.length} met, ${verification.unmet.length} unmet${verification.review.length ? `, ${verification.review.length} for review` : ""}`;
      if (verification.unmet.length === 0) {
        state = verification.review.length === 0 ? "done" : "needs-attention";
        await record(vault, path, iteration, summary, verification, state);
        break;
      }
      await record(vault, path, iteration, summary, verification, iteration < last ? "running" : "needs-attention");
      prompt = feedbackPrompt(verification);
    }
  } finally {
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

/** Runs every check after the agent's turn. The wiki reads the vault again first, so the checks see what the agent wrote. */
async function verify(vault: Vault, wiki: Wiki, session: string, doc: Document, promises: Document[]): Promise<Verification> {
  const verification: Verification = { results: [], met: [], unmet: [], review: [] };
  if (promises.length) await wiki.refresh();
  for (const promise of promises) {
    const result = await runCheck(promise, { vault, wiki, session, properties: doc.properties });
    verification.results.push({ promise, result });
    verification[result.status].push(link(promise.path));
  }
  return verification;
}

/** Writes the iteration's outcome to the session document. */
async function record(vault: Vault, path: string, iteration: number, summary: string, verification: Verification | undefined, state: SessionState) {
  await updateDocument(vault, path, (doc) => {
    doc.properties.iteration = iteration;
    doc.properties.state = state;
    if (verification) {
      doc.properties.met = verification.met;
      doc.properties.unmet = [...verification.unmet, ...verification.review];
      const deliverables = verification.results
        .map(({ promise, result }) => `- [${result.status === "met" ? "x" : " "}] ${link(promise.path)} — ${result.detail}`)
        .join("\n");
      doc.body = replaceSection(doc.body, "Deliverables", deliverables);
    }
    const progress = sectionContent(doc.body, "Progress");
    const line = `- ${timestamp().slice(11, 16)} iteration ${iteration}: ${summary}`;
    doc.body = replaceSection(doc.body, "Progress", progress ? `${progress}\n${line}` : line);
  });
}

/** The content of a `## heading` section, without the heading. */
function sectionContent(body: string, heading: string): string {
  const match = body.match(new RegExp(`^## ${heading}\\n([\\s\\S]*?)(?=\\n## |$)`, "m"));
  return (match?.[1] ?? "").trim();
}

/**
 * The first prompt. A linked skill that the agent has as a skill set goes by its command: the prompt
 * starts with the first one, so the harness loads it, and names the others to load. A skill the agent
 * does not have is inlined.
 */
function contextPrompt(vault: Vault, agent: Agent, module: Module, doc: Document, linked: Linked, path: string): string {
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
  const body = [
    `You are running the Yami session "${basename(path)}" of the module "${module.name}".\n` +
      `The working directory is the vault. Paths are relative to it. The session document is ${path}; Yami maintains its properties and its Deliverables and Progress sections, so do not edit that file.\n` +
      `Follow every policy. The session ends when every promise is met. After each of your turns, Yami checks the promises and tells you what is still unmet.`,
    module.instructions,
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
