import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VaultModule } from "yami";
import { readDocument, sectionText, updateDocument } from "yami/document";
import { review, testYami, type TestYami } from "yami/testing";
import { Librarian } from "../../src/modules/librarian/index.js";

const FIXTURE = "test/fixtures/vault-modules/hello";
const FLOW = "internal/hello/flows/greeting/FLOW.md";

let t: TestYami;
let changes: number;

beforeEach(async () => {
  t = await testYami({ modules: [new Librarian()], files: { "internal/hello": FIXTURE } });
  changes = 0;
  t.yami.onModulesChange(() => changes++);
});
afterEach(() => t.dispose());

const hello = () => t.yami.module("hello");

describe("Hello as a vault module", () => {
  it("is found, and a Greeting session runs through the review to done", async () => {
    const module = hello();
    expect(module).toBeInstanceOf(VaultModule);
    expect(module).toMatchObject({ name: "Hello world", icon: "hand", description: "Says hello, and writes the greeting to a note in the vault." });
    expect(module!.flows.map((flow) => [flow.name, flow.label])).toEqual([["greeting", "New greeting"]]);
    expect(module!.flowOf("greeting")!.agents.map((agent) => agent.name)).toEqual(["proofreader"]);
    expect(t.yami.problems).toEqual([]);

    const session = await module!.flowOf("greeting")!.create({ name: "Ada", request: "Greet Ada." });
    expect((await readDocument(t.vault, session.path)).properties).toMatchObject({ greeting: "Hello", flow: "greeting" });
    expect(sectionText((await readDocument(t.vault, session.path)).body, "Request")).toBe("Greet Ada.");
    t.agent.queue(async (prompt) => {
      expect(prompt).toMatch(/^\/yami:run This is the Yami session "Ada"/);
      expect(prompt).toContain("`hello:greeting`");
      expect(prompt).toContain("Begin every reply with the session's greeting");
      await t.vault.write("greetings/Ada.md", "Hello, Ada\n");
    }, review());

    expect(await session.start()).toMatchObject({ state: "done", iterations: 1, review: "conversations/hello Ada review.md" });
    const doc = await readDocument(t.vault, session.path);
    expect(doc.properties).toMatchObject({
      state: "done",
      met: ["[[internal/hello/promises/greeting-note/PROMISE|greeting-note]]"],
      followed: ["[[internal/hello/policies/always-say-hello/POLICY|always-say-hello]]"],
      broken: [],
    });
    expect(sectionText(doc.body, "Review")).toContain("followed: [[internal/hello/policies/always-say-hello/POLICY|always-say-hello]]");
    expect(t.agent.started[1]!.prompts[0]).toContain("- [x] [[internal/hello/promises/greeting-note/PROMISE|greeting-note]] — found greetings/Ada.md");
    const details = await session.details();
    expect(details.documents.find((d) => d.kind === "policies")).toMatchObject({ name: "always-say-hello", followed: true, reason: expect.any(String) });
    expect(details.documents.find((d) => d.kind === "promises")).toMatchObject({ name: "greeting-note", met: true, judged: false, reason: "found greetings/Ada.md" });
  });

  it("sends a broken policy back to the worker, and ends done after the fix", async () => {
    const session = await hello()!.flowOf("greeting")!.create({ name: "Bo" });
    t.agent.queue(
      () => t.vault.write("greetings/Bo.md", "Hi, Bo\n"),
      review({ "always-say-hello": ["broken", "It began with Hi."] }),
      (prompt) => {
        expect(prompt).toContain("It began with Hi.");
        return t.vault.write("greetings/Bo.md", "Hello, Bo\n");
      },
      review(),
    );
    expect(await session.start()).toMatchObject({ state: "done", iterations: 2 });
  });

  it("reports a broken flow, keeps the other modules working, and takes the flow back once it is fixed", async () => {
    await updateDocument(t.vault, FLOW, (d) => (d.properties.access = "readonly"));
    await t.yami.discover();
    expect(t.yami.problems).toEqual([{ module: "hello", path: FLOW, document: FLOW, message: expect.stringContaining("access") }]);
    expect(hello()?.flows ?? []).toEqual([]);
    expect(changes).toBe(1);
    expect(t.yami.modules.map((m) => m.id)).toEqual(["wiki", "librarian", "hello"]);

    // Another vault module still runs to done.
    const starter = await t.yami.createModule("Chores");
    const chore = await starter.flows[0]!.create({ name: "Sweep" });
    t.agent.queue(() => t.vault.write("chores/Sweep/Result.md", "Swept.\n"), review());
    expect(await chore.start()).toMatchObject({ state: "done" });
    expect(t.yami.problems).toHaveLength(1);

    await updateDocument(t.vault, FLOW, (d) => (d.properties.access = "edit"));
    await t.yami.discover();
    expect(t.yami.problems).toEqual([]);
    expect(hello()!.flows.map((flow) => flow.name)).toEqual(["greeting"]);
  });
});
