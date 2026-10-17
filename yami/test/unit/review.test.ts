import { afterEach, describe, expect, it } from "vitest";
import { runTool } from "../../src/agent/index.js";
import { readDocument } from "../../src/document/index.js";
import { type SessionStatus } from "../../src/index.js";
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

    const doc = await readDocument(vault, path);
    expect(doc.properties).toMatchObject({ state: "done", followed: [POLICY], broken: [], review: "[[conversations/judged all review|judged all review]]" });
    expect(doc.body).toContain(`## Review\n- followed: ${POLICY} — The scripted reviewer finds it followed.`);
    expect(doc.body).toContain("iteration 1: 1 met, 0 unmet");
    expect(doc.body).toContain("iteration 1: review: 1 followed, 0 broken");
    const details = await session.details();
    expect(details.review).toBe("conversations/judged all review.md");
    expect(details.documents.find((d) => d.kind === "policies")).toMatchObject({ name: "Always say hello", followed: true });
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
    expect(await session.start()).toMatchObject({ state: "needs-attention", iterations: 1 });
    const doc = await vault.read(path);
    expect(doc).toContain("iteration 1: review: 0 followed, 0 broken; no verdict on Always say hello");
    expect(doc).toContain(`## Review\n- no verdict: ${POLICY}`);
    expect(await session.status()).toBe("needs-attention");
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
    expect(await run).toMatchObject({ state: "stopped", iterations: 1 });
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
    expect(details.documents.filter((d) => d.kind === "promises").map((d) => d.met)).toEqual([true, true]);
  });

  it("marks a promise with no check unmet until a review meets it", async () => {
    const { session, agent, vault, path } = await fresh("waiting", (m) => m.warm);
    agent.queue(write("waiting"), () => {});
    await session.start({ maxIterations: 1 });
    const doc = await readDocument(vault, path);
    expect(doc.properties.unmet).toEqual(["[[internal/judged/promises/Kind words|Kind words]]"]);
    expect(doc.body).toContain("iteration 1: 1 met, 0 unmet");
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
    expect(await session.start()).toMatchObject({ state: "needs-attention", iterations: 1 });
    expect(agent.started).toHaveLength(1);
    expect(await vault.read(path)).toContain("iteration 1: 0 met, 0 unmet, 1 for review");
  });

  it("records a verdict only from the reviewer of a live review, of the right kind, on an item of the review", async () => {
    const { session, agent, yami, path } = await fresh("tool");
    const reviewTool = yami.tools().tools.find((tool) => tool.name === "yami_review")!;
    const call = (input: unknown) => runTool(reviewTool, input, new AbortController().signal);
    const outside = await call({ session: path, verdicts: [] });
    expect(outside).toMatchObject({ isError: true, text: "No review of judged/tool.md is live. Only the reviewer of a session records verdicts, while Yami reviews it." });
    const results: unknown[] = [];
    agent.queue(write("tool"), async (_prompt, reviewer) => {
      results.push(JSON.parse((await reviewer.tool("yami_review", { session: "[[judged/tool]]", verdicts: [] })).text));
      const wrong = await reviewer.tool("yami_review", {
        session: path,
        verdicts: [
          { item: "Always say hello", verdict: "met", reason: "A policy cannot be met." },
          { item: "Nothing", verdict: "followed", reason: "No such item." },
        ],
      });
      expect(wrong.isError).toBe(true);
      results.push(JSON.parse(wrong.text));
      results.push(JSON.parse((await reviewer.tool("yami_review", { session: path, verdicts: [{ item: "internal/judged/policies/Always say hello.md", verdict: "followed", reason: "It said hello." }] })).text));
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
