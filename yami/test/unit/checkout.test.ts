import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runTool } from "../../src/agent/index.js";
import { readDocument, sectionText, updateDocument } from "../../src/document/index.js";
import type { CheckoutOrder, WikiModule } from "../../src/index.js";
import { testYami, type FsVault, type TestYami } from "../../src/testing/index.js";
import type { Wiki } from "../../src/wiki/index.js";

let t: TestYami;
let vault: FsVault;
let wiki: Wiki;
let module: WikiModule;
const checkout = (order: CheckoutOrder) => module.makeCheckout(order);
const returnCheckout = (session: string) => module.returnCheckout(session);
const checkoutTool = () => t.yami.tools()!.tools.find((tool) => tool.name === "wiki_checkout")!;

const note = (path: string, properties: Record<string, unknown>, body: string) => vault.write(path, `---\n${vault.stringifyProperties(properties)}---\n${body}`);

beforeEach(async () => {
  // A fixed day, so a run that crosses midnight names the same reading list as the test does.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 6, 12));
  t = await testYami();
  module = t.yami.module("wiki") as WikiModule;
  ({ vault } = t);
  wiki = t.yami.wiki;
  await note("wiki/topics/Reinforcement learning.md", { type: "topic", description: "Learning by reward." }, "An agent learns from reward. See [[Q-learning]] and [[SSL]].\n");
  await note("wiki/topics/Q-learning.md", { type: "topic", description: "A value method." }, "Q-learning learns action values.\n");
  await note("wiki/topics/Self-supervised learning.md", { type: "topic", description: "Labels from data.", aliases: ["SSL"] }, "No labels.\n");
  await note("notes/Mine.md", {}, "My own note.\n");
});
afterEach(async () => {
  vi.useRealTimers();
  await t.dispose();
});

const order = {
  request: "the material on reinforcement learning",
  name: "Reinforcement learning",
  documents: [
    { path: "Reinforcement learning", why: "the overview" },
    { path: "wiki/topics/Q-learning.md", why: "the first method" },
  ],
  notes: "Left out deep RL: the wiki has no topic yet.",
};
const DATE = "2026-10-06";
const SESSIONS = "internal/wiki/sessions";
const FOLDER = `${SESSIONS}/${DATE} Reinforcement learning`;
const SESSION = `${FOLDER}.md`;
const COPY = `${FOLDER}/Reinforcement learning (checkout).md`;

describe("checkout", () => {
  it("writes the reading list in order with a reason each, and a copy of each document that keeps its links", async () => {
    const made = await checkout(order);
    expect(made).toEqual({ session: SESSION, copies: [COPY, `${FOLDER}/Q-learning (checkout).md`] });
    const session = await readDocument(vault, SESSION);
    expect(session.properties).toMatchObject({ type: "session", module: "wiki", flow: "checkout", status: "out", state: "done" });
    expect(sectionText(session.body, "Request")).toBe("the material on reinforcement learning");
    expect(sectionText(session.body, "Reading list")).toBe(
      `1. [[${FOLDER}/Reinforcement learning (checkout)|Reinforcement learning (checkout)]] · the overview\n2. [[${FOLDER}/Q-learning (checkout)|Q-learning (checkout)]] · the first method`,
    );
    expect(sectionText(session.body, "Notes")).toBe("Left out deep RL: the wiki has no topic yet.");
    const copy = await readDocument(vault, COPY);
    expect(copy.properties).toMatchObject({ copy_of: "[[wiki/topics/Reinforcement learning|Reinforcement learning]]", checkout: `[[${FOLDER}|${DATE} Reinforcement learning]]` });
    expect(copy.properties.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(copy.body).toBe("An agent learns from reward. See [[Q-learning]] and [[SSL]].\n");
  });

  it("keeps copies out of the wiki's index, so search finds each subject once", async () => {
    await checkout(order);
    await wiki.refresh();
    expect((await wiki.search("reward")).map((h) => h.path)).toEqual(["wiki/topics/Reinforcement learning.md"]);
    expect(await wiki.lint()).not.toContainEqual(expect.objectContaining({ check: "duplicate-name" }));
  });

  it("refuses a note that is not knowledge, a document twice, a why of more than one line, no request, and a name taken", async () => {
    await expect(checkout({ ...order, documents: [{ path: "notes/Mine.md", why: "x" }] })).rejects.toThrow("only knowledge is checked out");
    await expect(checkout({ ...order, documents: [{ path: "Q-learning", why: "x" }, { path: "wiki/topics/Q-learning.md", why: "y" }] })).rejects.toThrow("twice");
    await expect(checkout({ ...order, documents: [{ path: "Q-learning", why: "a\nb" }] })).rejects.toThrow("a why of one line");
    await expect(checkout({ ...order, request: " " })).rejects.toThrow("request is empty");
    await expect(checkout({ ...order, documents: [] })).rejects.toThrow("one document or more");
    // A second checkout of the same name on the same day gets its own reading list, and links by name still find the topic.
    await checkout(order);
    expect((await checkout(order)).session).toBe(`${FOLDER} (2).md`);
    await wiki.refresh();
    expect(wiki.resolve("Reinforcement learning")).toBe("wiki/topics/Reinforcement learning.md");
  });

  it("is a tool of the wiki module, which a plain conversation can call", async () => {
    const tool = checkoutTool();
    const result = await runTool(tool, order, new AbortController().signal);
    expect(JSON.parse(result.text).session).toBe(SESSION);
  });
});

describe("returnCheckout", () => {
  it("removes copies with no edit, and makes no change, even when they hold links by alias or in another case", async () => {
    await note("wiki/topics/Q-learning.md", { type: "topic", description: "A value method." }, "Q-learning learns action values; see [[reinforcement learning]] and [[SSL]].\n");
    await checkout(order);
    const result = await returnCheckout(SESSION);
    expect(result).toEqual({ returned: [], skipped: [], summary: "- No copy held an edit." });
    expect(await vault.list(FOLDER)).toEqual([]);
    expect(await wiki.versions()).toEqual([]);
    const session = await readDocument(vault, SESSION);
    expect(session.properties.status).toBe("returned");
    expect(sectionText(session.body, "Return")).toBe("- No copy held an edit.");
  });

  it("returns the user's edits as one change, pointing a link to another copy back at its original", async () => {
    await checkout(order);
    await updateDocument(vault, COPY, (d) => (d.body = `An agent learns from reward, with a policy. See [[${FOLDER}/Q-learning (checkout)|Q-learning]] and [[SSL]].\n`));
    const result = await returnCheckout(SESSION);
    expect(result.returned).toEqual(["wiki/topics/Reinforcement learning.md"]);
    expect(result.change).toMatch(new RegExp(`^internal/wiki/changes/.* Return ${DATE} Reinforcement learning\\.md$`));
    expect((await readDocument(vault, "wiki/topics/Reinforcement learning.md")).body).toBe("An agent learns from reward, with a policy. See [[wiki/topics/Q-learning|Q-learning]] and [[SSL]].\n");
    expect((await readDocument(vault, SESSION)).properties.changes).toEqual([`[[${result.change!.slice(0, -3)}|${result.change!.slice(result.change!.lastIndexOf("/") + 1, -3)}]]`]);
    expect(await vault.list(FOLDER)).toEqual([]);
    await expect(returnCheckout(SESSION)).rejects.toThrow("returned already");
  });

  it("keeps a copy whose original changed since the checkout, and returns the others", async () => {
    await checkout(order);
    await updateDocument(vault, COPY, (d) => (d.body = "My edit.\n"));
    await updateDocument(vault, `${FOLDER}/Q-learning (checkout).md`, (d) => (d.body = "Q-learning, edited by me.\n"));
    await note("wiki/topics/Reinforcement learning.md", { type: "topic", description: "Learning by reward." }, "Changed in the wiki meanwhile.\n");
    const result = await returnCheckout(SESSION);
    expect(result.skipped).toEqual([{ copy: COPY, reason: "its original changed since the checkout" }]);
    expect(result.returned).toEqual(["wiki/topics/Q-learning.md"]);
    expect(await vault.list(FOLDER)).toEqual([COPY]);
    expect((await readDocument(vault, "wiki/topics/Reinforcement learning.md")).body).toBe("Changed in the wiki meanwhile.\n");
    expect(sectionText((await readDocument(vault, SESSION)).body, "Return")).toContain(`- Kept [[${FOLDER}/Reinforcement learning (checkout)|Reinforcement learning (checkout)]]: its original changed since the checkout. Its edits stay in the copy.`);
  });
});

describe("what review found", () => {
  it("refuses more than the most documents, and an empty why", async () => {
    const many = Array.from({ length: 61 }, () => ({ path: "Q-learning", why: "x" }));
    await expect(checkout({ ...order, documents: many })).rejects.toThrow("at most 60 documents");
    await expect(checkout({ ...order, documents: [{ path: "Q-learning", why: " " }] })).rejects.toThrow("a why of one line");
  });

  it("keeps two originals of one name apart, and returns two edits as one change", async () => {
    await note("wiki/sources/Q-learning.md", { type: "source", description: "The Q-learning paper.", file: "[[x.pdf]]" }, "The paper.\n");
    const made = await checkout({ ...order, documents: [{ path: "wiki/topics/Q-learning.md", why: "a" }, { path: "wiki/sources/Q-learning.md", why: "b" }] });
    expect(made.copies).toEqual([`${FOLDER}/Q-learning (checkout).md`, `${FOLDER}/Q-learning (checkout) 2.md`]);
    for (const copy of made.copies) await updateDocument(vault, copy, (d) => (d.body = `${d.body.trim()} Edited.\n`));
    const result = await returnCheckout(SESSION);
    expect(result.returned.sort()).toEqual(["wiki/sources/Q-learning.md", "wiki/topics/Q-learning.md"]);
    expect((await readDocument(vault, result.change!)).properties.modifies).toBe(2);
  });

  it("keeps a copy whose original is gone, leaves a note of the user's own alone, and takes trailing newlines as no edit", async () => {
    await checkout(order);
    await updateDocument(vault, COPY, (d) => (d.body = "Edited.\n"));
    await vault.remove("wiki/topics/Reinforcement learning.md");
    await updateDocument(vault, `${FOLDER}/Q-learning (checkout).md`, (d) => (d.body = `${d.body}\n\n\n`));
    await vault.write(`${FOLDER}/My notes.md`, "Mine.\n");
    const result = await returnCheckout(SESSION);
    expect(result).toMatchObject({ returned: [], skipped: [{ copy: COPY, reason: "its original is gone" }] });
    expect((await vault.list(FOLDER)).sort()).toEqual([`${FOLDER}/My notes.md`, COPY].sort());
  });

  it("returns the edits the wiki takes, and keeps a copy whose edit it refuses, with the reason", async () => {
    await note("wiki/sources/Draft.md", { type: "source", description: "", file: "[[d.pdf]]", status: "pending" }, "Draft.\n");
    const made = await checkout({ ...order, documents: [{ path: "Q-learning", why: "a" }, { path: "wiki/sources/Draft.md", why: "b" }] });
    for (const copy of made.copies) await updateDocument(vault, copy, (d) => (d.body = "Edited.\n"));
    const result = await returnCheckout(SESSION);
    expect(result.returned).toEqual(["wiki/topics/Q-learning.md"]);
    expect(result.skipped).toEqual([{ copy: `${FOLDER}/Draft (checkout).md`, reason: "the wiki refused the edit: description is empty" }]);
  });

  it("points a link to a copy with no alias back at the original, with its name as the alias", async () => {
    await checkout(order);
    await updateDocument(vault, COPY, (d) => (d.body = `See [[${FOLDER}/Q-learning (checkout)]] and ![[${FOLDER}/Q-learning (checkout)#Top]].\n`));
    await returnCheckout(SESSION);
    expect((await readDocument(vault, "wiki/topics/Reinforcement learning.md")).body).toBe("See [[wiki/topics/Q-learning|Q-learning]] and ![[wiki/topics/Q-learning#Top]].\n");
  });
});

describe("the checkout tool", () => {
  it("refuses more than 60 documents before it writes anything", async () => {
    const tool = checkoutTool();
    const many = Array.from({ length: 61 }, () => ({ path: "Q-learning", why: "x" }));
    const result = await runTool(tool, { ...order, documents: many }, new AbortController().signal);
    expect(result).toMatchObject({ isError: true });
    expect(result.text).toContain("The input is not valid");
    expect(await vault.list(SESSIONS)).toEqual([]);
  });
});

describe("a checkout as a session", () => {
  it("makes the reading list in the session a run is on, and the run ends done", async () => {
    const session = await module.checkout.create({ name: "RL", request: "Reinforcement learning, from the basics." });
    expect(await vault.read(session.path)).toContain("## Request\nReinforcement learning, from the basics.\n\n## Deliverables\n- [ ] [[internal/wiki/promises/reading-list-made/PROMISE|reading-list-made]]");
    t.agent.queue(async (prompt) => {
      expect(prompt).toMatch(/^\/yami:run This is the Yami session "RL"/);
      expect(prompt).toContain("`wiki:checkout`");
      const result = await runTool(checkoutTool(), { ...order, name: undefined, session: session.path }, new AbortController().signal);
      if (result.isError) throw new Error(result.text);
    });
    expect(await session.start()).toMatchObject({ state: "done", iterations: 1 });
    const doc = await readDocument(vault, session.path);
    expect(doc.properties).toMatchObject({ status: "out", state: "done", flow: "checkout" });
    // The person's words in the Request section stay; the tool's request does not replace them.
    expect(sectionText(doc.body, "Request")).toBe("Reinforcement learning, from the basics.");
    expect(sectionText(doc.body, "Reading list")).toContain(`1. [[${SESSIONS}/RL/Reinforcement learning (checkout)|Reinforcement learning (checkout)]] · the overview`);
    expect(await vault.exists(`${SESSIONS}/RL/Q-learning (checkout).md`)).toBe(true);
  });

  it("refuses a second checkout into one session, and a session of another module", async () => {
    const session = await module.checkout.create({ name: "RL" });
    await checkout({ ...order, session: session.path });
    // The person left the Request section empty, so the checkout's request fills it.
    expect(sectionText((await readDocument(vault, session.path)).body, "Request")).toBe(order.request);
    await expect(checkout({ ...order, session: session.path })).rejects.toThrow("RL holds a checkout already.");
    await vault.write("notes/Fake.md", "---\ntype: session\nmodule: threads\n---\n");
    await expect(checkout({ ...order, session: "notes/Fake.md" })).rejects.toThrow("is not a checkout session of the wiki module");
    await expect(checkout({ ...order, name: undefined })).rejects.toThrow("Give the session of the checkout, or a name for a new one.");
  });

  it("refuses a request or notes with a line that would start a section, and writes nothing", async () => {
    const session = await module.checkout.create({ name: "Empty" });
    const before = await vault.read(session.path);
    const sneaky = "Read on RL.\n## Deliverables\nsneaky";
    await expect(checkout({ ...order, session: session.path, request: sneaky })).rejects.toThrow('The text for the Request section holds the heading line "## Deliverables"');
    await expect(checkout({ ...order, session: session.path, notes: sneaky })).rejects.toThrow('The text for the Notes section holds the heading line "## Deliverables"');
    expect(await vault.read(session.path)).toBe(before);
    expect(await vault.list(session.path.slice(0, -3))).toEqual([]);
    await expect(module.checkout.create({ name: "New", request: sneaky })).rejects.toThrow('The text for the Request section holds the heading line "## Deliverables"');
    expect(await vault.exists(`${SESSIONS}/New.md`)).toBe(false);
  });

  it("offers the return only for a checkout that is out, and says what it did in plain words", async () => {
    const { session } = await checkout(order);
    const action = module.returnAction;
    expect(action.on).toBe(module.checkout);
    expect(action.when!({ status: "out" })).toBe(true);
    expect(action.when!({ status: "returned" })).toBe(false);
    expect(await action.run(t.yami.session(session))).toBe("No copy held an edit.");
    await expect(returnCheckout(session)).rejects.toThrow("it was returned already");
    const empty = await module.checkout.create({ name: "Empty" });
    await expect(returnCheckout(empty.path)).rejects.toThrow("it holds no checkout");
  });
});
