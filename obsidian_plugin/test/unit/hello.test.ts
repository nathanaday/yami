import { cp } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VaultModule } from "yami";
import { readDocument, sectionText, updateDocument } from "yami/document";
import { review, testYami, type TestYami } from "yami/testing";
import { Librarian } from "../../src/modules/librarian/index.js";

const FIXTURE = "test/fixtures/vault-modules/hello";
const TEMPLATE = "internal/hello/templates/Greeting.md";

let t: TestYami;
let changes: number;

beforeEach(async () => {
  t = await testYami({ modules: [new Librarian()] });
  changes = 0;
  t.yami.onModulesChange(() => changes++);
  // library-loop: F1.4
  await cp(FIXTURE, path.join(t.root, "internal/hello"), { recursive: true });
  await t.yami.discover();
});
afterEach(() => t.dispose());

const hello = () => t.yami.module("hello");

describe("Hello as a vault module", () => {
  it("is found, and a Greeting session runs through the review to done", async () => {
    const module = hello();
    expect(module).toBeInstanceOf(VaultModule);
    expect(module).toMatchObject({ name: "Hello world", icon: "hand", description: "Says hello, and writes the greeting to a note in the vault." });
    expect(module!.templates.map((template) => [template.id, template.label])).toEqual([["greeting", "New greeting"]]);
    expect(t.yami.problems).toEqual([]);
    expect(changes).toBe(1);

    const session = await module!.templates[0]!.create({ name: "Ada" });
    expect((await readDocument(t.vault, session.path)).properties).toMatchObject({ greeting: "Hello", template: "greeting" });
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
      met: ["[[internal/hello/promises/Greeting note|Greeting note]]"],
      followed: ["[[internal/hello/policies/Always say hello|Always say hello]]"],
      broken: [],
    });
    expect(sectionText(doc.body, "Review")).toContain("followed: [[internal/hello/policies/Always say hello|Always say hello]]");
    const details = await session.details();
    expect(details.documents.find((d) => d.kind === "policies")).toMatchObject({ name: "Always say hello", followed: true });
    expect(details.documents.find((d) => d.kind === "promises")).toMatchObject({ name: "Greeting note", met: true });
  });

  it("sends a broken policy back to the worker, and ends done after the fix", async () => {
    const session = await hello()!.templates[0]!.create({ name: "Bo" });
    t.agent.queue(
      () => t.vault.write("greetings/Bo.md", "Hi, Bo\n"),
      review({ "Always say hello": ["broken", "It began with Hi."] }),
      (prompt) => {
        expect(prompt).toContain("It began with Hi.");
        return t.vault.write("greetings/Bo.md", "Hello, Bo\n");
      },
      review(),
    );
    expect(await session.start()).toMatchObject({ state: "done", iterations: 2 });
  });

  it("reports a broken template, keeps the other modules working, and takes the template back once it is fixed", async () => {
    await updateDocument(t.vault, TEMPLATE, (d) => (d.properties.access = "readonly"));
    await t.yami.discover();
    expect(t.yami.problems).toEqual([{ module: "hello", path: TEMPLATE, message: expect.stringContaining("access") }]);
    expect(hello()?.templates ?? []).toEqual([]);
    expect(changes).toBe(2);
    expect(t.yami.modules.map((m) => m.id)).toEqual(["wiki", "librarian", "hello"]);

    // Another vault module still runs to done.
    const starter = await t.yami.createModule("Chores");
    const chore = await starter.templates[0]!.create({ name: "Sweep" });
    t.agent.queue(() => t.vault.write("chores/Sweep/Result.md", "Swept.\n"), review());
    expect(await chore.start()).toMatchObject({ state: "done" });
    expect(t.yami.problems).toHaveLength(1);

    await updateDocument(t.vault, TEMPLATE, (d) => (d.properties.access = "edit"));
    await t.yami.discover();
    expect(t.yami.problems).toEqual([]);
    expect(hello()!.templates.map((template) => template.id)).toEqual(["greeting"]);
  });
});
