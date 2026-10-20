import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => {
  class Base {}
  return {
    Notice: Base,
    Modal: Base,
    SuggestModal: Base,
    FuzzySuggestModal: Base,
    MarkdownView: Base,
    TFile: Base,
    debounce: (fn: unknown) => fn,
    getIcon: (name: string) => (name === "search" ? {} : null),
  };
});

import type { Command } from "obsidian";
import { readDocument } from "../../../src/document/index.js";
import type { Properties } from "../../../src/index.js";
import { addModuleCommands, addNewModuleCommand, addWikiCommands, age } from "../../../src/obsidian/commands.js";
import { TOPICS, type ChangeAct } from "../../../src/wiki/index.js";
import type { ObsidianYami } from "../../../src/obsidian/yami.js";
import { testYami, type TestYami } from "../../../src/testing/index.js";
import { Hello } from "../../fixtures/hello.js";

let t: TestYami | undefined;
afterEach(async () => {
  await t?.dispose();
  t = undefined;
});

async function write(path: string, properties: Properties, body = "") {
  await t!.vault.write(path, `---\n${t!.vault.stringifyProperties(properties)}---\n${body}`);
}

describe("the commands of the modules in Obsidian", () => {
  it("adds and removes each flow's command as the flow appears, changes, and goes", async () => {
    t = await testYami({ modules: [new Hello()], threads: false });
    const yami = t.yami;
    const commands = new Map<string, Command>();
    const removed: string[] = [];
    const host = {
      get modules() {
        return yami.modules;
      },
      plugin: {
        addCommand: (command: Command) => commands.set(command.id, command),
        removeCommand: (id: string) => {
          removed.push(id);
          commands.delete(id);
        },
      },
    } as unknown as ObsidianYami;
    const sync = addModuleCommands(host);
    const listed = () => [...commands.values()].filter((c) => !c.id.startsWith("yami-wiki-")).map((c) => `${c.id} · ${c.name} · ${c.icon}`);
    expect(listed()).toEqual(["yami-hello-new-greet · Hello world: new greet · box"]);

    await write("internal/notes/notes.md", { type: "module", name: "Notes", icon: "search" });
    await write("internal/notes/flows/daily-note/FLOW.md", { name: "daily-note", description: "A daily note." });
    await yami.discover();
    sync();
    expect(listed()).toEqual(["yami-hello-new-greet · Hello world: new greet · box", "yami-notes-new-daily-note · Notes: new daily note · search"]);
    sync();
    expect(removed).toEqual([]);

    await write("internal/notes/flows/daily-note/FLOW.md", { name: "daily-note", description: "A daily page." });
    await yami.discover();
    sync();
    expect(removed).toEqual(["yami-notes-new-daily-note"]);
    expect(listed()).toContain("yami-notes-new-daily-note · Notes: new daily note · search");

    await t.vault.remove("internal/notes/flows/daily-note/FLOW.md");
    await yami.discover();
    sync();
    expect(listed()).toEqual(["yami-hello-new-greet · Hello world: new greet · box"]);
  });

  it("gives a module that takes vault flows a command to create each form and one to create a flow session, which follow the module", async () => {
    class Review extends Hello {
      readonly pr = this.action({ id: "pr-comment", name: "PR comment", run: async () => "ok" });
    }
    t = await testYami({ modules: [new Review()] });
    const yami = t.yami;
    const commands = new Map<string, Command>();
    const shown: unknown[] = [];
    let answer: string | undefined;
    const asked: string[][] = [];
    const picked: string[][] = [];
    let done: Promise<void> = Promise.resolve();
    const host = {
      get modules() {
        return yami.modules;
      },
      plugin: { addCommand: (command: Command) => commands.set(command.id, command), removeCommand: (id: string) => commands.delete(id) },
      ask: async (placeholder: string, hint: string) => (asked.push([placeholder, hint]), answer),
      pick: async <T>(items: T[], label: (item: T) => string, placeholder: string) => (picked.push([placeholder, ...items.map(label)]), items[0]),
      createForm: yami.createForm.bind(yami),
      notify: (work: Promise<unknown>) => (done = work.then((result) => void shown.push(result), (error: Error) => void shown.push(`Yami: ${error.message}`))),
    } as unknown as ObsidianYami;
    const sync = addModuleCommands(host);
    const run = async (id: string) => {
      commands.get(id)!.callback!();
      await done;
      return shown.pop();
    };
    const names = () => [...commands.values()].map((c) => `${c.id} · ${c.name}`);
    expect(names()).toEqual([
      "yami-wiki-new-checkout · Wiki: new checkout",
      "yami-wiki-return · Wiki: return this checkout",
      "yami-threads-create-agent · Threads: create agent",
      "yami-threads-create-flow · Threads: create flow",
      "yami-threads-create-policy · Threads: create policy",
      "yami-threads-create-promise · Threads: create promise",
      "yami-threads-create-skill · Threads: create skill",
      "yami-threads-create-session · Threads: create a flow session",
      "yami-hello-new-greet · Hello world: new greet",
      "yami-hello-pr-comment · Hello world: PR comment",
    ]);

    for (const kind of ["agent", "flow", "policy", "promise", "skill"]) await run(`yami-threads-create-${kind}`);
    expect(asked).toEqual([
      ["The name of the new agent, such as Reviewer", "Create the agent"],
      ["The name of the new flow, such as Daily review", "Create the flow"],
      ["The name of the new policy, such as Cite sources", "Create the policy"],
      ["The name of the new promise, such as Summary written", "Create the promise"],
      ["The name of the new skill, such as Summarize", "Create the skill"],
    ]);

    expect(await run("yami-threads-create-session")).toBe("Threads has no flow that a person starts. Create one with Threads: create flow.");
    answer = undefined;
    expect(await run("yami-threads-create-policy")).toBeUndefined();
    expect(await t.vault.list("internal/threads/policies")).toEqual(["internal/threads/policies/change-through-tools/POLICY.md"]);
    answer = "!!!";
    expect(await run("yami-threads-create-flow")).toBe('Yami: "!!!" gives no flow name. Give a name with letters or digits.');
    answer = "Daily review";
    expect(await run("yami-threads-create-flow")).toEqual({ message: "Created internal/threads/flows/daily-review/FLOW.md.", open: "internal/threads/flows/daily-review/FLOW.md" });
    expect(await run("yami-threads-create-flow")).toBe("Yami: The Threads module has a flow named daily-review. Give the flow another name.");
    sync();
    expect(names()).toContain("yami-threads-new-daily-review · Threads: new daily review");
    const created = (await run("yami-threads-create-session")) as { message: string; open: string };
    expect(picked).toEqual([["The flow of the new Threads session", "Daily review"]]);
    expect(created.open).toMatch(/^threads\/Daily review \d{4}-\d{2}-\d{2} \d{2}-\d{2}\.md$/);
    expect((await readDocument(t.vault, created.open)).properties).toMatchObject({ module: "threads", flow: "daily-review" });

    await t.vault.remove("internal/threads/flows/daily-review/FLOW.md");
    await yami.discover();
    sync();
    expect(names()).not.toContain("yami-threads-new-daily-review · Threads: new daily review");
  });

  it("asks New module for a name with the documented placeholder and hint", async () => {
    const commands = new Map<string, Command>();
    const asked: string[][] = [];
    let done: Promise<unknown> = Promise.resolve();
    const host = {
      plugin: { addCommand: (command: Command) => commands.set(command.id, command) },
      ask: async (placeholder: string, hint: string) => void asked.push([placeholder, hint]),
      notify: (work: Promise<unknown>) => (done = work),
    } as unknown as ObsidianYami;
    addNewModuleCommand(host);
    commands.get("yami-new-module")!.callback!();
    await done;
    expect(asked).toEqual([["The name of the new module, such as Code review", "Create the module"]]);
  });

  it("gives no such command to the threads module that a host leaves out, or to a vault module", async () => {
    t = await testYami({ threads: false });
    await t.yami.createModule("Notes");
    const commands = new Map<string, Command>();
    const host = { get modules() { return t!.yami.modules; }, plugin: { addCommand: (command: Command) => commands.set(command.id, command), removeCommand: () => true } } as unknown as ObsidianYami;
    addModuleCommands(host);
    expect([...commands.keys()].filter((id) => id.includes("-create-"))).toEqual([]);
  });
});

describe("the change commands of the wiki", () => {
  it("approve and reject the open change document while it is proposed, or one picked among the proposals", async () => {
    t = await testYami({ threads: false });
    const { yami, vault } = t;
    await write(`${TOPICS}/Levain.md`, { type: "topic", description: "A starter.", sources: [] }, "x\n");
    const commands = new Map<string, Command>();
    const shown: unknown[] = [];
    const ran: string[] = [];
    const picked: string[][] = [];
    let active: { path: string; basename: string; extension: string } | undefined;
    let done: Promise<void> = Promise.resolve();
    const host = {
      app: { workspace: { getActiveFile: () => active } },
      plugin: { addCommand: (command: Command) => commands.set(command.id, command) },
      wiki: yami.wiki,
      conversationFolder: "conversations",
      properties: async (path: string) => (await readDocument(vault, path)).properties,
      pick: async <T,>(items: T[], label: (item: T) => string, placeholder: string) => (picked.push([placeholder, ...items.map(label)]), items[0]),
      // The commands do each act through `runChangeAct`, whose own test is in yami.test.ts; here it runs the act and records what it said.
      runChangeAct: async (act: ChangeAct) => (ran.push(act.kind), void shown.push(await (act.kind === "reject" ? act.run("C exists.") : act.run()))),
      notify: (work: Promise<unknown>) => (done = work.then((result) => void (result !== undefined && shown.push(result)), (error: Error) => void shown.push(`Yami: ${error.message}`))),
    } as unknown as ObsidianYami;
    // The commands read the properties from Obsidian's cache, which is synchronous; the test reads the vault.
    const properties = new Map<string, Properties>();
    (host as unknown as { properties(path: string): Properties }).properties = (path) => properties.get(path) ?? {};
    const refresh = async (path: string) => properties.set(path, (await readDocument(vault, path)).properties);
    addWikiCommands(host);
    const run = async (id: string, checking = false) => {
      const command = commands.get(id)!;
      const result = command.checkCallback ? command.checkCallback(checking) : (command.callback!(), true);
      await done;
      return result;
    };
    const names = [...commands.values()].filter((c) => c.id.includes("change")).map((c) => `${c.id} · ${c.name}`);
    expect(names).toEqual([
      "yami-wiki-approve-this-change · Wiki: approve this change",
      "yami-wiki-reject-this-change · Wiki: reject this change",
      "yami-wiki-approve-change · Wiki: approve a change",
      "yami-wiki-reject-change · Wiki: reject a change",
    ]);

    // With no proposal, the pick commands say so.
    await run("yami-wiki-approve-change");
    expect(shown.pop()).toBe("No change waits for approval.");
    expect(await run("yami-wiki-approve-this-change", true)).toBe(false);

    const propose = (title: string) => yami.wiki.change({ title, writes: [{ op: "create", path: `${TOPICS}/${title}.md`, properties: { description: `${title}.` }, body: "x" }] });
    const a = await propose("A");
    await refresh(a.path);
    active = { path: `${TOPICS}/Levain.md`, basename: "Levain", extension: "md" };
    expect(await run("yami-wiki-approve-this-change", true)).toBe(false);
    active = { path: a.path, basename: "A", extension: "md" };
    expect(await run("yami-wiki-approve-this-change", true)).toBe(true);
    expect(await run("yami-wiki-reject-this-change", true)).toBe(true);

    await run("yami-wiki-reject-this-change");
    expect(ran).toEqual(["reject"]);
    expect(shown.pop()).toBe("Rejected A.");
    expect((await readDocument(vault, a.path)).properties).toMatchObject({ status: "rejected", reason: "C exists." });
    await refresh(a.path);
    expect(await run("yami-wiki-approve-this-change", true)).toBe(false);

    const b = await propose("B");
    await refresh(b.path);
    active = { path: b.path, basename: "B", extension: "md" };
    await run("yami-wiki-approve-this-change");
    expect(ran).toEqual(["reject", "approve"]);
    expect(shown.pop()).toBe("Applied B: v1 → v2 · 1 created");
    expect(await vault.exists(`${TOPICS}/B.md`)).toBe(true);

    // The pick commands list the proposals with their title, counts, and age, and a refusal shows its reasons.
    const c = await propose("C");
    await write(`${TOPICS}/C.md`, { type: "topic", description: "By hand." }, "x\n");
    await run("yami-wiki-approve-change");
    expect(picked.pop()).toEqual(["The change to approve", "C · 1 created · just now"]);
    expect(shown.pop()).toBe("Yami: The change plan is not valid:\n- write 1 (create wiki/topics/C.md): the note exists; use modify");
    expect((await readDocument(vault, c.path)).properties.status).toBe("proposed");
    await run("yami-wiki-reject-change");
    expect(picked.pop()).toEqual(["The change to reject", "C · 1 created · just now"]);
    expect(shown.pop()).toBe("Rejected C.");
    expect((await readDocument(vault, c.path)).properties.reason).toBe("C exists.");
    expect(ran).toEqual(["reject", "approve", "approve", "reject"]);
  });

  it("says how old a change is in words", () => {
    const now = new Date("2026-10-20T12:00:00");
    expect(age("2026-10-20T11:59:40", now)).toBe("just now");
    expect(age("2026-10-20T11:59:00", now)).toBe("1 minute ago");
    expect(age("2026-10-20T11:35:00", now)).toBe("25 minutes ago");
    expect(age("2026-10-20T09:00:00", now)).toBe("3 hours ago");
    expect(age("2026-10-18T13:00:00", now)).toBe("1 day ago");
    expect(age("not a time", now)).toBe("just now");
  });
});
