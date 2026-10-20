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
import { addModuleCommands } from "../../../src/obsidian/commands.js";
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
    const picked: string[][] = [];
    let done: Promise<void> = Promise.resolve();
    const host = {
      get modules() {
        return yami.modules;
      },
      plugin: { addCommand: (command: Command) => commands.set(command.id, command), removeCommand: (id: string) => commands.delete(id) },
      ask: async () => answer,
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

  it("gives no such command to the threads module that a host leaves out, or to a vault module", async () => {
    t = await testYami({ threads: false });
    await t.yami.createModule("Notes");
    const commands = new Map<string, Command>();
    const host = { get modules() { return t!.yami.modules; }, plugin: { addCommand: (command: Command) => commands.set(command.id, command), removeCommand: () => true } } as unknown as ObsidianYami;
    addModuleCommands(host);
    expect([...commands.keys()].filter((id) => id.includes("-create-"))).toEqual([]);
  });
});
