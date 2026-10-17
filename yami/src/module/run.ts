import type { Agent } from "../agent/agent.js";
import type { Conversation, ConversationTurn } from "../conversation/conversations.js";
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
import { BASE_SKILL, BASE_SKILL_COMMAND, BASE_SKILL_TEXT, YAMI_SKILLS } from "./base-skill.js";
import { runCheck, type CheckResult } from "./checks.js";
import { linkedDocuments } from "./links.js";
import { skillCommand, type Layout, type LinkedKind, type SessionTemplate, type YamiModule } from "./module.js";
import { isJudged, Review, reviewFeedback, reviewPrompt, type ReviewItem } from "./review.js";
import type { Yami } from "./yami.js";
import { reviewTool } from "./yami-tools.js";

export interface RunResult {
  path: string;
  /** The state the run left in the session document. */
  state: SessionState;
  /** The agent turns of this run. */
  iterations: number;
  /** The conversation note that records the run. None when the run ended before it opened one. */
  conversation?: string;
  /** The conversation note of the run's last review, when it had one. */
  review?: string;
}

/** How a session handle and its run talk: the run reports its phase, and the handle asks it to stop. */
export interface RunControl {
  /** Set by stop and kill. The run ends at its next step and records `stopped`. */
  stopping: boolean;
  /** The conversation that is live now: the worker's, or the reviewer's during a review. */
  conversation?: Conversation;
  phase(phase: "working" | "checking" | "reviewing"): void;
}

type Linked = Record<LinkedKind, Document[]>;

interface Verification {
  /** The results of the promises that have a check. */
  results: { promise: Document; result: CheckResult }[];
  met: string[];
  unmet: string[];
  review: string[];
}

/** One promise's check, as `session.check()` gives it. */
export interface PromiseCheck extends CheckResult {
  /** The promise, as a vault path. */
  promise: string;
  /** The promise's name. */
  name: string;
}

/** The code checks of a session's promises now. */
export interface SessionCheck {
  /** Each promise that has a check, with its result. */
  checks: PromiseCheck[];
  /** The promises with no check, as vault paths: the review judges them after a turn. */
  judged: string[];
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

/** Runs the code checks of a session's promises, and records nothing. */
export async function checkSession(yami: Yami, path: string): Promise<SessionCheck> {
  const doc = await readDocument(yami.vault, path);
  const { module } = sessionParts(yami, doc);
  const linked = await loadLinked(yami.vault, module.layout, doc);
  const verification = await verify(yami.vault, yami.wiki, module, doc, linked.promises);
  return {
    checks: verification.results.map(({ promise, result }) => ({ promise: promise.path, name: documentName(promise.path), ...result })),
    judged: linked.promises.filter(isJudged).map((promise) => promise.path),
  };
}

/**
 * Runs the agent loop on a session document until every promise is met and every policy followed, the
 * iterations run out, the harness fails, or the person stops it. Each iteration is one agent turn and one
 * verification, and a review when the checks pass and the session has something for a reviewer to judge.
 * The document shows the state after each step. The exchange goes to a conversation note, linked from the
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
  const judged = linked.promises.filter(isJudged);
  const items: ReviewItem[] = [
    ...linked.policies.map((d): ReviewItem => ({ kind: "policy", name: documentName(d.path), path: d.path })),
    ...judged.map((d): ReviewItem => ({ kind: "promise", name: documentName(d.path), path: d.path })),
  ];
  const kind = template ? `a "${template.name}" session of the module "${module.name}"` : `a session of the module "${module.name}"`;
  const write = (outcome: Outcome) => record(vault, path, linked.promises, outcome);

  let conversation: Conversation | undefined;
  let reviewNote: string | undefined;
  let feedback: string | undefined;
  let reply: string | undefined;
  let state: SessionState = "needs-attention";
  let iteration = start;
  // A start begins with a turn; a resume checks first, so a session whose work is done needs no turn.
  let turn = !earlier;
  try {
    for (;;) {
      let interrupted = false;
      if (turn) {
        if (control.stopping) {
          state = "stopped";
          await write({ iteration, line: "stopped", state });
          break;
        }
        let prompt = feedback ?? "";
        if (!conversation) {
          conversation = await yami.openConversation({
            agent,
            name: `${module.id} ${basename(path)}`,
            folder: yami.conversationFolder,
            module: path,
            approval: "accept-edits",
            access: template?.access,
            resume: earlier,
          });
          const opened = conversation;
          await updateDocument(vault, path, (d) => {
            d.properties.state = "running";
            d.properties.harness = agent.harness;
            d.properties.conversation = link(opened.path);
          });
          // A conversation that kept its harness session needs only the feedback; any other gets the whole context first.
          if (!(conversation.continued && feedback)) prompt = [await contextPrompt(vault, agent, module, template, doc, linked, path, kind), feedback].filter(Boolean).join("\n\n");
        }
        control.conversation = conversation;
        iteration += 1;
        control.phase("working");
        const result = await conversation.send(prompt);
        reply = result.text;
        if (result.status === "failed" && !control.stopping) {
          state = "failed";
          await write({ iteration, line: `iteration ${iteration}: turn failed: ${result.error ?? "no details"}`, state });
          break;
        }
        interrupted = control.stopping || result.status === "interrupted";
      }
      control.phase("checking");
      // The agent's tools change the session's properties, for example its changes, so the checks read it again.
      doc = await readDocument(vault, path);
      const verification = await verify(vault, yami.wiki, module, doc, linked.promises);
      const step = turn ? `iteration ${iteration}` : "resumed";
      const line = `${step}: ${summary(verification)}`;
      if (verification.unmet.length) {
        feedback = feedbackPrompt(verification);
        if (!turn) {
          turn = true;
          continue;
        }
        if (interrupted) {
          state = "stopped";
          await write({ iteration, line: `${line}; stopped`, verification, state });
          break;
        }
        state = iteration < last ? "running" : "needs-attention";
        await write({ iteration, line, verification, state });
        if (state === "running") continue;
        break;
      }
      if (verification.review.length || !items.length) {
        state = verification.review.length ? "needs-attention" : "done";
        await write({ iteration, line, verification, state });
        break;
      }
      if (interrupted || control.stopping) {
        state = "stopped";
        await write({ iteration, line: `${line}; stopped`, verification, state });
        break;
      }
      await write({ iteration, line, verification, state: "running" });
      // The reviewer sees the session as the verification left it.
      doc = await readDocument(vault, path);

      control.phase("reviewing");
      const review = new Review(items);
      const prompt = reviewPrompt({ path, kind, conversation: conversation?.path ?? earlier, session: doc, reply, policies: linked.policies, promises: judged });
      const { note, result } = await runReview(yami, agent, control, review, { path, name: `${module.id} ${basename(path)} review`, prompt, worker: conversation });
      reviewNote = note;
      if (result.status === "failed" && !control.stopping) {
        state = "failed";
        await write({ iteration, line: `${step}: review failed: ${result.error ?? "no details"}`, state });
        break;
      }
      if (control.stopping || result.status === "interrupted") {
        state = "stopped";
        await write({ iteration, line: `${step}: review stopped`, state });
        break;
      }
      const reviewLine = `${step}: ${review.summary()}`;
      if (review.missing.length) {
        state = "needs-attention";
        await write({ iteration, line: reviewLine, verification, review, state });
        break;
      }
      if (review.failed.length) {
        feedback = reviewFeedback(review);
        turn = true;
        state = iteration < last ? "running" : "needs-attention";
        await write({ iteration, line: reviewLine, verification, review, state });
        if (state === "running") continue;
        break;
      }
      state = "done";
      await write({ iteration, line: reviewLine, verification, review, state });
      break;
    }
  } catch (error) {
    // A run never leaves its document running: a kill can close the conversation in the middle of a step.
    state = control.stopping ? "stopped" : "failed";
    await write({ iteration, line: state === "stopped" ? "stopped" : `failed: ${error instanceof Error ? error.message : String(error)}`, state });
  } finally {
    control.conversation = undefined;
    await conversation?.close();
  }
  return { path, state, iterations: iteration - start, conversation: conversation?.path ?? earlier, ...(reviewNote && { review: reviewNote }) };
}

/**
 * The review: a new read-only conversation with the agent, which records its verdicts into `review` with
 * `yami_review`. It gets only the tools that change nothing, and its own `yami_review`. While it runs, it
 * is the run's live conversation, so stop and kill reach it.
 */
async function runReview(
  yami: Yami,
  agent: Agent,
  control: RunControl,
  review: Review,
  options: { path: string; name: string; prompt: string; worker: Conversation | undefined },
): Promise<{ note: string; result: ConversationTurn }> {
  const served = yami.tools();
  const reviewer = await yami.openConversation({
    agent,
    name: options.name,
    folder: yami.conversationFolder,
    module: options.path,
    approval: "accept-edits",
    access: "read-only",
    tools: { ...served, tools: [...served.tools.filter((tool) => tool.readOnly), reviewTool(review)] },
  });
  control.conversation = reviewer;
  try {
    await updateDocument(yami.vault, options.path, (d) => {
      d.properties.state = "running";
      d.properties.review = link(reviewer.path);
    });
    // A stop that came while the conversation opened found no turn to interrupt.
    const result: ConversationTurn = control.stopping ? { status: "interrupted", text: "" } : await reviewer.send(options.prompt);
    return { note: reviewer.path, result };
  } finally {
    review.open = false;
    control.conversation = options.worker;
    await reviewer.close();
  }
}

/** Reads every document the session links. A link that finds no note stops the run before it starts. */
async function loadLinked(vault: Vault, lay: Layout, doc: Document): Promise<Linked> {
  const linked = { articles: [], policies: [], promises: [], skills: [] } as Linked;
  for (const { kind, target, path } of await linkedDocuments(vault, lay, doc.properties)) {
    if (!path) throw new Error(`The session links to ${kind} "${target}", which is not in the vault.`);
    linked[kind].push(parseDocument(vault, path, await vault.read(path)));
  }
  return linked;
}

/** Runs the check of each promise that has one. The wiki reads the vault again first, so the checks see what the agent wrote. */
async function verify(vault: Vault, wiki: Wiki, module: YamiModule, doc: Document, promises: Document[]): Promise<Verification> {
  const verification: Verification = { results: [], met: [], unmet: [], review: [] };
  const checked = promises.filter((promise) => !isJudged(promise));
  if (checked.length) await wiki.refresh();
  for (const promise of checked) {
    const result = await runCheck(promise, { vault, wiki, path: doc.path, properties: doc.properties }, module.checks);
    verification.results.push({ promise, result });
    verification[result.status].push(link(promise.path));
  }
  return verification;
}

function summary(verification: Verification): string {
  return `${verification.met.length} met, ${verification.unmet.length} unmet${verification.review.length ? `, ${verification.review.length} for review` : ""}`;
}

interface Outcome {
  iteration: number;
  line: string;
  state: SessionState;
  verification?: Verification;
  review?: Review;
}

/**
 * Writes an outcome to the session document: the state, the deliverables, a line of progress, and the
 * verdicts of a review. A promise with no check is unmet until a review finds it met.
 */
async function record(vault: Vault, path: string, promises: Document[], outcome: Outcome) {
  await updateDocument(vault, path, (doc) => {
    doc.properties.iteration = outcome.iteration;
    doc.properties.state = outcome.state;
    const { verification, review } = outcome;
    if (verification) {
      const met: string[] = [];
      const unmet: string[] = [];
      const lines: string[] = [];
      for (const promise of promises) {
        const checked = verification.results.find((r) => r.promise === promise)?.result;
        const verdict = review?.verdicts.get(promise.path);
        const ok = checked ? checked.status === "met" : verdict ? Review.passes(verdict.verdict) : false;
        const detail = checked ? checked.detail : verdict ? `review: ${verdict.reason}` : "the review judges it";
        (ok ? met : unmet).push(link(promise.path));
        lines.push(`- [${ok ? "x" : " "}] ${link(promise.path)} — ${detail}`);
      }
      doc.properties.met = met;
      doc.properties.unmet = unmet;
      doc.body = replaceSection(doc.body, "Deliverables", lines.join("\n") || "- none");
    }
    if (review) {
      const policies = review.items.filter((item) => item.kind === "policy");
      const passed = (item: ReviewItem) => {
        const verdict = review.verdicts.get(item.path);
        return verdict && Review.passes(verdict.verdict);
      };
      doc.properties.followed = policies.filter(passed).map((item) => link(item.path));
      doc.properties.broken = policies.filter((item) => review.verdicts.get(item.path)?.verdict === "broken").map((item) => link(item.path));
      const verdicts = review.items.map((item) => {
        const verdict = review.verdicts.get(item.path);
        return verdict ? `- ${verdict.verdict}: ${link(item.path)} — ${oneLine(verdict.reason)}` : `- no verdict: ${link(item.path)}`;
      });
      doc.body = replaceSection(doc.body, "Review", verdicts.join("\n"));
    }
    const progress = sectionText(doc.body, "Progress");
    const line = `- ${timestamp().slice(11, 16)} ${oneLine(outcome.line)}`;
    doc.body = replaceSection(doc.body, "Progress", progress ? `${progress}\n${line}` : line);
  });
}

/** A text on one line of at most 300 characters, so a line of a section holds whatever the text holds. */
function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 300 ? `${flat.slice(0, 299)}…` : flat;
}

/**
 * The first prompt: what is particular to the session. The base skill holds how every session runs. An
 * agent with Yami's skill set invokes it, `/yami:run`; any other agent gets its text first. A linked skill
 * that the agent has as a skill set goes by its command, and the skill tells the agent to load the first
 * one; a skill the agent does not have is inlined.
 */
async function contextPrompt(vault: Vault, agent: Agent, module: YamiModule, template: SessionTemplate | undefined, doc: Document, linked: Linked, path: string, kind: string): Promise<string> {
  const fields = Object.keys(module.schema ?? {})
    .map((field) => `- ${field}: ${String(doc.properties[field] ?? "")}`)
    .join("\n");
  const section = (title: string, docs: Document[], render: (d: Document) => string) =>
    docs.length ? `## ${title}\n\n${docs.map((d) => `### ${documentName(d.path)}\n\n${render(d)}`).join("\n\n")}` : "";
  const promise = (d: Document) =>
    [
      ...Object.entries(d.properties)
        .filter(([key]) => !["type", "module"].includes(key))
        .map(([key, value]) => `- ${key}: ${String(value)}`),
      ...(isJudged(d) ? ["- The review judges this promise: it has no check."] : []),
    ].join("\n") + `\n\n${d.body.trim()}`;
  const root = vault.root.replace(/\/$/, "");
  const sets = new Set((agent.preferences.skills ?? []).map((set) => set.replace(/\/$/, "")));
  const attached: { command: string; doc: Document }[] = [];
  const inlined: Document[] = [];
  for (const skill of linked.skills) {
    const named = skillCommand(skill.path);
    if (named && sets.has(`${root}/${named.root}`)) attached.push({ command: named.command, doc: skill });
    else inlined.push(skill);
  }
  const listed = attached.length
    ? `## Skills\n\nThis session's skills, which you have as skills of your own. Load the first one now, and the others when you need them.\n\n${attached
        .map(({ command, doc }) => `- \`${command}\`: ${String(doc.properties.description ?? "")} Its folder: ${doc.path.slice(0, doc.path.lastIndexOf("/"))}/`)
        .join("\n")}`
    : "";
  const invoked = sets.has(`${root}/${YAMI_SKILLS}`) && (await vault.exists(BASE_SKILL));
  const base = invoked ? "" : `## How to run a Yami session\n\n${parseDocument(vault, BASE_SKILL, (await vault.exists(BASE_SKILL)) ? await vault.read(BASE_SKILL) : BASE_SKILL_TEXT).body.trim()}`;
  const body = [
    base,
    `This is the Yami session "${basename(path)}", ${kind}. The session document is ${path}.`,
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
  return invoked ? `/${BASE_SKILL_COMMAND} ${body}` : body;
}

function feedbackPrompt(verification: Verification): string {
  const lines = verification.results
    .filter(({ result }) => result.status !== "met")
    .map(({ promise, result }) => `- ${documentName(promise.path)}: ${result.status}, ${result.detail}`);
  return `Yami checked the promises after your last turn.\n\n${lines.join("\n")}\n\nMeet the unmet promises. Follow the policies.`;
}
