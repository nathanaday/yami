import type { Agent } from "../agent/agent.js";
import { errorText } from "../agent/types.js";
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
  updateDocument,
  type Document,
} from "../document/document.js";
import type { SessionState } from "../document/schema.js";
import type { Vault } from "../document/vault.js";
import type { Wiki } from "../wiki/wiki.js";
import { AGENT_TOOL } from "./agent-run.js";
import { BASE_SKILL, BASE_SKILL_COMMAND, BASE_SKILL_TEXT, YAMI_SKILLS } from "./base-skill.js";
import { runCheck, type CheckResult } from "./checks.js";
import { freshRun, stopOnAbort } from "./fresh-run.js";
import { linkedDocuments, nameOf } from "./links.js";
import { addProgress, oneLine } from "./progress.js";
import { skillCommand, type Flow, type LinkedKind, type YamiModule } from "./module.js";
import { isJudged, Review, reviewFeedback, reviewPrompt, type ReviewItem } from "./review.js";
import type { Yami } from "./yami.js";
import { reviewTool } from "./yami-tools.js";

/**
 * How a run ended, as `session.start()` and `session.resume()` resolve.
 * @example
 * const result = await session.start();
 * if (result.state !== "done") new Notice(`${result.state}: ${result.reason ?? ""}`);
 */
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
  /**
   * Why the run ended `failed` or `needs-attention`: the line that it recorded last in the Progress section,
   * without the time, such as `iteration 1: turn failed: …`, `iteration 3: 1 met, 1 unmet`, or
   * `iteration 1: 0 met, 0 unmet, 1 for review: Approved — ask the user`, which names each promise for
   * review with its check's reason. A fault of Yami's own code gives the error's kind, its message, and
   * where it was thrown: `failed: TypeError: … (at …)`, or `iteration 1: review failed: TypeError: … (at …)`
   * during a review. None for any other state.
   */
  reason?: string;
}

/** How a session handle and its run talk: the run reports its phase, and the handle asks it to stop. */
export interface RunControl {
  /**
   * Aborts on stop, and with the reason `KILL` on kill. The run stops its live conversation, the worker's or
   * the reviewer's, as `stopOnAbort` does, ends at its next step, and records `stopped`.
   */
  readonly signal: AbortSignal;
  phase(phase: "working" | "checking" | "reviewing"): void;
  /**
   * The run calls it as it writes its end to the document, just before the write, and then closes its
   * conversations. From then on the run is not live.
   */
  end(state: SessionState): void;
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

/** The module and the flow of a session document. */
export function sessionParts(yami: Yami, doc: Document): { module: YamiModule; flow: Flow | undefined } {
  if (doc.properties.type !== "session") throw new Error(`${doc.path} is not a session document.`);
  const module = yami.module(String(doc.properties.module ?? ""));
  if (!module) throw new Error(`${doc.path} is a session of the module "${String(doc.properties.module)}", which this Yami does not have.`);
  if (module.sessionsIn === "none") throw new Error(`The ${module.id} module has no sessions.`);
  const flow = module.flowOf(doc.properties.flow);
  if (doc.properties.flow && !flow) throw new Error(`${doc.path} names the flow "${String(doc.properties.flow)}", which the ${module.id} module does not have.`);
  return { module, flow };
}

/** Runs the code checks of a session's promises, and records nothing. */
export async function checkSession(yami: Yami, path: string): Promise<SessionCheck> {
  const doc = await readDocument(yami.vault, path);
  const { module } = sessionParts(yami, doc);
  const linked = await loadLinked(yami.vault, module.id, doc);
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
  const { module, flow } = sessionParts(yami, doc);
  const linked = await loadLinked(vault, module.id, doc);
  const turns = options.maxIterations ?? flow?.maxIterations ?? 3;
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
  const kind = flow ? `a "${flow.name}" session of the module "${module.name}"` : `a session of the module "${module.name}"`;
  // The last Progress line, which says why a run that did not end done ended.
  let reason = "";
  // Each write of a state other than `running` is the run's end.
  const write = (outcome: Outcome) => {
    reason = oneLine(outcome.line);
    return record(vault, path, linked.promises, outcome, () => outcome.state !== "running" && control.end(outcome.state));
  };
  // The closes of the reviewers' conversations. The run waits for them after it records its end.
  const closing: Promise<void>[] = [];

  let conversation: Conversation | undefined;
  let reviewNote: string | undefined;
  let feedback: string | undefined;
  let reply: string | undefined;
  let state: SessionState = "needs-attention";
  let iteration = start;
  // A start begins with a turn; a resume checks first, so a session whose work is done needs no turn.
  let turn = !earlier;
  const stopped = () => control.signal.aborted;
  // The worker's conversation. During a review it has no turn, and the review stops the reviewer's.
  const unlisten = stopOnAbort(control.signal, () => conversation);
  try {
    for (;;) {
      let interrupted = false;
      if (turn) {
        if (stopped()) {
          state = "stopped";
          await write({ iteration, line: "stopped", state });
          break;
        }
        let prompt = feedback ?? "";
        if (!conversation) {
          const access = flow?.access ?? "edit";
          conversation = await yami.openConversation({
            agent,
            name: `${module.id} ${basename(path)}`,
            folder: yami.conversationFolder,
            module: path,
            approval: "accept-edits",
            access,
            tools: yami.tools({ agent, module: module.id, session: path, access, approval: "accept-edits" }),
            resume: earlier,
          });
          const opened = conversation;
          await updateDocument(vault, path, (d) => {
            d.properties.state = "running";
            d.properties.harness = agent.harness;
            d.properties.conversation = link(opened.path);
          });
          // A conversation that kept its harness session needs only the feedback; any other gets the whole context first.
          if (!(conversation.continued && feedback)) prompt = [await contextPrompt(vault, agent, module, flow, doc, linked, path, kind), feedback].filter(Boolean).join("\n\n");
        }
        // A stop that came while the conversation opened found no turn to stop.
        if (stopped()) {
          state = "stopped";
          await write({ iteration, line: "stopped", state });
          break;
        }
        iteration += 1;
        control.phase("working");
        const result = await conversation.send(prompt);
        reply = result.text;
        if (result.status === "failed" && !stopped()) {
          state = "failed";
          await write({ iteration, line: `iteration ${iteration}: turn failed: ${result.error ?? "no details"}`, state });
          break;
        }
        interrupted = stopped() || result.status === "interrupted";
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
      if (interrupted || stopped()) {
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
      // A fault of Yami's own code in the review fails it as a harness failure does, with where it was thrown.
      const { note, result } = await runReview(yami, agent, control, review, { path, name: `${module.id} ${basename(path)} review`, prompt, closing }).catch(
        (error: unknown) => ({ note: undefined, result: { status: "failed", text: "", error: errorText(error) } as ConversationTurn }),
      );
      reviewNote = note ?? reviewNote;
      if (result.status === "failed" && !stopped()) {
        state = "failed";
        await write({ iteration, line: `${step}: review failed: ${result.error ?? "no details"}`, state });
        break;
      }
      if (stopped() || result.status === "interrupted") {
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
    state = stopped() ? "stopped" : "failed";
    await write({ iteration, line: state === "stopped" ? "stopped" : `failed: ${errorText(error)}`, state });
  } finally {
    unlisten();
    await Promise.all([conversation?.close(), ...closing]);
  }
  return {
    path,
    state,
    iterations: iteration - start,
    conversation: conversation?.path ?? earlier,
    ...(reviewNote && { review: reviewNote }),
    ...((state === "failed" || state === "needs-attention") && { reason }),
  };
}

/**
 * The review: a fresh run of the agent, read-only, which records its verdicts into `review` with
 * `yami_review`. It gets only the tools that change nothing, and its own `yami_review`. A stop of the run
 * interrupts it, and a kill closes it.
 */
async function runReview(
  yami: Yami,
  agent: Agent,
  control: RunControl,
  review: Review,
  options: { path: string; name: string; prompt: string; closing: Promise<void>[] },
): Promise<{ note: string; result: ConversationTurn }> {
  const served = yami.tools();
  try {
    return await freshRun(yami, {
      agent,
      name: options.name,
      session: options.path,
      approval: "accept-edits",
      access: "read-only",
      tools: { ...served, tools: [...served.tools.filter((tool) => tool.readOnly), reviewTool(review)] },
      prompt: options.prompt,
      signal: control.signal,
      closing: (closed) => {
        options.closing.push(closed);
        closed.catch(() => undefined);
      },
      opened: async (reviewer) => {
        await updateDocument(yami.vault, options.path, (d) => {
          d.properties.state = "running";
          d.properties.review = link(reviewer.path);
        });
      },
    });
  } finally {
    review.open = false;
  }
}

/** Reads every document the session links. A link that finds no note stops the run before it starts. */
async function loadLinked(vault: Vault, module: string, doc: Document): Promise<Linked> {
  const linked = { agents: [], articles: [], policies: [], promises: [], skills: [] } as Linked;
  for (const { kind, target, path } of await linkedDocuments(vault, module, doc.properties)) {
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

/** The counts of the checks, and each promise for review with its check's reason: what a person must decide. */
function summary(verification: Verification): string {
  const review = verification.results.filter(({ result }) => result.status === "review").map(({ promise, result }) => `${documentName(promise.path)} — ${result.detail}`);
  return `${verification.met.length} met, ${verification.unmet.length} unmet${review.length ? `, ${review.length} for review: ${review.join("; ")}` : ""}`;
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
 * verdicts of a review. A promise with no check is unmet until a review finds it met. `writing` runs just
 * before the write.
 */
async function record(vault: Vault, path: string, promises: Document[], outcome: Outcome, writing: () => void) {
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
        lines.push(`- [${ok ? "x" : " "}] ${link(promise.path)} — ${oneLine(detail)}`);
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
    addProgress(doc, outcome.line);
    writing();
  });
}

/**
 * The first prompt: what is particular to the session. The base skill holds how every session runs. An
 * agent with Yami's skill set invokes it, `/yami:run`; any other agent gets its text first. A linked skill
 * that the agent has as a skill set goes by its command, and the skill tells the agent to load the first
 * one; a skill the agent does not have is inlined.
 */
async function contextPrompt(vault: Vault, agent: Agent, module: YamiModule, flow: Flow | undefined, doc: Document, linked: Linked, path: string, kind: string): Promise<string> {
  const fields = Object.keys(module.schema ?? {})
    .map((field) => `- ${field}: ${String(doc.properties[field] ?? "")}`)
    .join("\n");
  const section = (title: string, docs: Document[], render: (d: Document) => string) =>
    docs.length ? `## ${title}\n\n${docs.map((d) => `### ${documentName(d.path)}\n\n${render(d)}`).join("\n\n")}` : "";
  const promise = (d: Document) =>
    [
      ...Object.entries(d.properties)
        .filter(([key]) => key !== "name")
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
  const agents = linked.agents.length
    ? `## Agents\n\nThe agents of this session. Each works in a fresh context, with its own brief, and returns its final message. To run one, call the tool \`${AGENT_TOOL}\` with its name and a task that holds everything it needs. Several can run at the same time.\n\n${linked.agents
        .map((d) => `- \`${nameOf(d.path, module.id)}\`: ${String(d.properties.description ?? "")}${d.properties.access === "edit" ? " It can edit files." : " It is read-only."}`)
        .join("\n")}`
    : "";
  const invoked = sets.has(`${root}/${YAMI_SKILLS}`) && (await vault.exists(BASE_SKILL));
  const base = invoked ? "" : `## How to run a Yami session\n\n${parseDocument(vault, BASE_SKILL, (await vault.exists(BASE_SKILL)) ? await vault.read(BASE_SKILL) : BASE_SKILL_TEXT).body.trim()}`;
  const body = [
    base,
    `This is the Yami session "${basename(path)}", ${kind}. The session document is ${path}.`,
    module.instructions,
    flow?.instructions,
    fields && `## Session properties\n\n${fields}`,
    `## Session\n\n${doc.body.trim()}`,
    section("Policies", linked.policies, (d) => d.body.trim()),
    section("Promises", linked.promises, promise),
    listed,
    section(attached.length ? "Other skills" : "Skills", inlined, (d) => d.body.trim()),
    agents,
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
