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
    t = await testYami({ modules: [new Hello()] });
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
    const listed = () => [...commands.values()].map((c) => `${c.id} · ${c.name} · ${c.icon}`);
    expect(listed()).toEqual(["hello-new-greet · Hello world: new greet · box"]);

    await write("internal/notes/notes.md", { type: "module", name: "Notes", icon: "search" });
    await write("internal/notes/flows/daily-note/FLOW.md", { name: "daily-note", description: "A daily note." });
    await yami.discover();
    sync();
    expect(listed()).toEqual(["hello-new-greet · Hello world: new greet · box", "notes-new-daily-note · Notes: new daily note · search"]);
    sync();
    expect(removed).toEqual([]);

    await write("internal/notes/flows/daily-note/FLOW.md", { name: "daily-note", description: "A daily page." });
    await yami.discover();
    sync();
    expect(removed).toEqual(["notes-new-daily-note"]);
    expect(listed()).toContain("notes-new-daily-note · Notes: new daily note · search");

    await t.vault.remove("internal/notes/flows/daily-note/FLOW.md");
    await yami.discover();
    sync();
    expect(listed()).toEqual(["hello-new-greet · Hello world: new greet · box"]);
  });
});
