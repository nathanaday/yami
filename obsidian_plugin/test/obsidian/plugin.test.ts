import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { BASE_SKILL, BASE_SKILL_TEXT, VERSION } from "yami";
import { launchObsidian, type ObsidianInstance } from "./harness.js";

const TIMEOUT = 240_000;
const HELLO = "test/fixtures/vault-modules/hello";

/** The Hello fixture as vault paths and texts, as a person would write the files in `internal/hello/`: the flow last, after what it names. */
function helloFiles(): Record<string, string> {
  const files = readdirSync(HELLO, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(HELLO, path.join(entry.parentPath, entry.name)))
    .sort((a, b) => Number(a.startsWith("flows/")) - Number(b.startsWith("flows/")));
  return Object.fromEntries(files.map((file) => [`internal/hello/${file}`, readFileSync(path.join(HELLO, file), "utf8")]));
}

describe("Yami in Obsidian", () => {
  let obsidian: ObsidianInstance;

  beforeAll(async () => {
    obsidian = await launchObsidian();
  }, 60_000);

  afterAll(async () => {
    await obsidian?.close();
  });

  afterEach(async () => {
    // The editor and the shared document must never differ.
    const drift = await obsidian.page.evaluate(() => {
      const app = (window as any).app;
      const hub = app.plugins.plugins.yami?.yami.hub;
      const problems: string[] = [];
      for (const leaf of app.workspace.getLeavesOfType("markdown")) {
        const note = leaf.view.file && hub?.get(leaf.view.file.path);
        if (note && note.views.size && leaf.view.editor.getValue() !== note.content) problems.push(leaf.view.file.path);
      }
      return problems;
    });
    expect(drift).toEqual([]);
  });

  const page = () => obsidian.page;

  /** Waits until no agent works, then for the editor to settle. */
  async function idle(timeout = 180_000) {
    await page().waitForFunction(() => (window as any).app.plugins.plugins.yami.yami.conversations.working.length === 0, undefined, { timeout, polling: 250 });
    await page().waitForTimeout(600);
  }

  async function newConversation(command = "yami:yami-new-conversation-claude") {
    await page().evaluate((id) => (window as any).app.commands.executeCommandById(id), command);
    await page().waitForSelector(".yami-composer textarea", { timeout: 15_000 });
  }

  async function send(message: string) {
    await page().focus(".yami-composer textarea");
    await page().keyboard.type(message);
    await page().keyboard.press("Enter");
    await page().waitForSelector(".yami-composer.is-working", { timeout: 10_000 });
  }

  const activePath = () => page().evaluate(() => (window as any).app.workspace.getActiveFile()?.path as string);
  /**
   * Runs a command once it is available. Right after a note changes, Obsidian's metadata cache can lack the
   * note for a moment, and a command that reads the note's properties is not available then.
   */
  async function run(id: string) {
    await page().waitForFunction(
      (name) => {
        const command = (window as any).app.commands.findCommand(name);
        return command && (command.checkCallback ? command.checkCallback(true) : true);
      },
      id,
      { timeout: 10_000, polling: 100 },
    );
    await page().evaluate((name) => (window as any).app.commands.executeCommandById(name), id);
  }

  /** Puts an instruction in a session's body, and waits until Obsidian's metadata cache has read the note again. */
  async function instruct(path: string, instruction: string) {
    await page().evaluate(
      ({ path, instruction }) =>
        new Promise<void>((resolve) => {
          const app = (window as any).app;
          const file = app.vault.getFileByPath(path);
          const ref = app.metadataCache.on("changed", (changed: any) => {
            if (changed !== file) return;
            app.metadataCache.offref(ref);
            resolve();
          });
          void app.vault.process(file, (text: string) => text.replace("## Deliverables", `${instruction}\n\n## Deliverables`));
        }),
      { path, instruction },
    );
  }

  /** Creates a hello session and waits until it is open and Obsidian has read its properties. */
  async function newGreeting(): Promise<string> {
    const before = await activePath();
    await run("yami:yami-hello-new-greeting");
    await page().waitForFunction(
      (previous) => {
        const app = (window as any).app;
        const file = app.workspace.getActiveFile();
        return file && file.path !== previous && file.path.startsWith("hello/") && app.metadataCache.getFileCache(file)?.frontmatter?.type === "session";
      },
      before,
      { timeout: 10_000 },
    );
    return activePath();
  }

  it("searches, compares, matches, and lints the wiki from the command palette", { timeout: 60_000 }, async () => {
    await page().evaluate(async () => {
      const vault = (window as any).app.vault;
      if (!vault.getFolderByPath("wiki/topics")) await vault.createFolder("wiki/topics");
      await vault.create("wiki/topics/Sourdough.md", "---\ntype: topic\ndescription: Bread from a wild yeast starter.\n---\nA starter ferments. See [[Levain]].\n");
      await vault.create("wiki/topics/Levain.md", "---\ntype: topic\ndescription: A sourdough starter.\naliases: [Starter]\n---\nThe starter of [[Sourdough]]. Also [[Nowhere]].\n");
      await vault.create("Bakery.md", "Bread notes. See [[Sourdough]].\n");
    });
    const command = (id: string) => page().evaluate((name) => (window as any).app.commands.executeCommandById(name), id);
    const open = async (path: string) => {
      await page().evaluate((file) => (window as any).app.workspace.getLeaf().openFile((window as any).app.vault.getFileByPath(file)), path);
      await page().waitForFunction((file) => (window as any).app.workspace.getActiveFile()?.path === file, path);
    };
    const close = async () => {
      await page().keyboard.press("Escape");
      await page().waitForSelector(".modal-container", { state: "detached" });
    };

    // Search: results as the user types, Tab to the next algorithm, Enter opens the note.
    await command("yami:yami-wiki-search");
    await page().keyboard.type("sourdough starter");
    await page().waitForSelector(".yami-wiki-hit .yami-wiki-hit-name");
    const names = () => page().$$eval(".yami-wiki-hit-name", (els) => els.map((el) => el.textContent));
    expect((await names()).slice(0, 2).sort()).toEqual(["Levain", "Sourdough"]);
    expect(await page().textContent(".yami-wiki-status")).toMatch(/^bm25 · \d+ hits in \d+ ms/);
    await page().keyboard.press("Tab");
    await page().waitForFunction(() => document.querySelector(".yami-wiki-status")?.textContent?.startsWith("ppr ·"));
    await page().keyboard.press("Enter");
    await page().waitForSelector(".modal-container", { state: "detached" });
    expect(await activePath()).toMatch(/^wiki\/topics\/(Levain|Sourdough)\.md$/);

    // Related notes start from the active note, with PPR, and list its neighbors with no query.
    await open("wiki/topics/Levain.md");
    await command("yami:yami-wiki-related");
    await page().waitForSelector(".yami-wiki-hit .yami-wiki-hit-name");
    expect(await names()).toContain("Sourdough");
    await close();

    // Compare: one column for each algorithm, and the query from the selection.
    // Line 5 is the first line below the properties: "The starter of [[Sourdough]]".
    await page().evaluate(() => (window as any).app.workspace.activeEditor.editor.setSelection({ line: 5, ch: 4 }, { line: 5, ch: 11 }));
    await command("yami:yami-wiki-compare");
    await page().waitForSelector(".yami-wiki-compare-cell");
    expect(await page().inputValue(".yami-wiki-compare-input")).toBe("starter");
    expect(await page().$$eval(".yami-wiki-compare-results th", (els) => els.slice(1).map((el) => el.firstElementChild?.textContent))).toEqual([
      "bm25",
      "ppr",
      "hop2",
      "louvain",
      "hybrid",
    ]);
    await close();

    // Match: the selection is an alias of Levain.
    await command("yami:yami-wiki-match");
    await page().waitForSelector(".yami-wiki-badge.is-hit");
    expect(await page().textContent(".yami-wiki-list .yami-wiki-hit-name")).toBe("Levain");
    await close();

    // Lint: the dead link in this note, and the vault's findings after a new note, without a rebuild.
    await command("yami:yami-wiki-lint-note");
    await page().waitForSelector(".yami-wiki-badge.is-error");
    expect(await page().textContent(".yami-wiki-badge.is-error")).toBe("dead-link");
    await close();
    await page().evaluate(async () => void (await (window as any).app.vault.create("wiki/topics/Rye.md", "---\ntype: topic\n---\nNo description.\n")));
    await command("yami:yami-wiki-lint-vault");
    await page().waitForSelector(".yami-wiki-list .yami-wiki-hit");
    expect(await page().$$eval(".yami-wiki-list .yami-wiki-hit-meta", (els) => els.some((el) => el.textContent?.startsWith("wiki/topics/Rye.md · has no description")))).toBe(true);
    await close();

    // Snapshot: the first version, its archive, and the versions list.
    await command("yami:yami-wiki-snapshot");
    const snapshot = await obsidian.waitForNote("internal/wiki/snapshots/v1.md", (text) => text.includes("hash:"), 15_000);
    expect(snapshot).toContain("type: snapshot");
    expect(snapshot).toContain("notes: 3");
    expect(readFileSync(path.join(obsidian.vault, "internal/wiki/snapshots/v1.json.gz")).length).toBeGreaterThan(20);
    await command("yami:yami-wiki-versions");
    await page().waitForSelector(".yami-wiki-list .yami-wiki-hit");
    expect(await page().textContent(".yami-wiki-list .yami-wiki-hit-name")).toBe("Version 1");
    await close();

    // Restore: a hand edit is kept as version 2 before version 1 comes back as version 3.
    await page().evaluate(async () => void (await (window as any).app.vault.create("wiki/topics/Spelt.md", "---\ntype: topic\ndescription: Spelt.\n---\nAdded by hand.\n")));
    await command("yami:yami-wiki-restore");
    await page().waitForSelector(".prompt-input");
    await page().keyboard.type("Version 1");
    await page().keyboard.press("Enter");
    const restored = await obsidian.waitForNote("internal/wiki/snapshots/v3.md", (text) => text.includes("restored:"), 15_000);
    expect(restored).toContain("restored: 1");
    expect(await obsidian.read("internal/wiki/snapshots/v2.md")).toContain("notes: 4");
    expect(existsSync(path.join(obsidian.vault, "wiki/topics/Spelt.md"))).toBe(false);

    // Ingest a folder: every file of the picked folder gets a source note, and one session links them.
    await page().evaluate(async () => {
      const vault = (window as any).app.vault;
      await vault.createFolder("Papers");
      await vault.create("Papers/Attention.md", "# Attention\n\nTransformers use attention.\n");
      await vault.create("Papers/Diffusion.md", "# Diffusion\n\nDenoising models.\n");
    });
    await command("yami:yami-wiki-ingest-folder");
    await page().waitForSelector(".prompt-input");
    // The vault root is not a choice.
    expect(await page().$$eval(".suggestion-item", (els) => els.map((el) => el.textContent))).not.toContain("/");
    await page().keyboard.type("Papers");
    await page().keyboard.press("Enter");
    await page().waitForFunction(() => (window as any).app.workspace.getActiveFile()?.path.startsWith("internal/wiki/sessions/Ingest Papers (2 files)"), undefined, { timeout: 10_000 });
    const session = await obsidian.read(await activePath());
    expect(session).toContain("type: session");
    expect(session).toContain("[[wiki/sources/Attention (source)|Attention (source)]]");
    expect(session).toContain("[[wiki/sources/Diffusion (source)|Diffusion (source)]]");
    const source = await obsidian.read("wiki/sources/Attention (source).md");
    expect(source).toContain("status: pending");
    expect(source).toContain("from: \"[[Papers/Attention|Attention]]\"");
    // The note stays where it was, and the source embeds a frozen copy, named by its hash.
    const copy = source.match(/!\[\[(internal\/wiki\/originals\/[0-9a-f]{16}\.md)\]\]/)?.[1];
    expect(copy).toBeDefined();
    expect(await obsidian.read(copy!)).toBe(await obsidian.read("Papers/Attention.md"));
  });

  it("publishes a journal volume, and returns a checkout with the user's edit", { timeout: 60_000 }, async () => {
    const command = (id: string) => page().evaluate((name) => (window as any).app.commands.executeCommandById(name), id);
    for (const module of ["threads", "librarian", "journals"]) await obsidian.waitForNote(`internal/${module}/${module}.md`, (text) => text.length > 0, 10_000);
    expect(existsSync(path.join(obsidian.vault, "internal/threads/agents/validator/AGENT.md"))).toBe(true);

    // Publish: pick the volume; the edition's session opens with a source for each note.
    await page().evaluate(async () => {
      const vault = (window as any).app.vault;
      await vault.createFolder("journals/garden-log");
      await vault.create("journals/garden-log/Tomatoes.md", "Plant after the frost.\n");
    });
    await command("yami:yami-journals-publish");
    await page().waitForSelector(".prompt-input");
    await page().keyboard.type("Garden Log");
    await page().keyboard.press("Enter");
    await page().waitForFunction(() => (window as any).app.workspace.getActiveFile()?.path.startsWith("internal/wiki/sessions/Garden Log edition "), undefined, { timeout: 10_000 });
    const edition = await obsidian.read(await activePath());
    expect(edition).toContain("[[wiki/sources/Tomatoes (source)|Tomatoes (source)]]");
    expect(edition).toContain("[[internal/journals/policies/journal-sources/POLICY|journal-sources]]");

    // Return: a checkout made with the librarian's tool, a copy edited by the user, and the return command.
    const made = await page().evaluate(async () => {
      const app = (window as any).app;
      if (!app.vault.getFolderByPath("wiki/topics")) await app.vault.createFolder("wiki/topics");
      await app.vault.create("wiki/topics/Compost.md", "---\ntype: topic\ndescription: Rotted plant matter.\n---\nCompost feeds the soil.\n");
      const tool = (window as any).yami.agents[0].preferences.tools.tools.find((t: any) => t.name === "librarian_checkout");
      return JSON.parse(await tool.run({ request: "the material on compost", name: "Compost", documents: [{ path: "wiki/topics/Compost.md", why: "the basics" }] }, { signal: new AbortController().signal }));
    });
    await page().evaluate(async (copy) => {
      const app = (window as any).app;
      await app.vault.modify(app.vault.getFileByPath(copy), (await app.vault.read(app.vault.getFileByPath(copy))).replace("feeds the soil", "feeds the soil and holds water"));
    }, made.copies[0]);
    await page().evaluate((file) => (window as any).app.workspace.getLeaf().openFile((window as any).app.vault.getFileByPath(file)), made.session);
    await page().waitForFunction((file) => (window as any).app.metadataCache.getFileCache((window as any).app.vault.getFileByPath(file))?.frontmatter?.status === "out", made.session);
    await command("yami:yami-librarian-return");
    await obsidian.waitForNote(made.session, (text) => text.includes("status: returned"), 15_000);
    expect(await obsidian.read("wiki/topics/Compost.md")).toContain("Compost feeds the soil and holds water.");
    expect(existsSync(path.join(obsidian.vault, made.copies[0]))).toBe(false);
  });

  it("creates the hello module with New module, and the panel shows it with no reload", { timeout: 60_000 }, async () => {
    await obsidian.waitForNote("Yami.base", (text) => text.length > 0, 10_000);
    // A file at the vault root has no folder to create. A slice to the last slash once made "Yami.bas".
    expect(existsSync(path.join(obsidian.vault, "Yami.bas"))).toBe(false);
    await run("yami:open-panel");
    await page().waitForSelector('.yami-panel [data-key="module:threads"]');
    expect(await page().$('.yami-panel [data-key="module:hello"]')).toBeNull();

    await run("yami:yami-new-module");
    await page().waitForSelector(".modal-container input", { timeout: 5_000 });
    await page().keyboard.type("Hello");
    await page().keyboard.press("Enter");
    await page().waitForFunction(() => (window as any).app.workspace.getActiveFile()?.path === "internal/hello/hello.md", undefined, { timeout: 10_000 });
    await page().waitForSelector('.yami-panel [data-key="module:hello"]', { timeout: 10_000 });

    // The person writes Hello over the starter, and removes the starter's flow.
    await page().evaluate(async (files) => {
      const vault = (window as any).app.vault;
      for (const [path, text] of Object.entries(files)) {
        const folder = path.slice(0, path.lastIndexOf("/"));
        if (!vault.getFolderByPath(folder)) await vault.createFolder(folder);
        const file = vault.getFileByPath(path);
        if (file) await vault.modify(file, text);
        else await vault.create(path, text);
      }
      await vault.delete(vault.getFolderByPath("internal/hello/flows/task"), true);
    }, helloFiles());
    await page().waitForSelector('.yami-panel [data-key="module:hello"] .yami-row-name:text-is("Hello world")', { timeout: 10_000 });
    expect(await page().$eval('.yami-panel [data-key="module:hello"] .yami-module-icon svg', (el) => el.classList.contains("lucide-hand"))).toBe(true);
    await page().waitForFunction(() => {
      const commands = (window as any).app.commands.commands;
      return Boolean(commands["yami:yami-hello-new-greeting"]) && !commands["yami:yami-hello-new-task"];
    }, undefined, { timeout: 10_000 });
    expect(await page().$$(".yami-panel .yami-problem-row")).toHaveLength(0);
  });

  it("writes the exchange into the note and names the note", { timeout: TIMEOUT }, async () => {
    await newConversation();
    await send("Read [[Ideas]], then reply with the number of bullets in its first list, as a digit only.");
    await idle();
    const file = await activePath();
    expect(file).toMatch(/^conversations\/\d{4}-\d{2}-\d{2} Read Ideas, then reply with the number/);
    const text = await obsidian.waitForNote(file, () => true);
    expect(text).toMatch(/^---\ntype: conversation\nagent: claude\n/);
    expect(text).toMatch(/\nsession: [0-9a-f-]{36}\n/);
    expect(text).toContain("> [!user]\n> Read [[Ideas]], then reply");
    expect(text).toMatch(/> \[!activity\]- .*Read a file.*\n> - Read \[\[Ideas\]\]/);
    expect(text).toMatch(/\n\d\n\n$/);
  });

  it("asks in the message box before an edit, and edits an open note while the user types in it", { timeout: TIMEOUT }, async () => {
    const chat = await activePath();
    // Open Reading list next to the conversation, with the cursor at its end.
    await page().evaluate(async () => {
      const app = (window as any).app;
      const chatLeaf = app.workspace.activeLeaf;
      const leaf = app.workspace.getLeaf("split", "vertical");
      await leaf.openFile(app.vault.getAbstractFileByPath("Reading list.md"), { state: { mode: "source" } });
      app.workspace.setActiveLeaf(chatLeaf, { focus: true });
    });
    await send('Use your Edit tool to replace the first line of [[Reading list]] with "# Books". Then reply with: Done.');
    await page().waitForSelector(".yami-composer.has-approval", { timeout: 90_000 });
    expect(await page().textContent(".yami-approval")).toContain("claude wants to change a file");
    // Type in the open note while the agent waits for approval and then edits it.
    const typed = " Typed while the agent edits.";
    await page().evaluate(() => {
      const app = (window as any).app;
      const leaf = app.workspace.getLeavesOfType("markdown").find((l: any) => l.view.file?.path === "Reading list.md");
      app.workspace.setActiveLeaf(leaf, { focus: true });
      const editor = leaf.view.editor;
      editor.setCursor({ line: editor.lastLine(), ch: editor.getLine(editor.lastLine()).length });
    });
    await page().keyboard.type(typed, { delay: 40 });
    await page().evaluate((file) => {
      const app = (window as any).app;
      app.workspace.setActiveLeaf(
        app.workspace.getLeavesOfType("markdown").find((l: any) => l.view.file?.path === file),
        { focus: true },
      );
    }, chat);
    await page().focus(".yami-composer textarea");
    await page().keyboard.press("y");
    await idle();
    const list = await obsidian.waitForNote("Reading list.md", () => true);
    expect(list.split("\n")[0]).toBe("# Books");
    expect(list.trimEnd().endsWith(typed.trim())).toBe(true);
    await page().waitForTimeout(2500);
    expect(await obsidian.read("Reading list.md")).toBe(list);
    expect(await obsidian.waitForNote(chat, () => true)).toMatch(/> \[!activity\]- .*Edited a file[\s\S]*```diff/);
  });

  it("shows the agent's questions in the message box and sends the answers", { timeout: TIMEOUT }, async () => {
    const chat = await activePath();
    await send(
      "Make one AskUserQuestion tool call with two questions: first which fruit to add, with the options Apple and Pear; then which color, with the options Red and Green. Then reply with only my two answers in capitals, separated by one space.",
    );
    await page().waitForSelector(".yami-composer.has-approval .yami-questions", { timeout: 90_000 });
    expect(await page().textContent(".yami-approval")).toContain("claude asks you");
    const visible = () => page().$$eval(".yami-question", (sets) => sets.filter((set) => !(set as HTMLElement).hidden).map((set) => set.textContent));
    expect(await visible()).toEqual([expect.stringContaining("Pear")]);
    expect(await page().textContent(".yami-question-progress")).toBe("1 of 2");
    await page().click('.yami-question:not([hidden]) .yami-question-option:has-text("Pear")');
    await page().waitForFunction(() => document.querySelector(".yami-question-progress")?.textContent === "2 of 2");
    expect(await visible()).toEqual([expect.stringContaining("Green")]);
    await page().click(".yami-question:not([hidden]) .yami-question-other");
    await page().keyboard.type("Blue");
    await page().keyboard.press("Enter");
    await page().waitForSelector(".yami-composer:not(.has-approval)", { timeout: 10_000 });
    await idle();
    const text = await obsidian.waitForNote(chat, () => true);
    expect(text).toMatch(/> - Asked you questions\n>\s+- .*→ Pear\n>\s+- .*→ Blue\n/);
    expect(text).toMatch(/\nPEAR BLUE\.?\n\n$/);
  });

  it("applies a new approval mode to the request that waits", { timeout: TIMEOUT }, async () => {
    const chat = await activePath();
    await page().evaluate(() => (window as any).app.vault.setConfig("nativeMenus", false));
    await send('Use your Edit tool to replace the first line of [[Ideas]] with "# Ideas, revised". Then use it again to replace that line with "# Ideas, revised twice". Then reply with: Done.');
    await page().waitForSelector(".yami-composer.has-approval", { timeout: 90_000 });
    await page().click('.yami-chip:has(.yami-chip-label:text-is("Ask first"))');
    await page().click('.menu .menu-item:has-text("Accept edits")');
    await idle();
    expect(await page().$(".yami-composer.has-approval")).toBeNull();
    expect(readFileSync(path.join(obsidian.vault, "Ideas.md"), "utf8").split("\n")[0]).toBe("# Ideas, revised twice");
    expect(await obsidian.waitForNote(chat, () => true)).toContain("\napproval: accept-edits\n");
  });

  it("ends the conversation and keeps the note as a record", { timeout: TIMEOUT }, async () => {
    const chat = await activePath();
    await page().focus(".yami-composer textarea");
    await page().keyboard.type("/end");
    await page().keyboard.press("Escape");
    await page().keyboard.press("Enter");
    await page().waitForSelector(".yami-composer.is-ended", { timeout: 10_000 });
    expect(await obsidian.waitForNote(chat, (text) => text.includes("status: ended"), 5000)).toContain("status: ended");
  });

  it("talks to Codex in a Codex conversation", { timeout: TIMEOUT }, async () => {
    await newConversation("yami:yami-new-conversation-codex");
    await send("Reply with exactly the word: kiwi");
    await idle();
    const text = await obsidian.waitForNote(await activePath(), () => true);
    expect(text).toMatch(/^---\ntype: conversation\nagent: codex\n/);
    expect(text).toMatch(/\nkiwi\.?\n\n$/i);
  });

  it("calls a module tool from both agents", { timeout: TIMEOUT }, async () => {
    for (const command of ["yami:yami-new-conversation-claude", "yami:yami-new-conversation-codex"]) {
      await newConversation(command);
      await send("Call the status tool of the threads module with no thread, then reply with only the number of open threads that it listed, as a digit.");
      await idle();
      const text = await obsidian.waitForNote(await activePath(), () => true);
      // Codex sometimes calls the tool twice, or first reads a module skill, which needs no approval;
      // the plumbing, not the count, is under test.
      expect(text, command).toMatch(/> \[!activity\]- (.+ · )?Used (a tool|\d tools)\n/);
      expect(text, command).toContain("> - `List the open threads`\n");
      expect(text, command).not.toContain("yami-permission");
      expect(text, command).toMatch(/\n0\.?\n\n$/);
    }
  });

  it("starts a conversation for another plugin and reports its turns", { timeout: TIMEOUT }, async () => {
    const result = await page().evaluate(async () => {
      const app = (window as any).app;
      const conversations = app.plugins.plugins.yami.yami.conversations;
      const file = await conversations.start({ message: "Reply with exactly the word: plum", title: "From another plugin", folder: "Agents" });
      const working = conversations.status(file.path);
      const turn = await new Promise((resolve) => {
        const stop = conversations.onTurnEnd(file.path, (ended: unknown) => {
          stop();
          resolve(ended);
        });
      });
      return { path: file.path, working, turn, after: conversations.status(file.path), active: app.workspace.getActiveFile()?.path };
    });
    expect(result).toEqual({
      path: "Agents/From another plugin.md",
      working: "working",
      turn: { path: "Agents/From another plugin.md", status: "completed", text: expect.stringMatching(/plum/i) },
      after: "active",
      active: "Agents/From another plugin.md",
    });
    const text = await obsidian.waitForNote(result.path, () => true);
    expect(text).toMatch(/^---\ntype: conversation\nagent: claude\n/);
    expect(text).toMatch(/\nplum\.?\n\n$/i);
  });

  it("colors each module's folder, its internal folder muted, and internal/ gray", async () => {
    const colors = await page().evaluate(async () => {
      const app = (window as any).app;
      const yami = app.plugins.plugins.yami.yami;
      for (const folder of ["hello", "librarian", "wiki"]) if (!app.vault.getFolderByPath(folder)) await app.vault.createFolder(folder);
      const explorer = app.workspace.getLeavesOfType("file-explorer")[0].view;
      explorer.revealInFolder(app.vault.getFileByPath("internal/hello/hello.md"));
      await new Promise((resolve) => setTimeout(resolve, 300));
      const shown = (path: string) => {
        const title = document.querySelector(`.nav-folder-title[data-path="${path}"]`);
        return title ? getComputedStyle(title).color : "no title";
      };
      const hello = yami.module("hello").colors;
      return {
        shown: ["internal", "hello", "internal/hello", "librarian", "wiki"].map(shown),
        expected: ["#8a8a8a", hello.folder, hello.internal, "#a0522d", "#00a2c7"],
      };
    });
    const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
    expect(colors.shown).toEqual(colors.expected.map(rgb));
  });

  it("shows each module in the panel with its icon and its sessions in a line, and gives its commands the icon", async () => {
    await run("yami:open-panel");
    await page().waitForSelector(".yami-panel .yami-module-row");
    const rows = () =>
      page().$$eval(".yami-panel .yami-module-row", (els) =>
        els.map((el) => ({
          key: el.getAttribute("data-key"),
          icon: [...(el.querySelector(".yami-module-icon svg")?.classList ?? [])].find((c) => c.startsWith("lucide-")),
          line: el.querySelector(".yami-row-sub")?.textContent,
          badge: el.querySelector(".yami-badge")?.textContent ?? null,
          label: el.getAttribute("aria-label"),
        })),
      );
    const icons = Object.fromEntries((await rows()).map((r) => [r.key, r.icon]));
    expect(icons).toEqual({ "module:wiki": "lucide-book-open", "module:hello": "lucide-hand", "module:threads": "lucide-spool", "module:librarian": "lucide-library", "module:journals": "lucide-notebook-pen" });
    expect(await page().$$(".yami-panel .yami-row-desc")).toHaveLength(0);
    expect((await rows()).find((r) => r.key === "module:journals")).toMatchObject({ line: "Publish a volume", badge: null });

    // A session that needs attention is the badge. The line leaves it out, unless it is all there is; the label says every count.
    const create = (name: string, state?: string) =>
      page().evaluate(
        async ([name, state]) => {
          const app = (window as any).app;
          const session = await app.plugins.plugins.yami.yami.module("hello").flowOf("greeting").create({ name });
          if (state) await app.fileManager.processFrontMatter(app.vault.getFileByPath(session.path), (fm: any) => (fm.state = state));
          return session.path as string;
        },
        [name, state] as const,
      );
    const hello = async () => (await rows()).find((r) => r.key === "module:hello")!;
    const waiting = await create("Waiting greeting", "needs-attention");
    await page().waitForSelector('.yami-panel [data-key="module:hello"] .yami-badge');
    expect(await hello()).toMatchObject({ badge: "1", line: "1 needs attention", label: "Hello world: 1 needs attention" });
    const fresh = await create("Fresh greeting");
    await page().waitForFunction(() => document.querySelector('.yami-panel [data-key="module:hello"] .yami-row-sub')?.textContent === "1 not started");
    expect(await hello()).toMatchObject({ badge: "1", label: "Hello world: 1 needs attention · 1 not started" });
    await page().evaluate((paths) => Promise.all(paths.map((p) => (window as any).app.vault.delete((window as any).app.vault.getFileByPath(p)))), [waiting, fresh]);
    await page().waitForSelector('.yami-panel [data-key="module:hello"]:not(:has(.yami-badge))');

    // An icon that Obsidian does not have shows the default instead of nothing.
    const fallback = await page().evaluate(async () => {
      const app = (window as any).app;
      const threads = app.plugins.plugins.yami.yami.module("threads");
      threads.icon = "not-an-icon";
      app.workspace.getLeavesOfType("yami-panel")[0].view.go({ level: "modules" });
      await new Promise((resolve) => setTimeout(resolve, 300));
      threads.icon = "spool";
      return document.querySelector('.yami-panel [data-key="module:threads"] .yami-module-icon svg')?.classList.contains("lucide-box");
    });
    expect(fallback).toBe(true);

    const commandIcons = await page().evaluate(() => {
      const commands = (window as any).app.commands.commands;
      return ["hello-new-greeting", "librarian-return", "journals-publish", "wiki-ingest-file"].map((id) => commands[`yami:yami-${id}`]?.icon);
    });
    expect(commandIcons).toEqual(["hand", "library", "notebook-pen", undefined]);
  });

  it("shows the modules, a module's sessions, and a session in the panel, and runs the session from it", { timeout: TIMEOUT }, async () => {
    await run("yami:open-panel");
    await page().waitForSelector(".yami-panel .yami-module-row");
    const names = () => page().$$eval(".yami-panel .yami-row-name", (els) => els.map((el) => el.textContent));
    expect(await names()).toEqual(expect.arrayContaining(["Wiki", "Hello world", "Threads", "Librarian", "Journals"]));
    const focused = () => page().evaluate(() => document.activeElement?.getAttribute("data-key") ?? document.activeElement?.textContent);

    // The keyboard: Enter goes in with the focus on Back, and Backspace comes out with the focus on the row it left.
    await page().focus('.yami-panel [data-key="module:hello"]');
    await page().keyboard.press("Enter");
    await page().waitForSelector('.yami-panel .yami-panel-title:text-is("Hello world")');
    expect(await focused()).toBe("back");
    await page().keyboard.press("Backspace");
    await page().waitForSelector('.yami-panel .yami-panel-title:text-is("Modules")');
    expect(await focused()).toBe("module:hello");

    // A module with no sessions shows its actions only.
    await page().click('.yami-module-row:has-text("Journals")');
    await page().waitForSelector('.yami-panel button:has-text("Publish a volume")');
    expect(await page().textContent(".yami-panel .yami-panel-empty")).toBe("Journals keeps no sessions.");
    await page().click(".yami-panel .yami-back");

    // New greeting creates a session, and the change feed puts it in the list.
    await page().click('.yami-module-row:has-text("Hello world")');
    const before = await page().$$eval(".yami-panel .yami-session-row", (rows) => rows.length);
    await page().click('.yami-panel button:has-text("New greeting")');
    await page().waitForFunction((n) => document.querySelectorAll(".yami-panel .yami-session-row").length === n + 1, before, { timeout: 10_000 });
    const session = await activePath();
    const name = session.slice("hello/".length, -3);
    const row = `.yami-session-row:has(.yami-row-name:text-is("${name}"))`;
    expect(await page().textContent(`${row} .yami-row-meta span`)).toBe("Not started");

    // The session's page: its documents, each of which opens.
    await page().click(row);
    await page().waitForSelector(".yami-panel .yami-state-label");
    expect(await page().textContent(".yami-panel .yami-panel-title")).toBe(name);
    expect(await page().$$eval(".yami-panel .yami-section-head h3", (els) => els.map((el) => el.textContent))).toEqual(["Promises", "Policies", "Skills", "Agents"]);
    // The meta line names the flow by its title, and each document's row gives its description before any check.
    expect(await page().$$eval(".yami-panel .yami-state .yami-row-meta span", (els) => els.map((el) => el.textContent))).toContain("Greeting");
    expect(await page().textContent('.yami-panel .yami-row:has-text("proofreader") .yami-row-desc')).toBe("Reads one greeting note and says whether it is one line, the greeting, a comma, and a name.");
    await page().click('.yami-panel .yami-row:has-text("always-say-hello")');
    await page().waitForFunction(() => (window as any).app.workspace.getActiveFile()?.path === "internal/hello/policies/always-say-hello/POLICY.md");

    // Run it from the panel: the mark turns while the agent works, and the page shows the end.
    await page().click('.yami-panel button:has-text("Run with Claude")');
    await page().waitForSelector('.yami-panel .yami-state .yami-mark[data-status="working"]', { timeout: 30_000 });
    // Run became Stop; the focus moved to it instead of leaving the panel.
    await page().waitForFunction(() => document.activeElement?.textContent === "Stop", undefined, { timeout: 5_000 });
    // The checks pass, then a reviewer judges the policy, and the page shows the review as it goes.
    await page().waitForSelector('.yami-panel .yami-state .yami-mark[data-status="reviewing"]', { timeout: 180_000 });
    expect(await page().textContent(".yami-panel .yami-state-label")).toBe("Reviewing");
    await page().waitForSelector('.yami-panel [data-key="review"]', { timeout: 30_000 });
    await page().waitForFunction(() => document.querySelector(".yami-panel .yami-state-label")?.textContent === "Done", undefined, { timeout: 180_000, polling: 250 });
    expect(await page().textContent('.yami-panel .yami-row:has-text("greeting-note") .yami-row-note')).toBe("Met");
    expect(await page().textContent('.yami-panel .yami-row:has-text("always-say-hello") .yami-row-note')).toBe("Followed");
    expect(await page().textContent('.yami-panel .yami-row:has-text("greeting-note") .yami-row-desc')).toBe(`found greetings/${name}.md`);
    expect((await page().textContent('.yami-panel .yami-row:has-text("always-say-hello") .yami-row-desc'))?.length).toBeGreaterThan(0);
    expect(await page().textContent('.yami-panel .yami-section:has(h3:text-is("Policies")) .yami-section-count')).toBe("1 of 1 followed");
    expect(await page().$$eval(".yami-panel .yami-section-head h3", (els) => els.map((el) => el.textContent))).toEqual(["Promises", "Policies", "Skills", "Agents", "Conversation", "Progress"]);
    expect(await page().$$eval('.yami-panel .yami-section:has(h3:text-is("Conversation")) .yami-row', (els) => els.map((el) => el.getAttribute("data-key")))).toEqual(["conversation", "review"]);
    expect(await page().textContent(".yami-panel .yami-progress li")).toContain("iteration 1: review: 1 followed, 0 broken");
    expect(await page().$$eval(".yami-panel .yami-action", (els) => els.map((el) => el.textContent))).toEqual(["Run with Claude", "Run with Codex", "Resume"]);

    // Every icon drew: a name Obsidian does not know leaves an empty element.
    expect(await page().$$eval(".yami-panel .yami-row-icon, .yami-panel .yami-action-icon, .yami-panel .clickable-icon", (els) => els.filter((el) => !el.querySelector("svg")).length)).toBe(0);
    await page().click(".yami-panel .yami-back");
    await page().waitForSelector(`${row} .yami-mark[data-status="done"]`);
  });

  it("walks the wiki by its tags in the navigator, and follows the open note", { timeout: 60_000 }, async () => {
    await page().evaluate(async () => {
      const vault = (window as any).app.vault;
      await vault.createFolder("Tagged");
      const note = (name: string, tags: string[], description: string) => vault.create(`Tagged/${name}.md`, `---\ndescription: ${description}\ntags: [${tags.join(", ")}]\n---\n${name}.\n`);
      await note("Learning", ["ml"], "How machines learn.");
      await note("Vision", ["ml/vision"], "How machines see.");
      await note("Detection", ["ml/vision/detection"], "Finding objects in an image.");
      await note("Bread", ["cooking"], "Flour, water, and time.");
      const app = (window as any).app;
      await app.workspace.getLeaf().openFile(app.vault.getFileByPath("Tagged/Vision.md"));
    });
    await run("yami:open-wiki-navigator");
    const nav = ".yami-navigator";
    /** Waits for the navigator's title, and says what it shows instead when the wait ends. */
    const titled = async (text: string, timeout = 15_000) => {
      try {
        await page().waitForFunction(([sel, want]) => document.querySelector(`${sel} .yami-panel-title`)?.textContent === want, [nav, text] as const, { timeout, polling: 100 });
      } catch {
        const seen = await page().evaluate((sel) => {
          const app = (window as any).app;
          const leaves = app.workspace.getLeavesOfType("yami-wiki-navigator");
          const view = leaves[0]?.view;
          return JSON.stringify({ leaves: leaves.length, shown: view?.containerEl?.isShown?.(), stale: view?.stale, place: view?.place, title: document.querySelector(`${sel} .yami-panel-title`)?.textContent, active: app.workspace.getActiveFile()?.path });
        }, nav);
        throw new Error(`The navigator never showed "${text}": ${seen}`);
      }
    };
    const title = () => page().textContent(`${nav} .yami-panel-title`);
    const heads = () => page().$$eval(`${nav} .yami-section-head h3`, (els) => els.map((el) => el.textContent));
    const rows = (heading: string) =>
      page().$$eval(`${nav} .yami-section`, (sections, h) => sections.filter((s) => s.querySelector("h3")?.textContent === h).flatMap((s) => [...s.querySelectorAll(".yami-row-name")].map((el) => el.textContent)), heading);
    await titled("Vision");

    // A note: the tags above its own, its own, and the tags below.
    expect(await heads()).toEqual(["Above", "Tags", "Below"]);
    expect(await rows("Above")).toEqual(["ml"]);
    expect(await rows("Tags")).toEqual(["ml/vision"]);
    expect(await rows("Below")).toEqual(["ml/vision/detection"]);

    // Following the editor never takes the focus from it.
    await page().evaluate(async () => {
      const app = (window as any).app;
      await app.workspace.getLeaf().openFile(app.vault.getFileByPath("Tagged/Learning.md"));
      app.workspace.activeEditor?.editor?.focus();
    });
    await titled("Learning");
    expect(await page().evaluate((sel) => Boolean(document.activeElement?.closest(sel)), nav)).toBe(false);
    expect(await rows("Below")).toEqual(["ml/vision"]);

    // A tag: the tags above it, below it, and its notes. A note opens, and the navigator follows it.
    await page().click(`${nav} .yami-section:has(h3:text-is("Below")) .yami-row`);
    await titled("vision");
    expect(await page().$$eval(`${nav} .yami-tag-trail button`, (els) => els.map((el) => el.textContent))).toEqual(["ml"]);
    expect(await rows("Below")).toEqual(["ml/vision/detection"]);
    expect(await rows("Notes")).toEqual(["Vision"]);
    await page().click(`${nav} .yami-section:has(h3:text-is("Below")) .yami-row`);
    await titled("detection");
    await page().click(`${nav} .yami-note-row:has-text("Detection")`);
    await page().waitForFunction(() => (window as any).app.workspace.getActiveFile()?.path === "Tagged/Detection.md");
    await titled("Detection");
    expect(await rows("Above")).toEqual(["ml", "ml/vision"]);

    // Back goes to the place before; Wiki goes to the top.
    await page().click(`${nav} .yami-back`);
    await titled("detection");
    await page().click(`${nav} .yami-breadcrumb-part:text-is("Wiki")`);
    await titled("Wiki");
    expect(await rows("Tags")).toEqual(expect.arrayContaining(["ml", "cooking"]));
    expect(await page().$$eval(`${nav} .yami-row-icon, ${nav} .clickable-icon`, (els) => els.filter((el) => !el.querySelector("svg")).length)).toBe(0);

    // Live: a tag that the shown note gains moves it at once, and a rename keeps the navigator on it.
    await page().evaluate(async () => {
      const app = (window as any).app;
      await app.workspace.getLeaf().openFile(app.vault.getFileByPath("Tagged/Bread.md"));
    });
    await titled("Bread");
    expect(await rows("Tags")).toEqual(["cooking"]);
    await page().evaluate(async () => {
      const app = (window as any).app;
      await app.fileManager.processFrontMatter(app.vault.getFileByPath("Tagged/Bread.md"), (fm: any) => (fm.tags = ["cooking/bread"]));
    });
    await page().waitForFunction((sel) => [...document.querySelectorAll(`${sel} .yami-row-name`)].some((el) => el.textContent === "cooking/bread"), nav, { timeout: 10_000 });
    expect(await rows("Above")).toEqual(["cooking"]);
    expect(await rows("Tags")).toEqual(["cooking/bread"]);
    await page().evaluate(async () => {
      const app = (window as any).app;
      // A name no other note has: an earlier test made a Sourdough topic, and a rename onto a taken name waits for the person.
      await app.fileManager.renameFile(app.vault.getFileByPath("Tagged/Bread.md"), "Tagged/Rye loaf.md");
    });
    await titled("Rye loaf");
    expect(await rows("Tags")).toEqual(["cooking/bread"]);
  });

  it("offers the commands of the sessions, the flows, and the actions", async () => {
    const ids = await page().evaluate(() => Object.keys((window as any).app.commands.commands).filter((id) => id.startsWith("yami:")));
    for (const id of ["run-session-claude", "run-session-codex", "resume-session", "stop-session", "kill-session", "hello-new-greeting", "librarian-new-checkout", "librarian-return", "journals-publish", "wiki-ingest-file", "wiki-search"]) {
      expect(ids, id).toContain(`yami:yami-${id}`);
    }
    for (const id of ["open-panel", "open-wiki-navigator"]) expect(ids, id).toContain(`yami:${id}`);
    // A thread's document holds sections only the tools write, and the wiki's ingest starts from files.
    expect(ids).not.toContain("yami:yami-threads-new-thread");
    expect(ids).not.toContain("yami:yami-wiki-new-ingest");
  });

  it("runs a hello session from its document, also with a note elsewhere whose properties do not parse", { timeout: TIMEOUT }, async () => {
    // An old note of another tool, with a value that holds ": " and no quotes.
    await page().evaluate(async () => {
      const vault = (window as any).app.vault;
      if (!vault.getFolderByPath("tool")) await vault.createFolder("tool");
      await vault.create("tool/Old session.md", "---\ndescription: Fix a scroll stop: the editor counted as out of view.\n---\nAn old note.\n");
    });
    const session = await newGreeting();
    await run("yami:yami-run-session-claude");
    const doc = await obsidian.waitForNote(session, (text) => /state: (done|failed|needs-attention)/.test(text), 180_000);
    expect(doc).toContain("state: done");
    expect(doc).toContain("flow: greeting");
    expect(doc).toContain("- [x] [[internal/hello/promises/greeting-note/PROMISE|greeting-note]]");
    expect(doc).toContain('\nfollowed:\n  - "[[internal/hello/policies/always-say-hello/POLICY|always-say-hello]]"\n');
    expect(doc).toMatch(/\nreview: "\[\[conversations\//);
    expect(doc).toContain("## Review\n- followed: [[internal/hello/policies/always-say-hello/POLICY|always-say-hello]] — ");
    const conversation = doc.match(/\nconversation: "\[\[(conversations\/[^|\]]+)\|/)?.[1];
    expect(conversation).toBeTruthy();
    const record = await obsidian.waitForNote(`${conversation}.md`, (text) => text.includes("> [!user]"), 10_000);
    expect(record).toMatch(/^---\ntype: conversation\nagent: claude\n/);
    expect(record).toContain(`module: "[[${session.replace(/\.md$/, "")}]]"`);
  });

  it("runs an agent of the module through the agent tool from a real Claude session", { timeout: TIMEOUT }, async () => {
    const name = "Proofread greeting";
    const session = await page().evaluate(async (name) => {
      const app = (window as any).app;
      const flow = app.plugins.plugins.yami.yami.module("hello").flowOf("greeting");
      const created = await flow.create({
        name,
        request: `Write the greeting note. Then call yami_agent with the agent proofreader and the task "Read greetings/${name}.md and check it." Quote its answer in your last message.`,
      });
      await app.workspace.getLeaf().openFile(app.vault.getFileByPath(created.path));
      return created.path as string;
    }, name);
    await page().waitForFunction((path) => (window as any).app.workspace.getActiveFile()?.path === path, session);
    await run("yami:yami-run-session-claude");
    const doc = await obsidian.waitForNote(session, (text) => /state: (done|failed|needs-attention)/.test(text), 180_000);
    expect(doc).toContain("state: done");
    expect(doc).toContain("[[internal/hello/agents/proofreader/AGENT|proofreader]]");

    // The agent ran in a conversation of its own, which links the session, with the brief and the task as its message.
    const note = await obsidian.waitForNote(`conversations/hello ${name} proofreader.md`, (text) => text.includes("> [!user]"), 10_000);
    expect(note).toMatch(/^---\ntype: conversation\nagent: claude\n/);
    expect(note).toContain(`module: "[[${session.replace(/\.md$/, "")}]]"`);
    expect(note).toContain(`Read greetings/${name}.md and check it.`);

    // The session document lists the run, and the panel shows it in the Conversation section.
    const runs = await page().evaluate(async (path) => (await (window as any).app.plugins.plugins.yami.yami.session(path).details()).agentRuns, session);
    expect(runs).toEqual([{ agent: "hello:proofreader", conversation: `conversations/hello ${name} proofreader.md`, status: "done" }]);
    await run("yami:open-panel");
    await page().evaluate((path) => (window as any).app.workspace.getLeavesOfType("yami-panel")[0].view.go({ level: "session", module: "hello", path }), session);
    const agentRow = `.yami-panel [data-key="agent:conversations/hello ${name} proofreader.md"]`;
    await page().waitForSelector(agentRow);
    expect(await page().textContent(`${agentRow} .yami-row-note`)).toBe("Done");
  });

  it("kills a session's agent while it starts, and in the middle of a turn, and the session ends stopped", { timeout: TIMEOUT }, async () => {
    const conversationOf = async (session: string) =>
      (await obsidian.waitForNote(session, (text) => /\nconversation: "\[\[conversations\//.test(text), 60_000)).match(/\nconversation: "\[\[(conversations\/[^|\]]+)\|/)![1]!;

    // While the agent starts: the kill closes the session that is starting, and the turn that would follow never runs.
    const starting = await newGreeting();
    await run("yami:yami-run-session-claude");
    const first = `${await conversationOf(starting)}.md`;
    await page().waitForFunction(
      (path) => {
        const app = (window as any).app;
        const file = app.vault.getFileByPath(path);
        return file && app.plugins.plugins.yami.yami.conversations.controller(file)?.phase === "starting";
      },
      first,
      { timeout: 30_000, polling: 50 },
    );
    await run("yami:yami-kill-session");
    expect(await obsidian.waitForNote(starting, (text) => /state: (stopped|done|failed|needs-attention)/.test(text), 60_000)).toContain("state: stopped");

    // In the middle of a turn: the harness session closes at once.
    const working = await newGreeting();
    await instruct(working, "Before anything else, run the shell command `sleep 30` with your Bash tool. Then write the greeting note.");
    await page().evaluate(() => {
      (window as any).__allow = setInterval(() => (document.querySelector(".yami-permission .mod-cta") as HTMLElement | null)?.click(), 200);
    });
    try {
      await run("yami:yami-run-session-claude");
      const second = `${await conversationOf(working)}.md`;
      await page().waitForFunction((path) => ((window as any).app.plugins.plugins.yami.yami.hub.get(path)?.content ?? "").includes("sleep 30"), second, { timeout: 120_000, polling: 200 });
      await run("yami:yami-kill-session");
      const killed = await obsidian.waitForNote(working, (text) => /state: (stopped|done|failed|needs-attention)/.test(text), 30_000);
      expect(killed).toContain("state: stopped");
      expect(killed).toMatch(/iteration 1: 0 met, 1 unmet; stopped/);
    } finally {
      await page().evaluate(() => clearInterval((window as any).__allow));
    }
    expect(await page().evaluate(() => (window as any).app.plugins.plugins.yami.yami.running.length)).toBe(0);
  });

  it("stops a session's run in the middle of a turn, and resumes it in the same conversation", { timeout: TIMEOUT }, async () => {
    const session = await newGreeting();
    // A long first act, so the turn is still going when the person stops it.
    await instruct(session, "Before anything else, run the shell command `sleep 30` with your Bash tool. Then write the greeting note.");
    // The person allows each request; the user's own permission rules may also allow the command.
    await page().evaluate(() => {
      (window as any).__allow = setInterval(() => (document.querySelector(".yami-permission .mod-cta") as HTMLElement | null)?.click(), 200);
    });
    try {
      await run("yami:yami-run-session-claude");
      const conversation = (await obsidian.waitForNote(session, (text) => /\nconversation: "\[\[conversations\//.test(text), 60_000)).match(/\nconversation: "\[\[(conversations\/[^|\]]+)\|/)![1]!;
      await page().waitForFunction(
        (path) => ((window as any).app.plugins.plugins.yami.yami.hub.get(path)?.content ?? "").includes("sleep 30"),
        `${conversation}.md`,
        { timeout: 120_000, polling: 200 },
      );
      expect(await page().evaluate(() => (window as any).app.commands.findCommand("yami:yami-resume-session").checkCallback(true))).toBe(false);
      await run("yami:yami-stop-session");
      const stopped = await obsidian.waitForNote(session, (text) => /state: (stopped|done|failed|needs-attention)/.test(text), 60_000);
      expect(stopped).toContain("state: stopped");
      expect(stopped).toMatch(/iteration 1: 0 met, 1 unmet; stopped/);
      expect(await page().evaluate(() => (window as any).app.plugins.plugins.yami.yami.running.length)).toBe(0);

      await run("yami:yami-resume-session");
      const done = await obsidian.waitForNote(session, (text) => /state: (done|failed|needs-attention)/.test(text), 180_000);
      expect(done).toContain("state: done");
      expect(done).toContain(`conversation: "[[${conversation}|`);
      // The run's prompt, then the resume's check feedback. A later turn that misses a check, or a review that finds a policy broken, sends its feedback too.
      const record = await obsidian.read(`${conversation}.md`);
      const prompts = [...record.matchAll(/> \[!user\]\n> (.*)/g)].map((m) => m[1]);
      expect(prompts.slice(0, 2), record).toEqual([expect.stringMatching(/^\/yami:run This is the Yami session/), "Yami checked the promises after your last turn."]);
      for (const prompt of prompts.slice(2)) expect(["Yami checked the promises after your last turn.", "A reviewer judged your work after your last turn."], record).toContain(prompt);
    } finally {
      await page().evaluate(() => clearInterval((window as any).__allow));
    }
  });

  it("shows a broken flow's problem and an edited base skill in the panel, and drops the module when its folder goes, with no reload", { timeout: 60_000 }, async () => {
    await run("yami:open-panel");
    await page().evaluate(() => (window as any).app.workspace.getLeavesOfType("yami-panel")[0].view.go({ level: "modules" }));
    await page().waitForSelector('.yami-panel [data-key="module:hello"]');
    const flow = "internal/hello/flows/greeting/FLOW.md";
    const edit = (from: string, to: string) =>
      page().evaluate(([path, a, b]) => (window as any).app.vault.process((window as any).app.vault.getFileByPath(path), (text: string) => text.replace(a, b)), [flow, from, to] as const);

    await edit("name: greeting\n", "name: greeting\naccess: readonly\n");
    await page().waitForSelector(`.yami-panel .yami-problem-row[data-key^="problem:${flow}:"]`, { timeout: 10_000 });
    expect(await page().textContent(".yami-panel .yami-problem-row .yami-row-desc")).toContain("access");
    await page().waitForFunction(() => !(window as any).app.commands.commands["yami:yami-hello-new-greeting"], undefined, { timeout: 10_000 });
    expect(await page().$('.yami-panel [data-key="module:threads"]')).not.toBeNull();
    await edit("access: readonly\n", "");
    await page().waitForSelector(".yami-panel .yami-problem-row", { state: "detached", timeout: 10_000 });
    await page().waitForFunction(() => Boolean((window as any).app.commands.commands["yami:yami-hello-new-greeting"]), undefined, { timeout: 10_000 });

    // A person edits the base skill: the panel says so, and a delete brings back this version's text.
    await page().evaluate((file) => (window as any).app.vault.process((window as any).app.vault.getFileByPath(file), (text: string) => `${text}\nAlways answer in French.\n`), BASE_SKILL);
    await page().waitForSelector(`.yami-panel .yami-problem-row[data-key^="problem:${BASE_SKILL}:"]`, { timeout: 10_000 });
    expect(await page().textContent(".yami-panel .yami-problem-row .yami-row-desc")).toContain(VERSION);
    await page().evaluate((file) => (window as any).app.vault.delete((window as any).app.vault.getFileByPath(file)), BASE_SKILL);
    await page().waitForSelector(".yami-panel .yami-problem-row", { state: "detached", timeout: 10_000 });
    await obsidian.waitForNote(BASE_SKILL, (text) => text === BASE_SKILL_TEXT, 10_000);

    await page().evaluate(() => (window as any).app.vault.delete((window as any).app.vault.getFolderByPath("internal/hello"), true));
    await page().waitForSelector('.yami-panel [data-key="module:hello"]', { state: "detached", timeout: 10_000 });
    await page().waitForFunction(() => !Object.keys((window as any).app.commands.commands).some((id) => id.startsWith("yami:yami-hello-")), undefined, { timeout: 10_000 });
    expect(await page().evaluate(() => (window as any).app.plugins.plugins.yami.yami.module("hello"))).toBeUndefined();
  });
});
