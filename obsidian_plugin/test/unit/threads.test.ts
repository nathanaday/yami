import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCheck } from "yami";
import { runTool, type ToolSet } from "yami/agent";
import { readDocument, sectionText, updateDocument } from "yami/document";
import { testYami, type FsVault, type TestYami } from "yami/testing";
import type { Wiki } from "yami/wiki";
import { Threads } from "../../src/modules/threads/index.js";
import { assemble, parse } from "../../src/modules/threads/thread.js";

let t: TestYami;
let vault: FsVault;
let wiki: Wiki;
let threads: Threads;
let tools: ToolSet | undefined;

beforeEach(async () => {
  threads = new Threads();
  t = await testYami({ modules: [threads] });
  ({ vault } = t);
  wiki = t.yami.wiki;
  tools = t.yami.tools();
});
afterEach(() => t.dispose());

/** Calls a threads tool as an agent would, and returns its result, or throws its refusal. */
async function call(name: string, input: unknown): Promise<any> {
  const tool = tools!.tools.find((t) => t.name === `threads_${name}`)!;
  const result = await runTool(tool, input, new AbortController().signal);
  if (result.isError) throw new Error(result.text);
  return JSON.parse(result.text);
}

const PATH = "threads/Divide.md";
const doc = async () => readDocument(vault, PATH);
const plant = (extra: object = {}) =>
  call("stub", { threads: [{ title: "Divide", idea: "calc needs a Divide that returns an error on division by zero.", description: "Add Divide to calc.", context: "### Where\n\ncalc.go holds Add.", repositories: ["~/code/calc"], ...extra }] });
/** Writes the spec; once the thread has one, the same requirements go again with their ids. */
const specify = async (extra: object = {}) => {
  const has = sectionText((await doc()).body, "Requirements") !== "";
  const requirements = [
    { ...(has && { id: "R1" }), text: "Divide(6, 3) is 2, shown by TestDivide." },
    { ...(has && { id: "R2" }), text: "Divide(1, 0) returns ErrZero, shown by TestDivide." },
  ];
  return call("spec", { thread: "Divide", goal: "Divide numbers safely.", requirements, rules: ["Run make test."], ...extra });
};
const planned = async () => {
  await plant();
  await specify();
  return call("plan", { thread: "Divide", add: [{ text: "Write Divide", serves: ["R1", "R2"], details: "In calc.go." }, { text: "Test Divide", serves: ["R1", "R2"] }] });
};
const executed = async () => {
  await planned();
  return call("plan", { thread: "Divide", done: [{ id: "T1", trail: "calc@a1b2c3d" }, { id: "T2", trail: "calc@b2c3d4e" }] });
};
const pass = (extra: object = {}) =>
  call("round", {
    thread: "Divide",
    scope: "heads: calc@b2c3d4e. Read both commits.",
    results: [
      { requirement: "R1", result: "pass", evidence: "TestDivide/six ok" },
      { requirement: "R2", result: "pass", evidence: "TestDivide/zero ok" },
    ],
    ...extra,
  });
const fail = (extra: object = {}) =>
  call("round", {
    thread: "Divide",
    scope: "heads: calc@b2c3d4e.",
    results: [
      { requirement: "R1", result: "pass", evidence: "TestDivide/six ok" },
      { requirement: "R2", result: "fail", evidence: "TestDivide/zero: got nil" },
    ],
    findings: [{ text: "Divide returns nil for a zero divisor (calc.go:9).", blocking: true }, { text: "Add overflows (calc.go:3); it shows at the base too.", predates: "calc@a0a0a0a" }],
    ...extra,
  });

describe("threads_stub", () => {
  it("plants a thread document with the user's words, its context, and its properties", async () => {
    const result = await plant({ priority: "high", tags: ["calc"] });
    expect(result.planted[0]).toMatchObject({ title: "Divide", path: PATH, phase: "stub", next: { step: "spec" } });
    const d = await doc();
    expect(d.properties).toMatchObject({ type: "session", module: "threads", description: "Add Divide to calc.", repositories: ["~/code/calc"], priority: "high", phase: "stub", tags: ["calc"] });
    expect(sectionText(d.body, "Idea")).toBe("calc needs a Divide that returns an error on division by zero.");
    expect(sectionText(d.body, "Context")).toBe("### Where\n\ncalc.go holds Add.");
    expect(d.body.indexOf("## Deliverables")).toBeLessThan(d.body.indexOf("## Idea"));
    expect(d.properties.promises).toEqual(["[[internal/threads/promises/Thread closed|Thread closed]]"]);
  });

  it("links the threads it comes after, and names an open thread that may hold the same idea", async () => {
    await plant();
    const second = await call("stub", { threads: [{ title: "Divide by zero check", idea: "Divide must refuse zero.", description: "Divide refuses a zero divisor in calc.", after: ["Divide"] }] });
    expect(second.planted[0].similar).toEqual([{ title: "Divide", path: PATH, phase: "stub" }]);
    expect((await readDocument(vault, "threads/Divide by zero check.md")).properties.after).toEqual(["[[threads/Divide|Divide]]"]);
  });

  it("refuses a title that cannot name a file, an empty idea, and an unknown thread in after", async () => {
    await expect(call("stub", { threads: [{ title: "train/val split", idea: "x", description: "x" }] })).rejects.toThrow('holds "/"');
    await expect(call("stub", { threads: [{ title: "Empty", idea: "  ", description: "x" }] })).rejects.toThrow("idea is empty");
    await expect(call("stub", { threads: [{ title: "Later", idea: "x", description: "x", after: ["Nothing"] }] })).rejects.toThrow('No thread is named "Nothing"');
  });
});

describe("threads_spec", () => {
  it("writes the spec in order with numbered requirements, and the thread is specified", async () => {
    await plant();
    const result = await specify({ decisions: ["Return an error, not a panic: callers handle errors."], out_of_scope: ["Modulo."] });
    expect(result).toMatchObject({ phase: "specified", next: { step: "plan" }, requirements: 2 });
    const body = (await doc()).body;
    expect(sectionText(body, "Requirements")).toBe("- **R1** Divide(6, 3) is 2, shown by TestDivide.\n- **R2** Divide(1, 0) returns ErrZero, shown by TestDivide.");
    const order = ["## Idea", "## Context", "## Goal", "## Requirements", "## Rules", "## Decisions", "## Out of scope"].map((h) => body.indexOf(h));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("revises a spec: keeps ids, retires with a reason, numbers new requirements past the retired ones", async () => {
    await plant();
    await specify();
    await call("spec", { thread: "Divide", goal: "Divide numbers safely.", requirements: [{ id: "R1", text: "Divide(6, 3) is 2." }, { text: "Divide(-6, 3) is -2." }], retire: [{ id: "R2", reason: "the zero case moved to its own thread" }] });
    const d = await doc();
    expect(sectionText(d.body, "Requirements")).toBe("- **R1** Divide(6, 3) is 2.\n- **R3** Divide(-6, 3) is -2.");
    expect(d.properties.retired).toEqual(["R2"]);
    expect(sectionText(d.body, "Decisions")).toContain("- Retired R2 (Divide(1, 0) returns ErrZero, shown by TestDivide.): the zero case moved to its own thread");
    // A later revision with decisions of its own keeps the record of the retirement.
    await call("spec", { thread: "Divide", goal: "g", requirements: [{ id: "R1", text: "a" }, { id: "R3", text: "b" }], decisions: ["A new choice."] });
    expect(sectionText((await doc()).body, "Decisions")).toContain("Retired R2");
  });

  it("refuses a spec that drops, invents, or repeats a requirement id, a heading in the goal, and a budget without the user", async () => {
    await plant();
    await specify();
    await expect(call("spec", { thread: "Divide", goal: "g", requirements: [{ id: "R1", text: "a" }] })).rejects.toThrow("leave out R2");
    await expect(call("spec", { thread: "Divide", goal: "g", requirements: [{ id: "R1", text: "a" }, { id: "R2", text: "b" }, { id: "R9", text: "c" }] })).rejects.toThrow("R9 is not a requirement");
    await expect(call("spec", { thread: "Divide", goal: "g", requirements: [{ id: "R1", text: "a" }, { id: "R1", text: "b" }, { id: "R2", text: "c" }] })).rejects.toThrow("R1 twice");
    await expect(call("spec", { thread: "Divide", goal: "## Goal\nx", requirements: [{ text: "a" }] })).rejects.toThrow("heading line");
    await expect(specify({ budget: 5 })).rejects.toThrow("the user's to change");
    await specify({ budget: 5, user_asked: "give it five rounds" });
    expect((await doc()).properties.budget).toBe(5);
    expect(sectionText((await doc()).body, "Decisions")).toContain('The user asked');
  });

  it("refuses to rewrite requirements that hold a line it cannot read", async () => {
    await plant();
    await specify();
    await updateDocument(vault, PATH, (d) => (d.body = d.body.replace("- **R2**", "- R2:")));
    await expect(specify()).rejects.toThrow("## Requirements holds a line the tools cannot read");
  });
});

describe("threads_plan", () => {
  it("adds tasks that serve requirements, marks them done, and the phase follows", async () => {
    expect(await planned()).toMatchObject({ phase: "planned", next: { step: "execute", text: "do T1, T2" }, tasks: { open: 2 } });
    expect(sectionText((await doc()).body, "Plan")).toBe("- [ ] **T1** Write Divide · serves R1, R2\n  In calc.go.\n- [ ] **T2** Test Divide · serves R1, R2");
    expect(await call("plan", { thread: "Divide", done: [{ id: "T1", trail: "calc@a1b2c3d" }] })).toMatchObject({ phase: "in progress" });
    expect(await call("plan", { thread: "Divide", drop: [{ id: "T2", reason: "T1 holds the tests" }] })).toMatchObject({ phase: "unvalidated", next: { step: "validate" } });
    expect(sectionText((await doc()).body, "Plan")).toBe("- [x] **T1** Write Divide · serves R1, R2 · done: calc@a1b2c3d\n  In calc.go.\n- [-] **T2** Test Divide · serves R1, R2 · dropped: T1 holds the tests");
    await expect(call("plan", { thread: "Divide", drop: [{ id: "T2", reason: "again" }] })).rejects.toThrow("T2 is dropped already");
  });

  it("refuses a task with no spec, no requirement, an unknown requirement, or the separator, and a repeated state", async () => {
    await plant();
    await expect(call("plan", { thread: "Divide", add: [{ text: "x", serves: ["R1"] }] })).rejects.toThrow("has no spec yet");
    await specify();
    await expect(call("plan", { thread: "Divide", add: [{ text: "x", serves: ["R7"] }] })).rejects.toThrow("serves R7, which the spec does not hold");
    await expect(call("plan", { thread: "Divide", add: [{ text: "a · b", serves: ["R1"] }] })).rejects.toThrow('holds " · "');
    await expect(call("plan", { thread: "Divide" })).rejects.toThrow("needs add, done, or drop");
    await call("plan", { thread: "Divide", add: [{ text: "x", serves: ["r1"] }] });
    await call("plan", { thread: "Divide", done: [{ id: "t1", trail: "calc@a1b2c3d" }] });
    await expect(call("plan", { thread: "Divide", done: [{ id: "T1", trail: "again" }] })).rejects.toThrow("T1 is done already");
    await expect(call("plan", { thread: "Divide", done: [{ id: "T9", trail: "x" }] })).rejects.toThrow("The plan holds no T9");
  });

  it("takes a task's state from its trail, so a box clicked in Obsidian changes nothing, and says so", async () => {
    await planned();
    await updateDocument(vault, PATH, (d) => (d.body = d.body.replace("- [ ] **T1**", "- [x] **T1**")));
    const status = await call("status", { thread: "Divide" });
    expect(status).toMatchObject({ phase: "planned", tasks: { open: 2 } });
    expect(status.problems).toEqual(['T1\'s box says "x", and its trail says open; the trail counts. Use threads_plan to change a task.']);
  });

  it("refuses to rewrite a plan that holds a line it cannot read, so it never loses the user's text", async () => {
    await planned();
    await updateDocument(vault, PATH, (d) => (d.body = d.body.replace("## Plan\n\n", "## Plan\n\nA note the user typed.\n")));
    await expect(call("plan", { thread: "Divide", done: [{ id: "T1", trail: "x" }] })).rejects.toThrow('## Plan holds a line the tools cannot read: "A note the user typed."');
  });

  it("applies two writes to one thread one after the other, so neither is lost", async () => {
    await planned();
    await Promise.all([call("plan", { thread: "Divide", done: [{ id: "T1", trail: "a" }] }), call("plan", { thread: "Divide", done: [{ id: "T2", trail: "b" }] })]);
    expect(await call("status", { thread: "Divide" })).toMatchObject({ tasks: { done: 2, open: 0 } });
  });
});

describe("threads_round", () => {
  it("refuses a round while a task is open, with a missing or an extra result, or with no evidence", async () => {
    await planned();
    await expect(pass()).rejects.toThrow("T1, T2 are open");
    await call("plan", { thread: "Divide", done: [{ id: "T1", trail: "a" }, { id: "T2", trail: "b" }] });
    await expect(call("round", { thread: "Divide", scope: "s", results: [{ requirement: "R1", result: "pass", evidence: "e" }] })).rejects.toThrow("skip R2");
    await expect(pass({ results: [{ requirement: "R1", result: "pass", evidence: "e" }, { requirement: "R2", result: "pass", evidence: "e" }, { requirement: "R5", result: "pass", evidence: "e" }] })).rejects.toThrow("R5, which the spec does not hold");
    await expect(pass({ results: [{ requirement: "R1", result: "pass", evidence: " " }, { requirement: "R2", result: "pass", evidence: "e" }] })).rejects.toThrow("R1 has no evidence");
    await expect(pass({ scope: "" })).rejects.toThrow("scope is empty");
  });

  it("validates on a pass, and the thread's check is unmet until the close", async () => {
    await executed();
    expect(await pass()).toMatchObject({ phase: "validated", next: { step: "close" }, rounds: 1, last_round: { n: 1, verdict: "pass", current: true } });
    const body = (await doc()).body;
    expect(body).toContain("### Round 1");
    expect(body).toContain("| R2 | pass | TestDivide/zero ok |");
    expect(await check()).toMatchObject({ status: "unmet", detail: "the thread is validated; next: close the thread" });
  });

  it("fails with a blocking finding; a predating finding never blocks; and each finding needs an outcome first", async () => {
    await executed();
    await expect(fail({ findings: [] })).rejects.toThrow("no blocking finding");
    await expect(fail({ findings: [{ text: "x", blocking: true, predates: "calc@a0a0a0a" }] })).rejects.toThrow("F1 predates the thread and blocks it");
    expect(await fail()).toMatchObject({ phase: "failed", next: { step: "resolve" }, last_round: { failing: ["R2"], open_findings: [{ id: "F1", blocking: true }, { id: "F2", blocking: false, predates: "calc@a0a0a0a" }] } });
    await call("plan", { thread: "Divide", add: [{ text: "Return ErrZero", serves: ["R2"] }] });
    await call("plan", { thread: "Divide", done: [{ id: "T3", trail: "calc@c3d4e5f" }] });
    await expect(pass()).rejects.toThrow("F1, F2 of round 1 have no outcome");
    await expect(pass({ resolved: [{ finding: "F1", outcome: "fixed", note: "T3" }, { finding: "F2", outcome: "fixed", note: "T3" }] })).rejects.toThrow("F2 predates the thread");
    expect(await pass({ resolved: [{ finding: "F1", outcome: "fixed", note: "T3" }, { finding: "F2", outcome: "stub", note: "[[Add overflow]]" }] })).toMatchObject({ phase: "validated", rounds: 2 });
    // Rounds are append-only: the outcomes of round 1's findings are part of round 2, in its text and its data.
    const body = (await doc()).body;
    expect(body).toContain("Outcomes of round 1:\n\n- **F1** → fixed: T3\n- **F2** → stub: [[Add overflow]]");
    expect(body).toContain("- **F1** (blocking) Divide returns nil for a zero divisor (calc.go:9).\n- **F2** (predates calc@a0a0a0a)");
    expect(parse(await doc()).rounds[1]!.resolved).toEqual({ F1: { outcome: "fixed", note: "T3" }, F2: { outcome: "stub", note: "[[Add overflow]]" } });
  });

  it("carries a result only when it passed in the last round and its requirement reads as it did", async () => {
    await executed();
    const carried = { requirement: "R1", result: "pass", evidence: "no commit touches it", carried: true };
    await expect(pass({ results: [carried, { requirement: "R2", result: "pass", evidence: "e" }] })).rejects.toThrow("there is no round before");
    await fail();
    await expect(pass({ results: [carried, { requirement: "R2", result: "pass", evidence: "e" }], resolved: [{ finding: "F1", outcome: "declined", note: "n" }, { finding: "F2", outcome: "declined", note: "n" }] })).resolves.toMatchObject({ phase: "validated" });
    expect((await doc()).body).toContain("| R1 | pass | Carried from round 1: no commit touches it |");
  });

  it("refuses a carried result whose requirement changed, or that failed last round", async () => {
    await executed();
    await fail();
    const resolved = [{ finding: "F1", outcome: "declined", note: "n" }, { finding: "F2", outcome: "declined", note: "n" }];
    await expect(pass({ results: [{ requirement: "R1", result: "pass", evidence: "e" }, { requirement: "R2", result: "pass", evidence: "e", carried: true }], resolved })).rejects.toThrow("R2 is carried, and it did not pass in round 1");
    await specify({ requirements: [{ id: "R1", text: "Divide(6, 3) is 2, shown by TestDivideSix." }, { id: "R2", text: "Divide(1, 0) returns ErrZero, shown by TestDivide." }] });
    await expect(pass({ results: [{ requirement: "R1", result: "pass", evidence: "e", carried: true }, { requirement: "R2", result: "pass", evidence: "e" }], resolved })).rejects.toThrow("R1 is carried, and its text changed since round 1");
  });

  it("keeps the round's data whole when the evidence holds -->", async () => {
    await executed();
    await pass({ results: [{ requirement: "R1", result: "pass", evidence: "the graph A --> B holds; <b>ok</b>" }, { requirement: "R2", result: "pass", evidence: "ok" }] });
    const t = parse(await doc());
    expect(t.problems).toEqual([]);
    expect(t.rounds[0]).toMatchObject({ n: 1, verdict: "pass" });
    expect((await doc()).body).not.toMatch(/-->[^\n]*\{/);
  });

  it("stops at the budget: the next step is to ask the user, the round is refused, and the check is for review", async () => {
    await executed();
    const resolveAll = (n: number) => ({ resolved: [{ finding: "F1", outcome: "fixed", note: `T${n}` }, { finding: "F2", outcome: "declined", note: "old" }] });
    await fail();
    await fail(resolveAll(1));
    expect(await fail(resolveAll(2))).toMatchObject({ phase: "failed", next: { step: "ask" } });
    await expect(fail(resolveAll(3))).rejects.toThrow("used its 3 rounds");
    expect(await check()).toMatchObject({ status: "review" });
    // The user gives one more round.
    await specify({ budget: 4, user_asked: "one more round for the zero case" });
    expect(await call("status", { thread: "Divide" })).toMatchObject({ next: { step: "resolve" }, budget: 4 });
  });

  it("after a pass, refuses a change to the plan or the spec unless the user asked, and keeps their words", async () => {
    await executed();
    await pass();
    await expect(call("plan", { thread: "Divide", add: [{ text: "Polish", serves: ["R1"] }] })).rejects.toThrow("passed round 1");
    await expect(specify({ rules: ["Run make test.", "Run go vet."] })).rejects.toThrow("passed round 1");
    expect(await call("plan", { thread: "Divide", add: [{ text: "Polish", serves: ["R1"] }], user_asked: "also polish the docs" })).toMatchObject({ phase: "in progress" });
    expect(sectionText((await doc()).body, "Decisions")).toContain('The user asked (');
    expect(sectionText((await doc()).body, "Decisions")).toContain('"also polish the docs". The plan changed.');
  });
});

describe("threads_close", () => {
  it("closes only a validated thread, after each finding of the passing round goes elsewhere", async () => {
    await executed();
    await expect(call("close", { thread: "Divide", outcome: "closed", summary: "Done." })).rejects.toThrow("is unvalidated, not validated");
    await pass({ findings: [{ text: "The doc comment is thin." }] });
    await expect(call("close", { thread: "Divide", outcome: "closed", summary: "Done." })).rejects.toThrow("F1 of round 1 has no outcome");
    await expect(call("close", { thread: "Divide", outcome: "closed", summary: "Done.", resolved: [{ finding: "F1", outcome: "fixed", note: "x" }] })).rejects.toThrow("would need another round");
    expect(await call("close", { thread: "Divide", outcome: "closed", summary: "calc divides safely.", resolved: [{ finding: "F1", outcome: "declined", note: "fine as it is" }] })).toMatchObject({ phase: "closed", next: { step: "none" } });
    const d = await doc();
    expect(sectionText(d.body, "Outcome")).toMatch(/^Closed \d{4}-\d{2}-\d{2}\. calc divides safely\.\n\n- Validated in round 1: 2 requirements pass\.\n- Plan: 2 tasks done\.\n- F1 of round 1 → declined: fine as it is$/);
    expect(d.properties.phase).toBe("closed");
    expect(await check()).toMatchObject({ status: "met", detail: "the thread is closed" });
    await expect(call("close", { thread: "Divide", outcome: "dropped", summary: "x" })).rejects.toThrow("Divide is closed; it takes no more changes");
    await expect(call("plan", { thread: "Divide", add: [{ text: "More", serves: ["R1"] }], user_asked: "more" })).rejects.toThrow("takes no more changes");
  });

  it("drops a thread with the reason, and deletes only a stub with no spec", async () => {
    await plant();
    await call("stub", { threads: [{ title: "Mistake", idea: "oops", description: "planted by mistake" }] });
    expect(await call("close", { thread: "Mistake", outcome: "dropped", summary: "planted by mistake", delete: true })).toMatchObject({ phase: "dropped" });
    expect(await vault.exists("threads/Mistake.md")).toBe(false);
    await specify();
    await expect(call("close", { thread: "Divide", outcome: "dropped", summary: "x", delete: true })).rejects.toThrow("has a spec");
    expect(await call("close", { thread: "Divide", outcome: "dropped", summary: "the library already divides" })).toMatchObject({ phase: "dropped" });
    expect(sectionText((await doc()).body, "Outcome")).toMatch(/^Dropped \d{4}-\d{2}-\d{2}: the library already divides$/);
    expect(await check()).toMatchObject({ status: "met", detail: "the thread is dropped" });
  });
});

describe("threads_status and the thread check", () => {
  it("lists the open threads, the most urgent first, and leaves out the ended ones", async () => {
    await executed();
    await fail();
    await call("stub", { threads: [{ title: "Later", idea: "x", description: "a later idea", priority: "low" }, { title: "Soon", idea: "y", description: "a pressing idea", priority: "high" }, { title: "Gone", idea: "z", description: "gone" }] });
    await call("close", { thread: "Gone", outcome: "dropped", summary: "no" });
    const { threads: list } = await call("status", {});
    expect(list.map((t: { title: string }) => t.title)).toEqual(["Divide", "Soon", "Later"]);
    expect(list[0]).toMatchObject({ phase: "failed", next: { step: "resolve" } });
  });

  it("derives the phase from the document, so a forged phase property changes nothing", async () => {
    await plant();
    await updateDocument(vault, PATH, (d) => (d.properties.phase = "closed"));
    expect(await check()).toMatchObject({ status: "unmet", detail: "the thread is stub; next: write the spec" });
  });

  it("keeps a section the user added, in its place, when a tool writes the thread", () => {
    const body = "# T\n\n## Deliverables\n- x\n\n## Idea\n\nidea\n\n## My notes\n\nmine\n\n## Goal\n\ng\n";
    const out = assemble(body, { Requirements: "- **R1** a", Goal: "new goal", Rules: "" });
    expect(out).toBe("# T\n\n## Deliverables\n\n- x\n\n## Idea\n\nidea\n\n## Goal\n\nnew goal\n\n## Requirements\n\n- **R1** a\n\n## My notes\n\nmine\n");
  });
});

describe("a thread session in the loop", () => {
  it("ends done when the agent takes the thread from stub to closed with the tools", async () => {
    await plant();
    t.agent.queue(
      async () => {
        await specify();
        await call("plan", { thread: "Divide", add: [{ text: "Write Divide", serves: ["R1", "R2"] }] });
        await call("plan", { thread: "Divide", done: [{ id: "T1", trail: "calc@a1b2c3d" }] });
        await call("round", { thread: "Divide", scope: "heads: calc@a1b2c3d.", results: [{ requirement: "R1", result: "pass", evidence: "ok" }, { requirement: "R2", result: "pass", evidence: "ok" }] });
        await call("close", { thread: "Divide", outcome: "closed", summary: "calc divides safely." });
      },
    );
    const result = await t.yami.session(PATH).start();
    expect(result).toMatchObject({ state: "done", iterations: 1 });
    expect((await doc()).body).toContain("- [x] [[internal/threads/promises/Thread closed|Thread closed]] — the thread is closed");
  });

  it("stops for the user when the thread used its budget, instead of pushing on", async () => {
    await executed();
    await specify({ budget: 1, user_asked: "one round only" });
    t.agent.queue(async () => void (await fail()));
    const result = await t.yami.session(PATH).start();
    expect(result).toMatchObject({ state: "needs-attention", iterations: 1 });
  });
});

async function check() {
  const d = await doc();
  return runCheck({ path: "p", properties: { check: "thread" }, body: "" }, { vault, wiki, path: PATH, properties: d.properties }, threads.checks);
}

describe("what review found: staleness, the budget, and the round data", () => {
  it("makes a passing round stale when the rules or a requirement change at the user's word", async () => {
    await executed();
    await pass();
    expect(await specify({ rules: ["Run make test.", "Run go vet."], user_asked: "also vet it" })).toMatchObject({ phase: "unvalidated", last_round: { current: false } });
    await pass();
    await expect(specify({ requirements: [{ id: "R1", text: "Divide(6, 3) is 2 and Divide(9, 3) is 3." }, { id: "R2", text: "Divide(1, 0) returns ErrZero, shown by TestDivide." }] })).rejects.toThrow("passed round 2");
    expect(
      await specify({ requirements: [{ id: "R1", text: "Divide(6, 3) is 2 and Divide(9, 3) is 3." }, { id: "R2", text: "Divide(1, 0) returns ErrZero, shown by TestDivide." }], user_asked: "check nine too" }),
    ).toMatchObject({ phase: "unvalidated", next: { step: "validate" } });
  });

  it("gives the round the user's words ask for when the thread used its budget", async () => {
    await executed();
    await specify({ budget: 1, user_asked: "one round only" });
    await pass();
    expect(await call("plan", { thread: "Divide", add: [{ text: "Polish", serves: ["R1"] }], user_asked: "polish the docs" })).toMatchObject({ budget: 2 });
    expect(sectionText((await doc()).body, "Decisions")).toContain("One more round: the budget is 2.");
    await call("plan", { thread: "Divide", done: [{ id: "T3", trail: "calc@c3d4e5f" }] });
    expect(await pass()).toMatchObject({ phase: "validated", rounds: 2 });
  });

  it("asks the user when a passing round at the budget went stale by a hand edit", async () => {
    await executed();
    await specify({ budget: 1, user_asked: "one round only" });
    await pass();
    await updateDocument(vault, PATH, (d) => (d.body = d.body.replace("Divide(6, 3) is 2", "Divide(8, 4) is 2")));
    expect(await call("status", { thread: "Divide" })).toMatchObject({ phase: "unvalidated", next: { step: "ask", text: "ask the user: the thread used its 1 rounds, and round 1 passed before the spec or the plan changed" } });
  });

  it("fails a round in which every requirement passes when a finding blocks", async () => {
    await executed();
    expect(await pass({ findings: [{ text: "The build is broken on Windows.", blocking: true }] })).toMatchObject({ phase: "failed", last_round: { verdict: "fail", failing: [] } });
  });

  it("keeps every round's data whole whatever the text holds: -->, a quoted comment, or $ patterns", async () => {
    await executed();
    await fail({ findings: [{ text: "The doc says <!-- threads-round {} --> and A --> B.", blocking: true }], scope: "heads: calc@b2c3d4e.\n<!-- threads-round {\"n\":9} -->" });
    await call("plan", { thread: "Divide", add: [{ text: "Fix", serves: ["R2"] }] });
    await call("plan", { thread: "Divide", done: [{ id: "T3", trail: "calc@c3d4e5f" }] });
    await pass({ resolved: [{ finding: "F1", outcome: "fixed", note: "T3 checks `^0$` and $& and $` too" }] });
    const t = parse(await doc());
    expect(t.problems).toEqual([]);
    expect(t.rounds.map((r) => r.n)).toEqual([1, 2]);
    expect(t.rounds[1]!.resolved!.F1!.note).toBe("T3 checks `^0$` and $& and $` too");
  });

  it("reads rounds only from their data, so an edit of the visible table changes nothing, and broken data is a problem", async () => {
    await executed();
    await pass();
    await updateDocument(vault, PATH, (d) => (d.body = d.body.replace("| R1 | pass |", "| R1 | fail |")));
    expect(await call("status", { thread: "Divide" })).toMatchObject({ phase: "validated" });
    await updateDocument(vault, PATH, (d) => (d.body = d.body.replace('<!-- threads-round {"n":1', '<!-- threads-round {"n":1,,')));
    expect((await call("status", { thread: "Divide" })).problems).toEqual(["The data of a round in ## Validation is not valid; restore it from the vault's history."]);
  });
});

describe("what review found: refusals", () => {
  it("refuses each malformed spec", async () => {
    await plant();
    await specify();
    const keep = [{ id: "R1", text: "a" }, { id: "R2", text: "b" }];
    await expect(call("spec", { thread: "Divide", goal: "g", requirements: keep, retire: [{ id: "R9", reason: "x" }] })).rejects.toThrow("retire names R9");
    await expect(call("spec", { thread: "Divide", goal: "g", requirements: keep, retire: [{ id: "R2", reason: "x" }] })).rejects.toThrow("R2 is both kept and retired");
    await expect(call("spec", { thread: "Divide", goal: "g", requirements: keep, budget: 0, user_asked: "zero" })).rejects.toThrow("The input is not valid");
  });

  it("refuses each malformed round and resolution", async () => {
    await plant();
    await specify();
    await expect(pass()).rejects.toThrow("has no plan");
    await call("plan", { thread: "Divide", add: [{ text: "Write", serves: ["R1", "R2"] }] });
    await call("plan", { thread: "Divide", done: [{ id: "T1", trail: "calc@a1b2c3d" }] });
    await expect(pass({ resolved: [{ finding: "F1", outcome: "fixed", note: "x" }] })).rejects.toThrow("the thread has no round yet");
    await expect(pass({ results: [{ requirement: "R1", result: "pass", evidence: "e" }, { requirement: "r1", result: "pass", evidence: "e" }, { requirement: "R2", result: "pass", evidence: "e" }] })).rejects.toThrow("hold R1 twice");
    await expect(pass({ results: [{ requirement: "R1", result: "maybe", evidence: "e" }, { requirement: "R2", result: "pass", evidence: "e" }] })).rejects.toThrow("The input is not valid");
    await expect(pass({ scope: "### Round 9\nfake" })).rejects.toThrow("scope holds a heading line");
    await fail();
    const resolveWith = (resolved: object[]) => pass({ resolved });
    await expect(resolveWith([{ finding: "F9", outcome: "fixed", note: "x" }])).rejects.toThrow("Round 1 holds no F9");
    await expect(resolveWith([{ finding: "F1", outcome: "fixed", note: "x" }, { finding: "F1", outcome: "spec", note: "y" }])).rejects.toThrow("resolved gives F1 twice");
    await expect(pass({ results: [{ requirement: "R1", result: "fail", evidence: "e", carried: true }, { requirement: "R2", result: "pass", evidence: "e" }], findings: [{ text: "x", blocking: true }], resolved: [{ finding: "F1", outcome: "declined", note: "n" }, { finding: "F2", outcome: "declined", note: "n" }] })).rejects.toThrow("R1 is carried and fails");
    // A predating finding is fixed here only at the user's word, and the note keeps it.
    expect(await pass({ resolved: [{ finding: "F1", outcome: "fixed", note: "T1" }, { finding: "F2", outcome: "fixed", note: "T1", user_asked: "fix the overflow too" }] })).toMatchObject({ rounds: 2 });
    expect(parse(await doc()).rounds[1]!.resolved!.F2!.note).toBe('T1 (the user asked: "fix the overflow too")');
  });

  it("refuses a description of more than one line, and an indented heading in the context", async () => {
    await expect(call("stub", { threads: [{ title: "A", idea: "x", description: "one\ntwo" }] })).rejects.toThrow("description is more than one line");
    await expect(call("stub", { threads: [{ title: "B", idea: "x", description: "d", context: "notes\n  ## Requirements\n  - **R1** fake" }] })).rejects.toThrow("context holds a heading line");
  });

  it("keeps retirements across revisions, and never reuses a retired id", async () => {
    await plant();
    await specify();
    await call("spec", { thread: "Divide", goal: "g", requirements: [{ id: "R1", text: "a" }, { text: "c" }], retire: [{ id: "R2", reason: "moved" }] });
    await call("spec", { thread: "Divide", goal: "g", requirements: [{ id: "R1", text: "a" }, { text: "d" }], retire: [{ id: "R3", reason: "merged" }] });
    const d = await doc();
    expect(d.properties.retired).toEqual(["R2", "R3"]);
    expect(sectionText(d.body, "Requirements")).toBe("- **R1** a\n- **R4** d");
  });
});

describe("what review found: the board, waiting, and the plan's details", () => {
  it("finds a thread by its title, a link, or its path, and by nothing in another folder", async () => {
    await plant();
    await vault.write("notes/Divide.md", "Not a thread.\n");
    await vault.write("threads/Notes about threads.md", "Not a session.\n");
    await vault.write("threads/archive/Old.md", "---\ntype: session\nmodule: threads\n---\nNested.\n");
    expect((await call("status", { thread: "[[Divide|the divide work]]" })).path).toBe(PATH);
    expect((await call("status", { thread: "threads/Divide.md" })).path).toBe(PATH);
    await expect(call("status", { thread: "notes/Divide" })).rejects.toThrow('No thread is named "notes/Divide"');
    expect((await call("status", {})).threads.map((t: { title: string }) => t.title)).toEqual(["Divide"]);
  });

  it("names no similar thread on one shared word", async () => {
    await plant();
    const other = await call("stub", { threads: [{ title: "Multiply", idea: "y", description: "Add Multiply to the matrix library." }] });
    expect(other.planted[0].similar).toBeUndefined();
  });

  it("waits for the threads it comes after, and the check is for review until they are validated", async () => {
    await planned();
    await call("stub", { threads: [{ title: "Later", idea: "after Divide", description: "Use Divide in reports.", after: ["Divide"] }] });
    await call("spec", { thread: "Later", goal: "g", requirements: [{ text: "Reports divide." }] });
    expect(await call("plan", { thread: "Later", add: [{ text: "Report", serves: ["R1"] }] })).toMatchObject({ phase: "planned", next: { step: "wait", text: "wait for Divide to be validated" } });
    const later = await readDocument(vault, "threads/Later.md");
    const check = () => runCheck({ path: "p", properties: { check: "thread" }, body: "" }, { vault, wiki, path: "threads/Later.md", properties: later.properties }, threads.checks);
    expect(await check()).toMatchObject({ status: "review", detail: "the thread waits for Divide" });
    await call("plan", { thread: "Divide", done: [{ id: "T1", trail: "a" }, { id: "T2", trail: "b" }] });
    await pass();
    expect(await call("status", { thread: "Later" })).toMatchObject({ next: { step: "execute" } });
  });

  it("keeps a task's details as written, with a tab indent and a blank line, across a write", async () => {
    await planned();
    await updateDocument(vault, PATH, (d) => (d.body = d.body.replace("  In calc.go.", "\tIn calc.go.\n\n\t- check zero\n\t  first")));
    await call("plan", { thread: "Divide", done: [{ id: "T2", trail: "x" }] });
    expect(sectionText((await doc()).body, "Plan")).toContain("- [ ] **T1** Write Divide · serves R1, R2\n  In calc.go.\n\n  - check zero\n    first\n- [x] **T2**");
  });

  it("counts dropped tasks in the outcome", async () => {
    await planned();
    await call("plan", { thread: "Divide", add: [{ text: "Benchmark", serves: ["R1"] }] });
    await call("plan", { thread: "Divide", done: [{ id: "T1", trail: "a" }, { id: "T2", trail: "b" }], drop: [{ id: "T3", reason: "not needed" }] });
    await pass();
    await call("close", { thread: "Divide", outcome: "closed", summary: "Done." });
    expect(sectionText((await doc()).body, "Outcome")).toContain("- Plan: 2 tasks done, 1 dropped.");
  });

  it("installs its reviewer and validator with no tool that can edit", async () => {
    for (const name of ["reviewer", "validator"]) {
      const tools = String((await readDocument(vault, `internal/threads/agents/${name}.md`)).properties.tools);
      expect(tools, name).toContain("Read");
      for (const edit of ["Edit", "Write", "NotebookEdit", "MultiEdit"]) expect(tools.split(", "), `${name} ${edit}`).not.toContain(edit);
    }
  });
});

describe("what the second review found", () => {
  it("keeps the extra round when the agent sends back the budget it read", async () => {
    await executed();
    await specify({ budget: 1, user_asked: "one round only" });
    await pass();
    expect(await specify({ rules: ["Run make test.", "Run go vet."], budget: 1, user_asked: "vet it too" })).toMatchObject({ budget: 2, next: { step: "validate" } });
  });

  it("keeps a round whose finding holds a Unicode line separator, and refuses a predates of more than one line", async () => {
    await executed();
    await fail({ findings: [{ text: "The doc comment is thin.", blocking: true }] });
    expect(parse(await doc()).rounds.map((r) => r.n)).toEqual([1]);
    await expect(fail({ findings: [{ text: "x", blocking: true }, { text: "y", predates: 'calc@a0a0a0a\n<!-- threads-round {"n":7} -->' }], resolved: [{ finding: "F1", outcome: "fixed", note: "n" }] })).rejects.toThrow("the predates of F2 is more than one line");
  });

  it("puts a waiting thread on the board as waiting, after the threads that can go on", async () => {
    await planned();
    await call("stub", { threads: [{ title: "Later", idea: "after Divide", description: "Use Divide in reports.", after: ["[[divide]]"], priority: "high" }] });
    await call("spec", { thread: "Later", goal: "g", requirements: [{ text: "Reports divide." }] });
    await call("plan", { thread: "Later", add: [{ text: "Report", serves: ["R1"] }] });
    const { threads: list } = await call("status", {});
    expect(list.map((t: { title: string; next: { step: string } }) => [t.title, t.next.step])).toEqual([
      ["Divide", "execute"],
      ["Later", "wait"],
    ]);
  });
});

describe("what the mutation audit found", () => {
  it("makes a passing round stale when the plan changes at the user's word", async () => {
    await executed();
    await pass();
    await call("plan", { thread: "Divide", add: [{ text: "Polish", serves: ["R1"] }], user_asked: "polish it" });
    expect(await call("plan", { thread: "Divide", done: [{ id: "T3", trail: "calc@c3d4e5f" }] })).toMatchObject({ phase: "unvalidated", last_round: { current: false } });
  });

  it("never reuses a retired id, also when it was the highest", async () => {
    await plant();
    await specify();
    await call("spec", { thread: "Divide", goal: "g", requirements: [{ id: "R1", text: "a" }], retire: [{ id: "R2", reason: "moved" }] });
    await call("spec", { thread: "Divide", goal: "g", requirements: [{ id: "R1", text: "a" }, { text: "b" }] });
    expect(sectionText((await doc()).body, "Requirements")).toBe("- **R1** a\n- **R3** b");
  });

  it("writes a data line with no --> before its end, and keeps a | of the evidence in its cell", async () => {
    await executed();
    await pass({ findings: [{ text: "A --> B." }], results: [{ requirement: "R1", result: "pass", evidence: "a | b" }, { requirement: "R2", result: "pass", evidence: "ok" }] });
    const body = (await doc()).body;
    const data = body.split("\n").find((line) => line.startsWith("<!-- threads-round "))!;
    expect(data.slice(0, -3)).not.toContain("-->");
    expect(body).toContain("| R1 | pass | a \\| b |");
  });

  it("takes a budget property of 0 as the default, and lists no open finding on a closed thread", async () => {
    await executed();
    await updateDocument(vault, PATH, (d) => (d.properties.budget = 0));
    expect(await call("status", { thread: "Divide" })).toMatchObject({ budget: 3, next: { step: "validate" } });
    await pass({ findings: [{ text: "A note." }] });
    await call("close", { thread: "Divide", outcome: "closed", summary: "Done.", resolved: [{ finding: "F1", outcome: "declined", note: "fine" }] });
    expect((await call("status", { thread: "Divide" })).last_round.open_findings).toEqual([]);
  });

  it("does not read an inline quote of round data, typed by hand, as a round", async () => {
    await executed();
    await pass();
    await updateDocument(vault, PATH, (d) => (d.body = d.body.replace("Scope: ", 'Scope: see <!-- threads-round {"n":9} --> and ')));
    expect(parse(await doc()).rounds.map((r) => r.n)).toEqual([1]);
  });

  it("waits in progress too, for an after typed by hand as [[Title]]", async () => {
    await planned();
    await call("stub", { threads: [{ title: "Later", idea: "after Divide", description: "Use Divide in reports." }] });
    await updateDocument(vault, "threads/Later.md", (d) => (d.properties.after = ["[[Divide]]"]));
    await call("spec", { thread: "Later", goal: "g", requirements: [{ text: "a" }, { text: "b" }] });
    await call("plan", { thread: "Later", add: [{ text: "One", serves: ["R1"] }, { text: "Two", serves: ["R2"] }] });
    expect(await call("plan", { thread: "Later", done: [{ id: "T1", trail: "x" }] })).toMatchObject({ phase: "in progress", next: { step: "wait" } });
    const later = await readDocument(vault, "threads/Later.md");
    expect(await runCheck({ path: "p", properties: { check: "thread" }, body: "" }, { vault, wiki, path: "threads/Later.md", properties: later.properties }, threads.checks)).toMatchObject({ status: "review" });
  });
});
