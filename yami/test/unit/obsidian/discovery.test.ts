import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({}));

import type { Properties } from "../../../src/index.js";
import { watchModules } from "../../../src/obsidian/discovery.js";
import { testYami, type TestYami } from "../../../src/testing/index.js";

beforeAll(() => {
  Object.assign(globalThis, { window: globalThis });
});

let t: TestYami | undefined;
afterEach(async () => {
  await t?.dispose();
  t = undefined;
});

const MODULE = "internal/notes/notes.md";
const TEMPLATE = "internal/notes/templates/Daily.md";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function write(path: string, properties: Properties) {
  await t!.vault.write(path, `---\n${t!.vault.stringifyProperties(properties)}---\n`);
}

/** The vault events and the component of a plugin, as `watchModules` uses them. */
function fakeObsidian() {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  const cleanups: (() => void)[] = [];
  const app = {
    vault: {
      on: (name: string, handler: (...args: unknown[]) => void) => {
        handlers.set(name, [...(handlers.get(name) ?? []), handler]);
        return { name, handler };
      },
    },
  };
  const component = { registerEvent: () => undefined, register: (cleanup: () => void) => void cleanups.push(cleanup) };
  return {
    app: app as never,
    component: component as never,
    fire: (name: string, path: string, old?: string) => handlers.get(name)?.forEach((handler) => handler({ path }, old)),
    unload: () => cleanups.forEach((cleanup) => cleanup()),
  };
}

/** Resolves at the next call of the Yami's `onModulesChange` listeners. */
function nextChange(): Promise<void> {
  return new Promise((resolve) => {
    const stop = t!.yami.onModulesChange(() => {
      stop();
      resolve();
    });
  });
}

describe("watchModules", () => {
  it("discovers again a moment after a module document or a template document is created, changed, or removed", async () => {
    t = await testYami();
    const obsidian = fakeObsidian();
    watchModules(obsidian.app, obsidian.component, t.yami);

    await write(MODULE, { type: "module", name: "Notes" });
    await write(TEMPLATE, { type: "template" });
    let change = nextChange();
    obsidian.fire("create", TEMPLATE);
    await change;
    expect(t.yami.module("notes")?.templates.map((template) => template.name)).toEqual(["Daily"]);

    await write(TEMPLATE, { type: "template", name: "Journal page" });
    change = nextChange();
    obsidian.fire("modify", TEMPLATE);
    await change;
    expect(t.yami.module("notes")?.templates.map((template) => template.name)).toEqual(["Journal page"]);

    await write(MODULE, { type: "module", name: "Daily notes" });
    change = nextChange();
    obsidian.fire("modify", MODULE);
    await change;
    expect(t.yami.module("notes")?.name).toBe("Daily notes");

    await t.vault.remove(TEMPLATE);
    change = nextChange();
    obsidian.fire("delete", TEMPLATE);
    await change;
    expect(t.yami.module("notes")).toBeUndefined();
    obsidian.unload();
  });

  it("ignores a change to another note, makes one discovery of close events, and stops when the component unloads", async () => {
    t = await testYami();
    const discover = vi.spyOn(t.yami, "discover");
    const obsidian = fakeObsidian();
    watchModules(obsidian.app, obsidian.component, t.yami);

    obsidian.fire("modify", "notes/Idea.md");
    obsidian.fire("modify", "internal/notes/policies/Be kind.md");
    await sleep(400);
    expect(discover).not.toHaveBeenCalled();

    // A created, renamed, or removed file can change what a template's link finds.
    obsidian.fire("create", "notes/Idea.md");
    obsidian.fire("rename", "notes/Idea 2.md", "notes/Idea.md");
    obsidian.fire("delete", "notes/Idea 2.md");
    await sleep(400);
    expect(discover).toHaveBeenCalledTimes(1);

    obsidian.fire("create", "notes/Late.md");
    obsidian.unload();
    await sleep(400);
    expect(discover).toHaveBeenCalledTimes(1);
  });
});
