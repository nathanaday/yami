import { afterEach, describe, expect, it } from "vitest";
import { readDocument, updateDocument } from "../../src/document/index.js";
import { Yami, YamiModule, type Check, type FormKind, type Properties, type Schema } from "../../src/index.js";
import { review, testYami, FsVault, type TestYami, type Turn } from "../../src/testing/index.js";
import { ThreadsModule } from "../../src/threads/index.js";
import { Hello } from "../fixtures/hello.js";

let t: TestYami | undefined;
afterEach(async () => {
  await t?.dispose();
  t = undefined;
});

const moodSet: Check = async (_promise, context) => (context.properties.mood ? { status: "met", detail: "the mood is set" } : { status: "unmet", detail: "no mood yet" });

/** A code module that takes vault flows: one code flow, one skill, one promise with a check of its own. */
class Journal extends YamiModule {
  readonly id = "journal";
  readonly name = "Journal";
  readonly vaultFlows = true;
  readonly schema: Schema = { mood: { type: "text", values: ["", "good", "bad"] } };
  readonly checks = { "mood-set": moodSet };
  readonly journal = this.skill({ name: "journal", description: "How to write a journal entry.", body: "Write one paragraph." });
  readonly recorded = this.promise({ name: "mood-recorded", description: "The mood is set.", check: "mood-set", body: "Set the mood." });
  readonly entry = this.flow({ name: "entry", description: "One entry.", skills: [this.journal], promises: [this.recorded] });
}

/** A code module that takes vault flows and has no skill of its own. */
class Plain extends YamiModule {
  readonly id = "plain";
  readonly name = "Plain";
  readonly vaultFlows = true;
}

async function write(path: string, properties: Properties, body = "") {
  await t!.vault.write(path, `---\n${t!.vault.stringifyProperties(properties)}---\n${body}`);
}

const WEEKLY = "internal/journal/flows/weekly/FLOW.md";
const weekly = (more: Properties = {}) =>
  write(WEEKLY, { name: "weekly", description: "A week in review.", skills: ["journal", "reflect"], policies: ["hello:always-say-hello"], promises: ["mood-recorded"], fields: { mood: "", week: 1 }, ...more });
const reflect = () => t!.vault.write("internal/journal/skills/reflect/SKILL.md", "---\nname: reflect\ndescription: How to look back on a week.\n---\nRead the week's notes.\n");
const messages = () => t!.yami.problems.map((p) => `${p.module} · ${p.path} · ${p.message}`);

describe("vault flows of a code module", () => {
  it("are off by default: a FLOW.md under a code module's id stays the problem it is, and the wiki takes none", async () => {
    const hello = new Hello();
    t = await testYami({ modules: [hello] });
    await write("internal/hello/flows/extra/FLOW.md", { name: "extra", description: "An extra flow." });
    await t.yami.discover();
    expect(hello.vaultFlows).toBe(false);
    expect(hello.flows.map((f) => f.name)).toEqual(["greet"]);
    expect(messages()).toEqual(["hello · internal/hello · The plugin's code has a module with the id hello, and it wins. Rename the folder internal/hello/ to give the vault module an id of its own."]);
    expect(t.yami.module("wiki")!.vaultFlows).toBe(false);
    expect(t.yami.module("threads")!.vaultFlows).toBe(true);
  });

  it("adds each valid FLOW.md after the code flows, with names that resolve in the module and in another, and its sessions run in the one loop with the module's checks", async () => {
    const journal = new Journal();
    t = await testYami({ modules: [new Hello(), journal] });
    let heard = 0;
    t.yami.onModulesChange(() => heard++);
    await reflect();
    await weekly();
    await t.yami.discover();
    expect(heard).toBe(1);
    expect(t.yami.problems).toEqual([]);
    expect(journal.flows.map((f) => f.name)).toEqual(["entry", "weekly"]);
    const flow = journal.flowOf("weekly")!;
    expect(flow.module).toBe(journal);
    expect(flow.skills.map((d) => d.path)).toEqual(["internal/journal/skills/journal/SKILL.md", "internal/journal/skills/reflect/SKILL.md"]);
    expect(flow.policies.map((d) => d.path)).toEqual(["internal/hello/policies/always-say-hello/POLICY.md"]);
    expect(journal.acts().map((a) => a.label)).toEqual(["New entry", "New weekly"]);

    const session = await flow.create({ name: "W1" });
    expect(session.path).toBe("journal/W1.md");
    expect((await session.read()).properties).toMatchObject({ module: "journal", flow: "weekly", mood: "", week: 1 });
    let prompt = "";
    t.agent.queue(async (text) => {
      prompt = text;
      await updateDocument(t!.vault, session.path, (d) => (d.properties.mood = "good"));
    }, review());
    expect(await session.start()).toMatchObject({ state: "done", iterations: 1 });
    expect(prompt).toContain("- week: 1");
    expect(prompt).toContain("`journal:reflect`");
    expect((await session.read()).body).toContain("[[internal/journal/promises/mood-recorded/PROMISE|mood-recorded]] — the mood is set");
    expect(await t.yami.summaries(flow)).toHaveLength(1);
  });

  it("follows the vault: a change gives a new flow, a removal takes it out, and the code flows stay", async () => {
    const journal = new Journal();
    t = await testYami({ modules: [journal] });
    await weekly({ skills: ["journal"], policies: [] });
    await t.yami.discover();
    const first = journal.flowOf("weekly")!;
    let heard = 0;
    t.yami.onModulesChange(() => heard++);
    await t.yami.discover();
    expect(journal.flowOf("weekly")).toBe(first);
    expect(heard).toBe(0);
    await weekly({ skills: ["journal"], policies: [], description: "Another week." });
    await t.yami.discover();
    expect(heard).toBe(1);
    expect(journal.flowOf("weekly")).not.toBe(first);
    expect(journal.flowOf("weekly")!.description).toBe("Another week.");
    await t.vault.remove(WEEKLY);
    await t.yami.discover();
    expect(heard).toBe(2);
    expect(journal.flows.map((f) => f.name)).toEqual(["entry"]);
  });

  it("keeps a broken flow out with the problems of a vault module's, a flow with a code flow's name, and a field of another type than the schema's, and never throws", async () => {
    const journal = new Journal();
    t = await testYami({ modules: [journal] });
    await write("internal/journal/flows/entry/FLOW.md", { name: "entry", description: "A second entry." });
    await write("internal/journal/flows/body/FLOW.md", { name: "body", description: "Has a body." }, "Text.\n");
    await write("internal/journal/flows/lost/FLOW.md", { name: "lost", description: "Names a skill that is gone.", skills: ["nothing"] });
    await write("internal/journal/flows/typed/FLOW.md", { name: "typed", description: "A mood of another type.", fields: { mood: 3 } });
    await write("internal/journal/flows/ok/FLOW.md", { name: "ok", description: "A valid flow." });
    await t.vault.write("internal/journal/flows/broken/FLOW.md", "---\nname: broken\ndescription: a: b\n---\n");
    await expect(t.yami.discover()).resolves.toBeUndefined();
    expect(journal.flows.map((f) => f.name)).toEqual(["entry", "ok"]);
    expect(journal.flowOf("entry")!.description).toBe("One entry.");
    expect(messages()).toEqual([
      "journal · internal/journal/flows/body/FLOW.md · A flow has no body. Move the text into the property instructions, and leave the body empty.",
      expect.stringMatching(/^journal · internal\/journal\/flows\/broken\/FLOW\.md · The properties do not parse: /),
      "journal · internal/journal/flows/entry/FLOW.md · The Journal module's code has a flow named entry, and it wins. Rename this flow's folder and its name.",
      'journal · internal/journal/flows/lost/FLOW.md · The flow names the skill "nothing", which is not in the vault. Create internal/journal/skills/nothing/SKILL.md, or fix the name in skills.',
      "journal · internal/journal/flows/typed/FLOW.md · The field mood must be text, as the Journal module's schema declares it. Give it such a default, or rename the field.",
    ]);
  });

  it("lets a live run keep the vault flow it started with", async () => {
    const journal = new Journal();
    t = await testYami({ modules: [journal] });
    await weekly({ skills: ["journal"], policies: [], maxIterations: 3 });
    await t.yami.discover();
    const session = await journal.flowOf("weekly")!.create({ name: "kept" });
    let release!: () => void;
    let begun!: () => void;
    const started = new Promise<void>((resolve) => (begun = resolve));
    const first: Turn = () => {
      begun();
      return new Promise<void>((resolve) => (release = resolve));
    };
    t.agent.queue(first, () => updateDocument(t!.vault, session.path, (d) => (d.properties.mood = "bad")).then(() => undefined));
    const run = session.start();
    await started;
    await weekly({ skills: ["journal"], policies: [], maxIterations: 1 });
    await t.yami.discover();
    expect(journal.flowOf("weekly")!.maxIterations).toBe(1);
    release();
    expect(await run).toMatchObject({ state: "done", iterations: 2 });
  });

  it("gives the agents the skills a person adds, also to a module with no skill of its own", async () => {
    t = await testYami({ modules: [new Plain()] });
    const set = `${t.root}/internal/plain`;
    expect(t.yami.skills()).not.toContain(set);
    await t.vault.write("internal/plain/skills/tidy/SKILL.md", "---\nname: tidy\ndescription: How to tidy a note.\n---\nTidy it.\n");
    await t.yami.discover();
    expect(t.yami.module("plain")!.hasSkills).toBe(true);
    expect(t.agent.preferences.skills).toContain(set);
  });
});

describe("starter forms", () => {
  const KINDS: FormKind[] = ["agent", "flow", "policy", "promise", "skill"];

  it("writes a valid starter of each kind, which says how to fill it, and a starter flow is a flow of the module", async () => {
    const journal = new Journal();
    t = await testYami({ modules: [journal] });
    for (const kind of KINDS) {
      const path = await t.yami.createForm(journal, kind, "Daily review");
      const folder = { agent: "agents", flow: "flows", policy: "policies", promise: "promises", skill: "skills" }[kind];
      expect(path).toBe(`internal/journal/${folder}/daily-review/${kind.toUpperCase()}.md`);
      const text = await t.vault.read(path);
      expect(text.split("\n").slice(0, 3)).toEqual(["---", "name: daily-review", expect.stringMatching(/^description: "Daily review: /)]);
      const doc = await readDocument(t.vault, path);
      if (kind === "flow") {
        expect(doc.body.trim()).toBe("");
        expect(text).toContain("# The forms that a new session links");
      } else expect(doc.body.trim().split("\n").length).toBeGreaterThan(0);
    }
    expect(t.yami.problems).toEqual([]);
    expect(journal.flowOf("daily-review")).toMatchObject({ command: true, maxIterations: 3, access: "edit" });
    expect(journal.acts().map((a) => a.label)).toContain("New daily review");
    expect((await readDocument(t.vault, "internal/journal/agents/daily-review/AGENT.md")).properties.access).toBe("read-only");
    expect((await readDocument(t.vault, "internal/journal/promises/daily-review/PROMISE.md")).properties.check).toBeUndefined();
  });

  it("refuses a name that gives no id, a form of that kind and id, a code flow's name, and a module that takes no vault flows", async () => {
    const journal = new Journal();
    const hello = new Hello();
    t = await testYami({ modules: [journal, hello] });
    await expect(t.yami.createForm(journal, "policy", "!!!")).rejects.toThrow('"!!!" gives no policy name. Give a name with letters or digits.');
    await expect(t.yami.createForm(journal, "skill", "Journal")).rejects.toThrow("The Journal module has a skill named journal. Give the skill another name.");
    await expect(t.yami.createForm(journal, "flow", "entry")).rejects.toThrow("The Journal module has a flow named entry.");
    await t.yami.createForm(journal, "agent", "helper");
    await expect(t.yami.createForm(journal, "agent", "Helper")).rejects.toThrow("The Journal module has a agent named helper.");
    await expect(t.yami.createForm(hello, "flow", "extra")).rejects.toThrow("The Hello world module takes no forms from the vault.");
    const vaultModule = await t.yami.createModule("Notes");
    await expect(t.yami.createForm(vaultModule, "flow", "extra")).rejects.toThrow("The Notes module takes no forms from the vault.");
    expect(await t.vault.exists("internal/hello/flows/extra/FLOW.md")).toBe(false);
  });
});

describe("the built-in threads module", () => {
  it("comes after the wiki and before the host's modules, and a host leaves it out with one option", async () => {
    const vault = new FsVault("/tmp/yami-none");
    const yami = new Yami({ vault, modules: [new Hello()] });
    expect(yami.modules.map((m) => m.id)).toEqual(["wiki", "threads", "hello"]);
    expect(yami.module("threads")).toBeInstanceOf(ThreadsModule);
    expect(yami.module("threads")).toMatchObject({ name: "Threads", icon: "spool" });

    class Own extends Hello {
      readonly id = "threads";
    }
    expect(() => new Yami({ vault, modules: [new Own()] })).toThrow("The id threads is the built-in threads module's. Give the module another id, or leave the built-in module out with the option threads: false.");
    const own = new Own();
    const without = new Yami({ vault, modules: [own], threads: false });
    expect(without.modules.map((m) => m.id)).toEqual(["wiki", "threads"]);
    expect(without.module("threads")).toBe(own);
    expect(without.tools().tools.map((tool) => tool.name)).not.toContain("threads_stub");
  });

  it("keeps the person's own flow sessions in threads/ off the board, and they are no threads", async () => {
    t = await testYami();
    const threads = t.yami.module("threads") as ThreadsModule;
    await t.yami.createForm(threads, "flow", "Daily");
    const daily = await threads.flowOf("daily")!.create({ name: "Today" });
    expect(daily.path).toBe("threads/Today.md");
    expect(threads.flows.map((f) => f.name)).toEqual(["thread", "daily"]);
    expect(await threads.status()).toEqual({ threads: [] });
    await expect(threads.status("Today")).rejects.toThrow('No thread is named "Today"');
  });

  it("gives a session of the person's own flow none of the thread fields, and a thread all of them", async () => {
    t = await testYami();
    const threads = t.yami.module("threads") as ThreadsModule;
    const THREAD_FIELDS = ["description", "repositories", "after", "priority", "budget", "retired", "phase", "tags"];
    expect(threads.schema).toBeUndefined();
    expect(Object.keys(threads.thread.schema)).toEqual(THREAD_FIELDS);
    await t.yami.createForm(threads, "flow", "Daily review");
    const daily = await readDocument(t.vault, (await threads.flowOf("daily-review")!.create({ name: "Today" })).path);
    expect(Object.keys(daily.properties).filter((key) => THREAD_FIELDS.includes(key))).toEqual([]);
    const thread = await readDocument(t.vault, (await threads.thread.create({ name: "Divide" })).path);
    expect(thread.properties).toMatchObject({ repositories: [], after: [], retired: [], tags: [] });
  });
});

describe("the wiki's flows", () => {
  it("are ingest, read-only with its own promises, and checkout, the only one with a command", async () => {
    t = await testYami();
    const wiki = t.yami.module("wiki")!;
    expect(wiki.flows.map((f) => [f.name, f.command, f.access])).toEqual([
      ["ingest", false, "read-only"],
      ["checkout", true, "edit"],
    ]);
    expect(wiki.flowOf("ingest")!.promises.map((p) => p.name)).toEqual(["change-applied", "sources-absorbed", "clean-topics"]);
    expect(wiki.acts().map((a) => a.label)).toEqual(["New checkout"]);
    expect(await t.vault.read("internal/wiki/sessions.base")).toContain("name: Checkouts");
  });

  it("give an ingest session its sources, and a checkout its status, each not the other's", async () => {
    t = await testYami();
    const wiki = t.yami.module("wiki")!;
    expect(Object.keys(wiki.schema!)).toEqual(["changes"]);
    expect(Object.keys(wiki.flowOf("ingest")!.schema)).toEqual(["sources"]);
    expect(Object.keys(wiki.flowOf("checkout")!.schema)).toEqual(["status", "returned"]);
    await t.vault.write("notes/A.md", "A note.\n");
    const ingest = await readDocument(t.vault, (await t.yami.ingest({ files: ["notes/A.md"] })).path);
    expect(ingest.properties).toMatchObject({ changes: [], sources: [expect.stringContaining("A (source)")] });
    const checkout = await readDocument(t.vault, (await wiki.flowOf("checkout")!.create({ name: "C" })).path);
    expect(checkout.properties).toMatchObject({ changes: [] });
    expect(checkout.properties).not.toHaveProperty("sources");
  });
});
