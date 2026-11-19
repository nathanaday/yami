import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  TFile: class {
    constructor(public path: string) {}
  },
}));

import { type Plugin, TFile } from "obsidian";
import { installVaultGuard } from "../../../src/obsidian/protected/vault-guard.js";
import { ProtectedStore } from "../../../src/obsidian/protected/store.js";
import { FsVault } from "../../../src/testing/index.js";

const TEXT = "# Levain\n\nLevain is a starter.\n\nMy own words: I feed mine at dawn.\n\nSee Sourdough.\n";
const MINE = "My own words: I feed mine at dawn.";
const FakeFile = TFile as unknown as new (path: string) => TFile;

beforeAll(() => {
  Object.assign(globalThis, { window: globalThis });
});

let root: string;
let store: ProtectedStore;
let text: string;
let notices: string[];
let working: string | undefined;
let write: (next: string) => Promise<void>;
const file = new FakeFile("Levain.md");
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "yami-vault-guard-"));
  store = new ProtectedStore(new FsVault(root), () => "block");
  await store.load();
  text = TEXT;
  notices = [];
  working = undefined;
  const events = new Map<string, ((...args: unknown[]) => void)[]>();
  const fire = (name: string, ...args: unknown[]) => (events.get(name) ?? []).forEach((listener) => listener(...args));
  const app = {
    vault: {
      on: (name: string, listener: (...args: unknown[]) => void) => (events.set(name, [...(events.get(name) ?? []), listener]), {}),
      getFileByPath: (path: string) => (path === file.path ? file : null),
      read: async () => text,
      process: async (_file: TFile, change: (data: string) => string) => {
        const next = change(text);
        if (next !== text) {
          text = next;
          fire("modify", file);
        }
        return text;
      },
    },
  };
  const plugin = { register: () => undefined, registerEvent: () => undefined } as unknown as Plugin;
  installVaultGuard(plugin, app as never, store, (message) => notices.push(message), () => working);
  // A write of the file by an agent's tool, or by another program.
  write = async (next) => {
    text = next;
    fire("modify", file);
    await settle();
  };
});

afterEach(async () => {
  await store.flush();
  await rm(root, { recursive: true, force: true });
});

describe("the vault guard of protected text", () => {
  it("puts a protected text back when a write of the file changes it, and keeps the rest of the write", async () => {
    store.protect(file.path, MINE, TEXT);
    await settle();
    working = "claude";
    await write(TEXT.replace("Levain is a starter.", "Levain is a sourdough starter.").replace(MINE, "I feed it at dawn."));
    expect(text).toBe(TEXT.replace("Levain is a starter.", "Levain is a sourdough starter."));
    expect(notices).toEqual([`Yami kept the protected text in Levain that claude changed: "${MINE}".`]);
  });

  it("puts each of two texts back in its place, and names another program when no agent works", async () => {
    store.protect(file.path, MINE, TEXT);
    store.protect(file.path, "See Sourdough.", TEXT);
    await settle();
    await write("# Levain\n\nLevain is a starter.\n\nRewritten.\n\nGone.\n");
    expect(text).toBe(TEXT);
    expect(notices).toEqual([expect.stringContaining("that another program changed")]);
  });

  it("lets a write pass that keeps the text, and a note with no protected text", async () => {
    await write("anything");
    await write(TEXT);
    store.protect(file.path, MINE, TEXT);
    await settle();
    await write(`${TEXT}\nMore from the agent.\n`);
    expect(text).toBe(`${TEXT}\nMore from the agent.\n`);
    // Unprotected, the text is the writer's to change.
    store.unprotect(file.path);
    await settle();
    await write("All new.\n");
    expect(text).toBe("All new.\n");
    expect(notices).toEqual([]);
  });
});
