import { afterEach, describe, expect, it } from "vitest";
import { runTool, toolTitle } from "../../src/agent/index.js";
import { readDocument } from "../../src/document/index.js";
import { defineTool, type AgentTool, type SessionStatus } from "../../src/index.js";
import { review, testYami, type TestYami, type Turn } from "../../src/testing/index.js";
import { Hello } from "../fixtures/hello.js";

let t: TestYami | undefined;
afterEach(async () => {
  await t?.dispose();
  t = undefined;
});

/** Hello, with a promise that no check decides and a template that links it, and a template with no policy. */
class Judged extends Hello {
  readonly id = "judged";
  readonly kind = this.promise("Kind words", "The greeting is warm.");
  readonly odd = this.promise("Odd check", "A check that Yami does not know.", { check: "nonesuch" });
  readonly warm = this.template({ id: "warm", name: "Warm", policies: [this.polite], promises: [this.note, this.kind] });
  readonly plain = this.template({ id: "plain", name: "Plain", promises: [this.note] });
  readonly unknown = this.template({ id: "unknown", name: "Unknown", policies: [this.polite], promises: [this.odd] });

  tools(): AgentTool[] {
    return [...super.tools(), defineTool({ name: "count", description: "Counts the greetings.", input: {}, readOnly: true, run: async () => "0" })];
  }
}

async function fresh(name: string, template: (m: Judged) => Judged["greet"] = (m) => m.greet) {
  const module = new Judged();
  t = await testYami({ modules: [module] });
  const session = await template(module).create({ name, exact: true });
  return { ...t, module, session, path: session.path };
}

const write = (name: string) => () => t!.vault.write(`greetings/${name}.md`, `Hello, ${name}`);
const POLICY = "[[internal/judged/policies/Always say hello|Always say hello]]";

function hold(): { turn: Turn; begun: Promise<void> } {
  let begin!: () => void;
  const begun = new Promise<void>((resolve) => (begin = resolve));
  return {
    turn: () => {
      begin();
      return new Promise(() => undefined);
    },
    begun,
  };
}

describe("the review step", () => {
  it("judges the policies in a new read-only conversation after the checks pass, and ends done when all are followed", async () => {
    const { session, agent, vault, path } = await fresh("all");
    agent.queue(() => ({ text: "I wrote greetings/all.md." }), review());
    await write("all")();
    const result = await session.start();
    expect(result).toMatchObject({ state: "done", iterations: 1, review: "conversations/judged all review.md" });
    expect(agent.started).toHaveLength(2);
    const reviewer = agent.started[1]!;
    expect(reviewer.id).not.toBe(agent.started[0]!.id);
    expect(reviewer.options.access).toBe("read-only");
    const [prompt] = reviewer.prompts;
    expect(prompt).toMatch(/^You review the Yami session "all", a "Greeting" session of the module "Hello world"\./);
    expect(prompt).toContain("\nThe session document is judged/all.md. The conversation note conversations/judged all.md records the run");
    expect(prompt).toContain("## Policies\n\n### Always say hello\n\nPath: internal/judged/policies/Always say hello.md");
    expect(prompt).toContain("## The worker's last message\n\nI wrote greetings/all.md.");
    expect(prompt).not.toContain("## Promises");
    expect(prompt).toContain("Judge each policy and each promise below, and only these: Always say hello. Yami's checks decided the other promises of the session.");
    // The reviewer sees the session as the verification left it.
    expect(prompt).toContain("- [x] [[internal/judged/promises/Greeting note|Greeting note]] — found greetings/all.md");
    expect(prompt).toContain("iteration 1: 1 met, 0 unmet");

    const doc = await readDocument(vault, path);
    expect(doc.properties).toMatchObject({ state: "done", followed: [POLICY], broken: [], review: "[[conversations/judged all review|judged all review]]" });
    expect(doc.body).toContain(`## Review\n- followed: ${POLICY} — The scripted reviewer finds it followed.`);
    expect(doc.body).toContain("iteration 1: 1 met, 0 unmet");
    expect(doc.body).toContain("iteration 1: review: 1 followed, 0 broken");
    const details = await session.details();
    expect(details.review).toBe("conversations/judged all review.md");
    expect(details.documents.find((d) => d.kind === "policies")).toMatchObject({ name: "Always say hello", followed: true, reason: "The scripted reviewer finds it followed." });
    expect(details.documents.find((d) => d.kind === "promises")).toMatchObject({ name: "Greeting note", met: true, judged: false, reason: "found greetings/all.md" });
    expect(await vault.read("conversations/judged all review.md")).toContain("access: read-only");
  });

  it("sends a broken policy back to the worker, who fixes it, and the next review passes", async () => {
    const { session, agent, vault, path } = await fresh("fixed");
    agent.queue(write("fixed"), review({ "Always say hello": ["broken", "It began with Hi."] }), () => {}, review());
    const result = await session.start();
    expect(result).toMatchObject({ state: "done", iterations: 2, review: "conversations/judged fixed review 2.md" });
    const worker = agent.started[0]!;
    expect(worker.prompts).toHaveLength(2);
    expect(worker.prompts[1]).toBe("A reviewer judged your work after your last turn.\n\n- Always say hello (policy): broken, It began with Hi.\n\nFix what is broken or unmet. Follow the policies.");
    const doc = await vault.read(path);
    expect(doc).toContain("iteration 1: review: 0 followed, 1 broken");
    expect(doc).toContain("iteration 2: 1 met, 0 unmet");
    expect(doc).toContain("iteration 2: review: 1 followed, 0 broken");
    expect((await readDocument(vault, path)).properties).toMatchObject({ followed: [POLICY], broken: [] });
  });

  it("needs attention when the reviewer gives no verdict, and says on what", async () => {
    const { session, agent, vault, path } = await fresh("silent");
    agent.queue(write("silent"), () => ({ text: "Looks fine." }));
    expect(await session.start()).toMatchObject({ state: "needs-attention", iterations: 1, reason: "iteration 1: review: 0 followed, 0 broken; no verdict on Always say hello" });
    const doc = await vault.read(path);
    expect(doc).toContain("iteration 1: review: 0 followed, 0 broken; no verdict on Always say hello");
    expect(doc).toContain(`## Review\n- no verdict: ${POLICY}`);
    expect(await session.status()).toBe("needs-attention");
  });

  it("fails when the reviewer's turn fails, and the result says why", async () => {
    const { session, agent, vault, path } = await fresh("unreviewed");
    agent.queue(write("unreviewed"), () => ({ status: "failed", error: "The session has no tool wiki_change." }));
    expect(await session.start()).toMatchObject({ state: "failed", iterations: 1, reason: "iteration 1: review failed: The session has no tool wiki_change." });
    expect(await vault.read(path)).toContain("iteration 1: review failed: The session has no tool wiki_change.");
  });

  it("fails when Yami's own code throws during the review, and the reason names the error and where it was thrown", async () => {
    const { session, agent, vault, path, yami } = await fresh("faulty");
    agent.queue(write("faulty"));
    const open = yami.openConversation.bind(yami);
    let opened = 0;
    yami.openConversation = async (options) => {
      if (++opened === 2) throw new TypeError("Cannot read properties of undefined (reading 'length')");
      return open(options);
    };
    const result = await session.start();
    expect(result).toMatchObject({ state: "failed", iterations: 1 });
    expect(result.reason).toMatch(/^iteration 1: review failed: TypeError: Cannot read properties of undefined \(reading 'length'\) \(at .*\(review\.test\.ts:\d+:\d+\)\)$/);
    expect(await vault.read(path)).toContain("iteration 1: review failed: TypeError: Cannot read properties");
  });

  it("needs attention when the review finds a policy broken on the last iteration", async () => {
    const { session, agent, path, vault } = await fresh("late");
    agent.queue(write("late"), review({ "Always say hello": "broken" }));
    expect(await session.start({ maxIterations: 1 })).toMatchObject({ state: "needs-attention", iterations: 1 });
    expect((await readDocument(vault, path)).properties).toMatchObject({ followed: [], broken: [POLICY] });
  });

  it("stops during the review: the phase is reviewing, and the run ends stopped", async () => {
    const { session, agent, vault, path, yami } = await fresh("paused");
    const seen: SessionStatus[] = [];
    session.on((status) => seen.push(status));
    const { turn, begun } = hold();
    agent.queue(write("paused"), turn);
    const run = session.start();
    await begun;
    expect(await session.status()).toBe("reviewing");
    expect((await yami.summaries())[0]!.status).toBe("reviewing");
    await session.stop();
    const stopped = await run;
    expect(stopped).toMatchObject({ state: "stopped", iterations: 1 });
    expect(stopped.reason).toBeUndefined();
    expect(seen).toEqual(["working", "checking", "reviewing", "stopped"]);
    const doc = await vault.read(path);
    expect(doc).toContain("iteration 1: review stopped");
    expect(doc).toContain("state: stopped");
  });

  it("kills the reviewer at once, and the run ends stopped; a resume reviews again with no worker turn", async () => {
    const { session, agent } = await fresh("killed");
    const { turn, begun } = hold();
    agent.queue(write("killed"), turn);
    const run = session.start();
    await begun;
    await session.kill();
    expect((await run).state).toBe("stopped");
    expect(agent.started[1]!.closed).toBe(true);
    agent.queue(review());
    expect(await session.resume()).toMatchObject({ state: "done", iterations: 0 });
    expect(agent.started).toHaveLength(3);
    expect(agent.started[2]!.options.access).toBe("read-only");
  });

  it("judges a promise with no check: an unmet one goes back to the worker, and a met one counts as met", async () => {
    const { session, agent, vault, path } = await fresh("warm", (m) => m.warm);
    agent.queue(write("warm"), review({ "Kind words": ["unmet", "It is curt."] }), () => {}, review());
    const result = await session.start();
    expect(result).toMatchObject({ state: "done", iterations: 2 });
    const [first, second] = agent.started[0]!.prompts;
    expect(first).toContain("- The review judges this promise: it has no check.");
    expect(second).toContain("- Kind words (promise): unmet, It is curt.");
    expect(agent.started[1]!.prompts[0]).toContain("## Promises\n\n### Kind words\n\nPath: internal/judged/promises/Kind words.md\n\nThe greeting is warm.");
    expect(agent.started[1]!.prompts[0]).not.toContain("### Greeting note");
    const doc = await readDocument(vault, path);
    expect(doc.properties.met).toEqual(["[[internal/judged/promises/Greeting note|Greeting note]]", "[[internal/judged/promises/Kind words|Kind words]]"]);
    expect(doc.body).toContain("- [x] [[internal/judged/promises/Kind words|Kind words]] — review: The scripted reviewer finds it met.");
    expect(doc.body).toContain("iteration 1: review: 1 followed, 0 broken, 0 met, 1 unmet");
    const details = await session.details();
    expect(details.documents.filter((d) => d.kind === "promises").map(({ met, judged, reason }) => ({ met, judged, reason }))).toEqual([
      { met: true, judged: false, reason: "found greetings/warm.md" },
      { met: true, judged: true, reason: "review: The scripted reviewer finds it met." },
    ]);
  });

  it("marks a promise with no check unmet until a review meets it", async () => {
    const { session, agent, vault, path } = await fresh("waiting", (m) => m.warm);
    agent.queue(write("waiting"), () => {});
    await session.start({ maxIterations: 1 });
    const doc = await readDocument(vault, path);
    expect(doc.properties.unmet).toEqual(["[[internal/judged/promises/Kind words|Kind words]]"]);
    expect(doc.body).toContain("iteration 1: 1 met, 0 unmet");
    const kind = (await session.details()).documents.find((d) => d.name === "Kind words");
    expect(kind).toMatchObject({ met: false, judged: true, reason: "the review judges it" });
  });

  it("gives no verdict and no reason before a run", async () => {
    const { session } = await fresh("before", (m) => m.warm);
    const documents = (await session.details()).documents.filter((d) => d.kind !== "skills");
    expect(documents.map(({ name, met, followed, judged, reason }) => ({ name, met, followed, judged, reason }))).toEqual([
      { name: "Greeting note", met: undefined, followed: undefined, judged: false, reason: undefined },
      { name: "Kind words", met: undefined, followed: undefined, judged: true, reason: undefined },
      { name: "Always say hello", met: undefined, followed: undefined, judged: undefined, reason: undefined },
    ]);
  });

  it("runs as before when the session has no policy and no promise without a check", async () => {
    const { session, agent, vault, path } = await fresh("plain", (m) => m.plain);
    agent.queue(write("plain"));
    expect(await session.start()).toMatchObject({ state: "done", iterations: 1 });
    expect(agent.started).toHaveLength(1);
    expect((await session.start()).review).toBeUndefined();
    expect(await vault.read(path)).not.toContain("## Review");
  });

  it("needs attention with no review when a check returns review, as an unknown check does", async () => {
    const { session, agent, vault, path } = await fresh("unknown", (m) => m.unknown);
    const reason = 'iteration 1: 0 met, 0 unmet, 1 for review: Odd check — unknown check "nonesuch"';
    expect(await session.start()).toMatchObject({ state: "needs-attention", iterations: 1, reason });
    expect(agent.started).toHaveLength(1);
    expect(await vault.read(path)).toContain(reason);
  });

  it("gives the reviewer only the tools that change nothing, and the review tool, which no other agent has", async () => {
    const { session, agent, yami } = await fresh("tools");
    agent.queue(write("tools"), review());
    expect(await session.start()).toMatchObject({ state: "done" });
    const names = (s: { options: { tools?: { tools: AgentTool[] } } }) => s.options.tools?.tools.map((tool) => tool.name);
    const [worker, reviewer] = agent.started;
    expect(names(reviewer!)).toEqual(["yami_check", "wiki_search", "wiki_match", "wiki_lint", "wiki_tags", "wiki_neighbors", "wiki_chunks", "judged_count", "yami_review"]);
    expect(reviewer!.options.tools?.name).toBe("yami");
    expect(names(worker!)).toContain("wiki_change");
    expect(names(worker!)).toContain("judged_greet_user");
    expect(names(worker!)).not.toContain("yami_review");
    expect(yami.tools().tools.map((tool) => tool.name)).not.toContain("yami_review");
    await expect(worker!.tool("yami_review", { verdicts: [] })).rejects.toThrow("The session has no tool yami_review.");
  });

  it("records a verdict of the right kind on an item of its own review", async () => {
    const { session, agent } = await fresh("tool");
    const results: unknown[] = [];
    agent.queue(write("tool"), async (_prompt, reviewer) => {
      results.push(JSON.parse((await reviewer.tool("yami_review", { verdicts: [] })).text));
      const wrong = await reviewer.tool("yami_review", {
        verdicts: [
          { item: "Always say hello", verdict: "met", reason: "A policy cannot be met." },
          { item: "Nothing", verdict: "followed", reason: "No such item." },
        ],
      });
      expect(wrong.isError).toBe(true);
      results.push(JSON.parse(wrong.text));
      results.push(JSON.parse((await reviewer.tool("yami_review", { verdicts: [{ item: "[[internal/judged/policies/Always say hello]]", verdict: "followed", reason: "It said hello." }] })).text));
    });
    expect(await session.start()).toMatchObject({ state: "done" });
    const item = { kind: "policy", name: "Always say hello", path: "internal/judged/policies/Always say hello.md" };
    expect(results).toEqual([
      { recorded: 0, errors: [], remaining: [item] },
      {
        recorded: 0,
        errors: ["Always say hello is a policy: its verdict is followed or broken, not met.", '"Nothing" is no policy or promise of this review. Judge only: Always say hello.'],
        remaining: [item],
      },
      { recorded: 1, errors: [], remaining: [] },
    ]);
  });

  it("lists the items still to judge when the reviewer calls the review tool with no verdicts, as its description says", async () => {
    const { session, agent } = await fresh("look");
    const calls: { title: string; result: { text: string; isError: boolean } }[] = [];
    agent.queue(write("look"), async (_prompt, reviewer) => {
      const tool = reviewer.options.tools!.tools.find((candidate) => candidate.name === "yami_review")!;
      calls.push({ title: toolTitle(tool, {}), result: await reviewer.tool("yami_review", {}) });
      await reviewer.tool("yami_review", { verdicts: [{ item: "Always say hello", verdict: "followed", reason: "It said hello." }] });
    });
    expect(await session.start()).toMatchObject({ state: "done" });
    expect(calls).toEqual([
      {
        title: "List the items to judge",
        result: { isError: false, text: JSON.stringify({ recorded: 0, errors: [], remaining: [{ kind: "policy", name: "Always say hello", path: "internal/judged/policies/Always say hello.md" }] }) },
      },
    ]);
  });

  it("refuses a verdict after its review ended", async () => {
    const { session, agent } = await fresh("late-call");
    let kept: AgentTool | undefined;
    agent.queue(write("late-call"), async (_prompt, reviewer) => {
      kept = reviewer.options.tools?.tools.find((tool) => tool.name === "yami_review");
      await reviewer.tool("yami_review", { verdicts: [{ item: "Always say hello", verdict: "followed", reason: "It said hello." }] });
    });
    expect(await session.start()).toMatchObject({ state: "done" });
    const late = await runTool(kept!, { verdicts: [{ item: "Always say hello", verdict: "broken", reason: "Too late." }] }, new AbortController().signal);
    expect(late).toEqual({ isError: true, text: "This review has ended. A verdict counts only while its review runs." });
  });
});

describe("the self-check tool", () => {
  it("runs the checks of the session's promises and records nothing, for the agent to call before it ends a turn", async () => {
    const { session, agent, vault, path } = await fresh("self", (m) => m.warm);
    const seen: unknown[] = [];
    agent.queue(async (_prompt, worker) => {
      const before = await vault.read(path);
      seen.push(JSON.parse((await worker.tool("yami_check", { session: path })).text));
      await write("self")();
      seen.push(JSON.parse((await worker.tool("yami_check", { session: "judged/self" })).text));
      expect(await vault.read(path)).toBe(before);
    }, review());
    expect(await session.start()).toMatchObject({ state: "done" });
    const promise = { promise: "internal/judged/promises/Greeting note.md", name: "Greeting note" };
    const judged = ["internal/judged/promises/Kind words.md"];
    expect(seen).toEqual([
      { checks: [{ ...promise, status: "unmet", detail: "no file at greetings/self.md" }], judged },
      { checks: [{ ...promise, status: "met", detail: "found greetings/self.md" }], judged },
    ]);
    expect(await session.check()).toEqual(seen[1]);
  });

  it("says when a session cannot be checked", async () => {
    const { yami } = await fresh("x");
    const check = yami.tools().tools.find((tool) => tool.name === "yami_check")!;
    expect(await runTool(check, { session: "judged/missing.md" }, new AbortController().signal)).toMatchObject({ isError: true });
  });
});
