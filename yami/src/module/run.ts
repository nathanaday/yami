import type { Agent } from "../agent/agent.js";
import type { PermissionHandler, SessionEvent } from "../agent/types.js";
import {
  basename,
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
import { runCheck, type CheckResult } from "./checks.js";
import { layout, readSession, skillPath, type Layout, type LinkedKind, type Module } from "./module.js";

export interface RunOptions {
  /** Turns the agent gets to meet every promise. Defaults to 3. */
  maxIterations?: number;
  /** Answers the requests that `edit` access does not allow. Without one, they are denied. */
  permissions?: PermissionHandler;
  onEvent?: (event: SessionEvent) => void;
}

export interface RunResult {
  path: string;
  state: SessionState;
  iterations: number;
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
 * and one verification, and the document shows the state after each one.
 */
export async function runSession(vault: Vault, agent: Agent, module: Module, path: string, options: RunOptions = {}): Promise<RunResult> {
  const lay = layout(module);
  const name = basename(path);
  let doc = await readSession(vault, module, path);
  const linked = await loadLinked(vault, lay, doc);
  const log = new Log(vault, `${lay.logs}/${name}.md`);
  const start = Number(doc.properties.iteration ?? 0);
  const last = start + (options.maxIterations ?? 3);

  doc = await updateDocument(vault, path, (d) => {
    d.properties.state = "running";
    d.properties.harness = agent.harness;
  });

  const session = agent.startSession({ cwd: vault.root, access: "edit", instructions: module.instructions });
  session.setPermissionHandler(options.permissions);
  session.subscribe((event) => {
    options.onEvent?.(event);
    if (event.type === "ready") void updateDocument(vault, path, (d) => (d.properties.harness_session = event.sessionId));
    if (event.type === "permission") void log.append(`- permission ${event.decision}: ${event.request.kind} ${event.request.tool}`);
  });

  let state: SessionState = "needs-attention";
  let iteration = start;
  try {
    let prompt = contextPrompt(module, doc, linked, path);
    while (iteration < last) {
      iteration += 1;
      await log.append(`## Iteration ${iteration}\n\n### Prompt\n\n${prompt}\n`);
      const result = await session.send(prompt);
      await log.append(`### Reply (${result.status})\n\n${result.text}\n${result.errors.map((e) => `\n> ${e}`).join("")}\n`);
      if (result.status !== "success") {
        state = "failed";
        await record(vault, path, iteration, `turn ${result.status}: ${result.errors.join("; ") || "no details"}`, undefined, state);
        break;
      }
      const verification = await verify(vault, name, doc, linked.promises);
      await log.append(`### Verification\n\n${verification.results.map(({ promise, result }) => `- ${basename(promise.path)}: ${result.status}, ${result.detail}`).join("\n")}\n`);
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
    session.close();
  }
  return { path, state, iterations: iteration - start };
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

async function verify(vault: Vault, session: string, doc: Document, promises: Document[]): Promise<Verification> {
  const verification: Verification = { results: [], met: [], unmet: [], review: [] };
  for (const promise of promises) {
    const result = await runCheck(promise, { vault, session, properties: doc.properties });
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

function contextPrompt(module: Module, doc: Document, linked: Linked, path: string): string {
  const fields = Object.keys(module.schema ?? {})
    .map((field) => `- ${field}: ${String(doc.properties[field] ?? "")}`)
    .join("\n");
  const section = (title: string, docs: Document[], render: (d: Document) => string) =>
    docs.length ? `## ${title}\n\n${docs.map((d) => `### ${basename(d.path)}\n\n${render(d)}`).join("\n\n")}` : "";
  const promise = (d: Document) =>
    Object.entries(d.properties)
      .filter(([key]) => !["type", "module"].includes(key))
      .map(([key, value]) => `- ${key}: ${String(value)}`)
      .join("\n") + `\n\n${d.body.trim()}`;
  return [
    `You are running the Yami session "${basename(path)}" of the module "${module.name}".\n` +
      `The working directory is the vault. Paths are relative to it. The session document is ${path}; Yami maintains its properties and its Deliverables and Progress sections, so do not edit that file.\n` +
      `Follow every policy. The session ends when every promise is met. After each of your turns, Yami checks the promises and tells you what is still unmet.`,
    fields && `## Session properties\n\n${fields}`,
    `## Session\n\n${doc.body.trim()}`,
    section("Policies", linked.policies, (d) => d.body.trim()),
    section("Promises", linked.promises, promise),
    section("Skills", linked.skills, (d) => d.body.trim()),
    section("Articles", linked.articles, (d) => d.body.trim()),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function feedbackPrompt(verification: Verification): string {
  const lines = verification.results
    .filter(({ result }) => result.status !== "met")
    .map(({ promise, result }) => `- ${basename(promise.path)}: ${result.status}, ${result.detail}`);
  return `Yami checked the promises after your last turn.\n\n${lines.join("\n")}\n\nMeet the unmet promises. Follow the policies.`;
}

/** The iteration log of a session, in the module's internal folder. */
class Log {
  constructor(
    private readonly vault: Vault,
    private readonly path: string,
  ) {}

  async append(text: string): Promise<void> {
    const current = (await this.vault.exists(this.path)) ? await this.vault.read(this.path) : "";
    await this.vault.write(this.path, `${current}${text}\n`);
  }
}
