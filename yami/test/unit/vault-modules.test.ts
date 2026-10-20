import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readDocument } from "../../src/document/index.js";
import { VaultModule, type Properties } from "../../src/index.js";
import { definesModule } from "../../src/module/vault-module.js";
import { review, testYami, type TestYami, type Turn } from "../../src/testing/index.js";
import { Hello } from "../fixtures/hello.js";

let t: TestYami | undefined;
afterEach(async () => {
  await t?.dispose();
  t = undefined;
});

async function write(path: string, properties: Properties, body = "") {
  await t!.vault.write(path, `---\n${t!.vault.stringifyProperties(properties)}---\n${body}`);
}

const MODULE = "internal/code-review/code-review.md";
const FLOW = "internal/code-review/flows/review-a-change/FLOW.md";
const form = (folder: string, name: string, file: string) => `internal/code-review/${folder}/${name}/${file}.md`;

/**
 * A vault module with one flow that names a skill, an agent, a policy, a policy of the Hello module, a
 * promise with a check, a promise with none by its link, and links an article.
 */
async function codeReview(flow: Properties = {}) {
  await write(MODULE, { type: "module", module: "code-review", name: "Code review", description: "Reviews a change.", icon: "search", color: "#30A46C", instructions: "Module instructions." }, "For a person.\n");
  await write(FLOW, {
    name: "review-a-change",
    description: "One review of one change.",
    skills: ["review"],
    agents: ["second-look"],
    policies: ["be-kind", "hello:always-say-hello"],
    promises: ["report-written", "[[internal/code-review/promises/report-is-useful/PROMISE|report-is-useful]]"],
    articles: ["[[Style guide]]"],
    maxIterations: 2,
    access: "edit",
    instructions: "Flow instructions.",
    fields: { change: "", rounds: 1 },
    ...flow,
  });
  await t!.vault.write(form("skills", "review", "SKILL"), "---\nname: review\ndescription: How to review a change.\n---\n# Review\n\nRead the change.\n");
  await write(form("agents", "second-look", "AGENT"), { name: "second-look", description: "Reads the report again.", access: "read-only" }, "Read the report, and say what it misses.\n");
  await write(form("policies", "be-kind", "POLICY"), { name: "be-kind", description: "Kind words first." }, "Say what is good first.\n");
  await write(form("promises", "report-written", "PROMISE"), { name: "report-written", description: "The report exists.", check: "exists", path: "code-review/{{session}}/Report.md" }, "The report.\n");
  await write(form("promises", "report-is-useful", "PROMISE"), { name: "report-is-useful", description: "The report helps." }, "The report names each problem with its line.\n");
  await t!.vault.write("notes/Style guide.md", "Short sentences.\n");
}

async function fresh() {
  t = await testYami({ modules: [new Hello()] });
  return t;
}

const ids = () => t!.yami.modules.map((m) => m.id);
const messages = () => t!.yami.problems.map((p) => `${p.module} · ${p.path} · ${p.message}`);

describe("a vault module", () => {
  it("is found at start, and a host reads it through the API of any module", async () => {
    const { yami, vault, root, agent } = await fresh();
    await codeReview();
    await yami.enable();
    expect(ids()).toEqual(["wiki", "threads", "hello", "code-review"]);
    expect(yami.problems).toEqual([]);
    const module = yami.module("code-review")!;
    expect(module).toBeInstanceOf(VaultModule);
    expect(yami.module("hello")).not.toBeInstanceOf(VaultModule);
    expect(module).toMatchObject({ name: "Code review", description: "Reviews a change.", icon: "search", instructions: "Module instructions.", document: MODULE });
    expect(module.colors).toEqual({ folder: "#30a46c", internal: "#5d977b" });
    expect(module.schema).toEqual({ change: { type: "text", default: "" }, rounds: { type: "number", default: 1 } });
    expect(module.layout).toMatchObject({ sessions: "code-review", ledger: "internal/code-review/sessions.base" });
    expect(await vault.exists("internal/code-review/sessions.base")).toBe(true);
    const [flow] = module.flows;
    expect(flow).toMatchObject({
      name: "review-a-change",
      label: "New review a change",
      description: "One review of one change.",
      maxIterations: 2,
      access: "edit",
      instructions: "Flow instructions.",
      fields: { change: "", rounds: 1 },
      command: true,
    });
    expect(Object.values(flow!.links()).flat().map((d) => `${d.kind} ${d.name} ${d.path}`)).toEqual([
      "agent second-look internal/code-review/agents/second-look/AGENT.md",
      "article Style guide notes/Style guide.md",
      "policy be-kind internal/code-review/policies/be-kind/POLICY.md",
      "policy always-say-hello internal/hello/policies/always-say-hello/POLICY.md",
      "promise report-written internal/code-review/promises/report-written/PROMISE.md",
      "promise report-is-useful internal/code-review/promises/report-is-useful/PROMISE.md",
      "skill review internal/code-review/skills/review/SKILL.md",
    ]);
    expect(module.acts().map((a) => `${a.kind}:${a.label}`)).toEqual(["new:New review a change"]);
    expect(module.tools()).toEqual([]);
    expect(yami.skills()).toContain(`${root}/internal/code-review`);
    expect(agent.preferences.skills).toContain(`${root}/internal/code-review`);
  });

  it("runs its sessions in the same loop as any module's, with the base skill, the agents, and the review", async () => {
    const { yami, vault, agent } = await fresh();
    await codeReview();
    await yami.discover();
    const module = yami.module("code-review")!;
    const session = await module.flows[0]!.create({ name: "PR 12", request: "Review PR 12.", fields: { change: "PR 12" } });
    expect(session.path).toBe("code-review/PR 12.md");
    const doc = await readDocument(vault, session.path);
    expect(doc.properties).toMatchObject({
      module: "code-review",
      flow: "review-a-change",
      change: "PR 12",
      rounds: 1,
      agents: ["[[internal/code-review/agents/second-look/AGENT|second-look]]"],
      policies: ["[[internal/code-review/policies/be-kind/POLICY|be-kind]]", "[[internal/hello/policies/always-say-hello/POLICY|always-say-hello]]"],
      skills: ["[[internal/code-review/skills/review/SKILL|review]]"],
      articles: ["[[notes/Style guide|Style guide]]"],
    });
    expect(doc.body).toContain("# PR 12\n\n## Request\nReview PR 12.\n\n## Deliverables");

    agent.queue(() => vault.write("code-review/PR 12/Report.md", "Fine.\n"), review());
    expect(await session.start()).toMatchObject({ state: "done", iterations: 1 });
    const [prompt] = agent.started[0]!.prompts;
    expect(prompt).toMatch(/^\/yami:run This is the Yami session "PR 12", a "review-a-change" session of the module "Code review"\./);
    expect(prompt).toContain("Module instructions.\n\nFlow instructions.");
    expect(prompt).toContain("- change: PR 12\n- rounds: 1");
    expect(prompt).toContain("## Request\nReview PR 12.");
    expect(prompt).toContain("- `code-review:review`: How to review a change.");
    expect(prompt).toContain("- `second-look`: Reads the report again. It is read-only.");
    expect(agent.started[1]!.prompts[0]).toContain("### be-kind");
    expect(agent.started[1]!.prompts[0]).toContain("### always-say-hello");
    expect(agent.started[1]!.prompts[0]).toContain("### report-is-useful");

    const [summary] = await yami.summaries(module);
    expect(summary).toMatchObject({ name: "PR 12", status: "done", module, flow: module.flows[0], met: 2, unmet: 0 });
    const details = await session.details();
    expect(details.documents.map((d) => [d.kind, d.name, d.met ?? d.followed])).toEqual([
      ["promises", "report-written", true],
      ["promises", "report-is-useful", true],
      ["policies", "be-kind", true],
      ["policies", "always-say-hello", true],
      ["skills", "review", undefined],
      ["agents", "second-look", undefined],
      ["articles", "Style guide", undefined],
    ]);
    expect(session.acts(doc.properties).map((a) => a.kind)).toEqual(["start"]);
  });

  it("takes defaults: the id as the module's name, the default icon, and the defaults of a flow", async () => {
    const { yami } = await fresh();
    await write("internal/notes/notes.md", { type: "module" });
    await write("internal/notes/flows/daily/FLOW.md", { name: "daily", description: "A daily note.", command: false });
    await yami.discover();
    expect(yami.problems).toEqual([]);
    const module = yami.module("notes")!;
    expect(module).toMatchObject({ name: "notes", icon: "box", description: undefined, schema: {} });
    expect(module.flows[0]).toMatchObject({ name: "daily", label: "New daily", maxIterations: 3, access: "edit", command: false, agents: [] });
    expect(module.acts()).toEqual([]);
    expect(module.hasSkills).toBe(false);
    expect(yami.skills().some((s) => s.endsWith("internal/notes"))).toBe(false);
  });

  it("is no module without a flow: a module document that a code module left behind, a code module's own folder, or the old templates", async () => {
    const { yami } = await fresh();
    await write("internal/old/old.md", { type: "module", module: "old", name: "Old" });
    await write("internal/old/templates/Task.md", { type: "template" });
    await yami.discover();
    expect(ids()).toEqual(["wiki", "threads", "hello"]);
    expect(yami.problems).toEqual([]);
  });

  it("says which paths define a module", () => {
    expect(definesModule("internal/a/a.md")).toBe(true);
    for (const folder of ["agents", "flows", "policies", "promises", "skills"]) {
      expect(definesModule(`internal/a/${folder}/x/FORM.md`), folder).toBe(true);
      expect(definesModule(`internal/a/${folder}/x.md`), folder).toBe(true);
    }
    expect(definesModule("internal/a/b.md")).toBe(false);
    expect(definesModule("internal/a/templates/T.md")).toBe(false);
    expect(definesModule("internal/a/articles/x.md")).toBe(false);
    expect(definesModule("notes/a/a.md")).toBe(false);
  });
});

describe("the problems of vault modules", () => {
  it("reports each problem of a form with its module, its file, and how to fix it, and keeps every valid flow", async () => {
    const { yami } = await fresh();
    await codeReview();
    const flow = (name: string) => `internal/code-review/flows/${name}/FLOW.md`;
    const base = (name: string) => ({ name, description: "A flow." });
    // Forms in the wrong shape.
    await write("internal/code-review/policies/Be brief.md", { name: "be-brief", description: "One line." }, "One line.\n");
    await write("internal/code-review/flows/old.md", base("old"));
    await write(form("policies", "misnamed", "POLICY"), { name: "Misnamed", description: "A policy." }, "Rule.\n");
    await write(form("agents", "admin", "AGENT"), { name: "admin", description: "An agent.", access: "admin" }, "Brief.\n");
    await write("internal/code-review/policies/Bad Folder/POLICY.md", { name: "Bad Folder", description: "A policy." }, "Rule.\n");
    await write(form("skills", "nameless", "SKILL"), { description: "A skill." }, "Body.\n");
    // Flows that are not valid.
    await t!.vault.write(flow("unparsed"), "---\nname: a: b\n---\n");
    await write(flow("bad-access"), { ...base("bad-access"), access: "readonly" });
    await write(flow("with-body"), base("with-body"), "## Change\n\nName the change here.\n");
    await write(flow("renamed"), base("other-name"));
    await write(flow("no-description"), { name: "no-description" });
    await write(flow("dead-name"), { ...base("dead-name"), policies: ["no-such-policy"], agents: ["other:helper"] });
    await write(flow("old-link"), { ...base("old-link"), policies: ["[[Be kind]]"] });
    await write(flow("dead-article"), { ...base("dead-article"), articles: ["[[No such note]]"] });
    await write(flow("names-broken"), { ...base("names-broken"), policies: ["misnamed"] });
    await write(flow("core-field"), { ...base("core-field"), fields: { state: "done" } });
    await write(flow("no-turns"), { ...base("no-turns"), maxIterations: 0 });
    await write(flow("z-other-rounds"), { ...base("z-other-rounds"), fields: { rounds: "two" } });
    // Folders that are no vault module.
    await t!.vault.write("internal/unparsed/unparsed.md", "---\nname: a: b\n---\n");
    await write("internal/unparsed/flows/t/FLOW.md", base("t"));
    await write("internal/Bad Name/Bad Name.md", { type: "module" });
    await write("internal/Bad Name/flows/t/FLOW.md", base("t"));
    await write("internal/hello/flows/t/FLOW.md", base("t"));
    await write("internal/yami/flows/t/FLOW.md", base("t"));
    await write("internal/headless/flows/t/FLOW.md", base("t"));
    await write("internal/typeless/typeless.md", { name: "Typeless" });
    await write("internal/typeless/flows/t/FLOW.md", base("t"));
    // A module whose bad color falls back to the default.
    await write("internal/teal/teal.md", { type: "module", color: "teal", icon: 3 });
    await write("internal/teal/flows/t/FLOW.md", base("t"));
    await yami.discover();

    expect(ids()).toEqual(["wiki", "threads", "hello", "code-review", "teal"]);
    expect(yami.module("code-review")!.flows.map((f) => f.name)).toEqual(["review-a-change"]);
    expect(yami.module("teal")).toMatchObject({ color: undefined, icon: "box" });
    const cr = "code-review · internal/code-review";
    expect(messages()).toEqual([
      'Bad Name · internal/Bad Name · "Bad Name" cannot be a module id. Rename the folder to bad-name: lower-case letters, digits, and dashes.',
      `${cr}/agents/admin/AGENT.md · The property access must be one of edit, read-only.`,
      `${cr}/flows/bad-access/FLOW.md · The property access must be one of edit, read-only.`,
      `${cr}/flows/core-field/FLOW.md · The field state is a core session field, which Yami sets. Rename it.`,
      `${cr}/flows/dead-article/FLOW.md · The flow links the article "No such note", which is not in the vault. Create it, or fix the link in articles.`,
      `${cr}/flows/dead-name/FLOW.md · The flow names the agent "other:helper", which is not in the vault. Create internal/other/agents/helper/AGENT.md, or fix the name in agents.`,
      `${cr}/flows/dead-name/FLOW.md · The flow names the policy "no-such-policy", which is not in the vault. Create internal/code-review/policies/no-such-policy/POLICY.md, or fix the name in policies.`,
      `${cr}/flows/names-broken/FLOW.md · The flow names the policy "misnamed", whose document has a problem. Fix internal/code-review/policies/misnamed/POLICY.md first.`,
      `${cr}/flows/no-description/FLOW.md · The property description is missing.`,
      `${cr}/flows/no-turns/FLOW.md · maxIterations must be a whole number of 1 or more, not 0.`,
      `${cr}/flows/old-link/FLOW.md · The flow names the policy "Be kind", which is no name. Name a policy by its folder's name, or as <module>:<name>, in policies.`,
      `${cr}/flows/old.md · A flow is a folder with a FLOW.md in it. Move this file to internal/code-review/flows/old/FLOW.md, and set name: old.`,
      `${cr}/flows/renamed/FLOW.md · The name is "other-name", and the folder is renamed. A name is its folder's name: set name: renamed, or rename the folder.`,
      `${cr}/flows/unparsed/FLOW.md · The properties do not parse: Nested mappings are not allowed in compact mappings at line 1, column 7. Fix them in the document's source view.`,
      `${cr}/flows/with-body/FLOW.md · A flow has no body. Move the text into the property instructions, and leave the body empty.`,
      `${cr}/flows/z-other-rounds/FLOW.md · The field rounds is text here and a number in another flow. Give it one type.`,
      `${cr}/policies/Bad Folder/POLICY.md · "Bad Folder" cannot name a policy. Rename the folder to bad-folder, and set the same name: lower-case letters, digits, and dashes.`,
      `${cr}/policies/Be brief.md · A policy is a folder with a POLICY.md in it. Move this file to internal/code-review/policies/be-brief/POLICY.md, and set name: be-brief.`,
      `${cr}/policies/misnamed/POLICY.md · The name is "Misnamed", and the folder is misnamed. A name is its folder's name: set name: misnamed, or rename the folder.`,
      `${cr}/skills/nameless/SKILL.md · The property name is missing. Set name: nameless.`,
      "headless · internal/headless · The folder has flows but no module document. Create internal/headless/headless.md with the property type: module.",
      "hello · internal/hello · The plugin's code has a module with the id hello, and it wins. Rename the folder internal/hello/ to give the vault module an id of its own.",
      "teal · internal/teal/teal.md · The property icon must be text. Yami leaves it out until you fix it.",
      'teal · internal/teal/teal.md · The color "teal" is not a hex code such as #3e63dd. The module takes a basic color until you fix it.',
      "typeless · internal/typeless/typeless.md · Set the property type: module.",
      "unparsed · internal/unparsed/unparsed.md · The properties do not parse: Nested mappings are not allowed in compact mappings at line 1, column 7. Fix them in the document's source view.",
      "yami · internal/yami · The id yami is Yami's own. Rename the folder internal/yami/.",
    ]);
    // A problem in a document names the document; a problem of the folder names none.
    const folders = ["internal/Bad Name", "internal/headless", "internal/hello", "internal/yami"];
    for (const problem of yami.problems) expect(problem.document, problem.message).toBe(folders.includes(problem.path) ? undefined : problem.path);
  });

  it("keeps the other modules' sessions running", async () => {
    const { yami, agent, vault } = await fresh();
    await t!.vault.write("internal/broken/broken.md", "---\nname: a: b\n---\n");
    await write("internal/broken/flows/t/FLOW.md", { name: "t", description: "A flow." });
    await yami.discover();
    const session = await (yami.module("hello") as Hello).greet.create({ name: "ok" });
    agent.queue(() => vault.write("greetings/ok.md", "Hello, ok"), review());
    expect(await session.start()).toMatchObject({ state: "done" });
  });

  it("fails a session whose flow is gone with a clear error", async () => {
    const { yami, vault } = await fresh();
    await codeReview();
    await yami.discover();
    const session = await yami.module("code-review")!.flows[0]!.create({ name: "orphan" });
    await vault.remove(FLOW);
    await write("internal/code-review/flows/other/FLOW.md", { name: "other", description: "Another flow." });
    await yami.discover();
    await expect(session.start()).rejects.toThrow('code-review/orphan.md names the flow "review-a-change", which the code-review module does not have.');
  });
});

describe("live changes", () => {
  it("adds, changes, renames, and removes vault modules, and tells the listeners once for each change", async () => {
    const { yami, vault, root, agent } = await fresh();
    let heard = 0;
    const off = yami.onModulesChange(() => heard++);
    await yami.discover();
    expect(heard).toBe(0);

    await codeReview();
    await write("internal/notes/notes.md", { type: "module" });
    await write("internal/notes/flows/daily/FLOW.md", { name: "daily", description: "A daily note." });
    await yami.discover();
    expect(heard).toBe(1);
    expect(ids()).toEqual(["wiki", "threads", "hello", "code-review", "notes"]);
    expect(agent.preferences.skills).toContain(`${root}/internal/code-review`);
    const notes = yami.module("notes");
    const before = yami.module("code-review");

    await yami.discover();
    expect(heard).toBe(1);

    await write(FLOW, { name: "review-a-change", description: "A shorter review.", skills: ["review"] });
    await yami.discover();
    expect(heard).toBe(2);
    expect(yami.module("code-review")).not.toBe(before);
    expect(yami.module("code-review")!.flows[0]).toMatchObject({ name: "review-a-change", description: "A shorter review." });
    expect(yami.module("notes")).toBe(notes);

    await write("internal/code-review/flows/quick-look/FLOW.md", { name: "quick-look", description: "A quick look.", skills: ["review"] });
    await vault.remove(FLOW);
    await yami.discover();
    expect(heard).toBe(3);
    expect(yami.module("code-review")!.flows.map((f) => f.name)).toEqual(["quick-look"]);

    await vault.remove("internal/code-review/skills/review/SKILL.md");
    await yami.discover();
    expect(heard).toBe(4);
    expect(ids()).toEqual(["wiki", "threads", "hello", "code-review", "notes"]);
    expect(yami.module("code-review")!.flows).toEqual([]);
    expect(messages()).toEqual([
      'code-review · internal/code-review/flows/quick-look/FLOW.md · The flow names the skill "review", which is not in the vault. Create internal/code-review/skills/review/SKILL.md, or fix the name in skills.',
    ]);
    expect(agent.preferences.skills).not.toContain(`${root}/internal/code-review`);

    await vault.remove(MODULE);
    await yami.discover();
    expect(heard).toBe(5);
    expect(ids()).toEqual(["wiki", "threads", "hello", "notes"]);
    off();
    await vault.remove("internal/notes/flows/daily/FLOW.md");
    await yami.discover();
    expect(heard).toBe(5);
    expect(ids()).toEqual(["wiki", "threads", "hello"]);
  });

  it("lets a live run keep the flow it started with", async () => {
    const { yami, vault, agent } = await fresh();
    await codeReview();
    await yami.discover();
    const session = await yami.module("code-review")!.flows[0]!.create({ name: "kept" });
    let release!: () => void;
    let begun!: () => void;
    const started = new Promise<void>((resolve) => (begun = resolve));
    const first: Turn = () => {
      begun();
      return new Promise<void>((resolve) => (release = resolve));
    };
    agent.queue(first, () => vault.write("code-review/kept/Report.md", "Fine.\n"), review());
    const run = session.start();
    await started;
    await write(FLOW, { name: "review-a-change", description: "One turn.", maxIterations: 1, policies: ["be-kind"] });
    await yami.discover();
    expect(yami.module("code-review")!.flows[0]!.maxIterations).toBe(1);
    release();
    expect(await run).toMatchObject({ state: "done", iterations: 2 });
  });
});

describe("a test Yami with files", () => {
  it("copies files and folders into the vault before it enables the modules, so discovery finds them at start", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "yami-fixture-"));
    try {
      await mkdir(join(fixture, "notes/flows/daily"), { recursive: true });
      await writeFile(join(fixture, "notes/notes.md"), "---\ntype: module\nname: Notes\n---\n");
      await writeFile(join(fixture, "notes/flows/daily/FLOW.md"), "---\nname: daily\ndescription: A daily note.\n---\n");
      await writeFile(join(fixture, "Readme.md"), "Read me.\n");
      t = await testYami({ files: { "internal/notes": join(fixture, "notes"), "docs/Readme.md": join(fixture, "Readme.md") } });
      expect(t.yami.module("notes")).toBeInstanceOf(VaultModule);
      expect(t.yami.module("notes")!.flows.map((f) => f.name)).toEqual(["daily"]);
      expect(await t.vault.read("docs/Readme.md")).toBe("Read me.\n");
      expect(await t.vault.exists("internal/notes/sessions.base")).toBe(true);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("says which file it cannot copy", async () => {
    await expect(testYami({ files: { "internal/notes": "/no/such/folder" } })).rejects.toThrow("testYami cannot copy /no/such/folder to internal/notes:");
  });
});

describe("a new vault module from the starter", () => {
  it("creates a module in the five forms, whose session runs to done", async () => {
    const { yami, vault, agent } = await fresh();
    const module = await yami.createModule("Code review");
    expect(module).toBeInstanceOf(VaultModule);
    expect(module).toMatchObject({ id: "code-review", name: "Code review", document: MODULE });
    expect(yami.module("code-review")).toBe(module);
    expect(yami.problems).toEqual([]);
    for (const file of [
      "internal/code-review/flows/task/FLOW.md",
      "internal/code-review/skills/task/SKILL.md",
      "internal/code-review/agents/checker/AGENT.md",
      "internal/code-review/policies/stay-in-scope/POLICY.md",
      "internal/code-review/promises/result-note/PROMISE.md",
      "internal/code-review/sessions.base",
    ]) {
      expect(await vault.exists(file), file).toBe(true);
    }
    expect((await readDocument(vault, "internal/code-review/flows/task/FLOW.md")).body).toBe("");
    const [flow] = module.flows;
    expect(flow).toMatchObject({ name: "task", label: "New task" });
    expect(flow!.agents.map((a) => a.name)).toEqual(["checker"]);
    const session = await flow!.create({ name: "First", request: "Write a hello note." });
    agent.queue(() => vault.write("code-review/First/Result.md", "Done.\n"), review());
    expect(await session.start()).toMatchObject({ state: "done", iterations: 1 });
  });

  it("refuses a name that gives no id, Yami's own id, and an id that a module or a folder has", async () => {
    const { yami, vault } = await fresh();
    await yami.createModule("Notes");
    await vault.write("internal/drafts/old.md", "Old.\n");
    await expect(yami.createModule("!!!")).rejects.toThrow('"!!!" gives no module id. Give a name with letters or digits.');
    await expect(yami.createModule("Yami")).rejects.toThrow("A module has the id yami.");
    await expect(yami.createModule("Wiki")).rejects.toThrow("A module has the id wiki.");
    await expect(yami.createModule("notes")).rejects.toThrow("A module has the id notes.");
    await expect(yami.createModule("Drafts")).rejects.toThrow("The folder internal/drafts/ exists.");
  });
});
