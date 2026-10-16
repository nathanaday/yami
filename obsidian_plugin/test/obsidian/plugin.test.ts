import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { launchObsidian, type ObsidianInstance } from "./harness.js";

const TIMEOUT = 240_000;

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
      const hub = app.plugins.plugins.yami?.hub;
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
    await page().waitForFunction(() => (window as any).app.plugins.plugins.yami.conversations.working.length === 0, undefined, { timeout, polling: 250 });
    await page().waitForTimeout(600);
  }

  async function newConversation(command = "yami:new-conversation-claude") {
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
    await command("yami:wiki-search");
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
    await command("yami:wiki-related");
    await page().waitForSelector(".yami-wiki-hit .yami-wiki-hit-name");
    expect(await names()).toContain("Sourdough");
    await close();

    // Compare: one column for each algorithm, and the query from the selection.
    // Line 5 is the first line below the properties: "The starter of [[Sourdough]]".
    await page().evaluate(() => (window as any).app.workspace.activeEditor.editor.setSelection({ line: 5, ch: 4 }, { line: 5, ch: 11 }));
    await command("yami:wiki-compare");
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
    await command("yami:wiki-match");
    await page().waitForSelector(".yami-wiki-badge.is-hit");
    expect(await page().textContent(".yami-wiki-list .yami-wiki-hit-name")).toBe("Levain");
    await close();

    // Lint: the dead link in this note, and the vault's findings after a new note, without a rebuild.
    await command("yami:wiki-lint-note");
    await page().waitForSelector(".yami-wiki-badge.is-error");
    expect(await page().textContent(".yami-wiki-badge.is-error")).toBe("dead-link");
    await close();
    await page().evaluate(async () => void (await (window as any).app.vault.create("wiki/topics/Rye.md", "---\ntype: topic\n---\nNo description.\n")));
    await command("yami:wiki-lint-vault");
    await page().waitForSelector(".yami-wiki-list .yami-wiki-hit");
    expect(await page().$$eval(".yami-wiki-list .yami-wiki-hit-meta", (els) => els.some((el) => el.textContent?.startsWith("wiki/topics/Rye.md · has no description")))).toBe(true);
    await close();

    // Snapshot: the first version, its archive, and the versions list.
    await command("yami:wiki-snapshot");
    const snapshot = await obsidian.waitForNote("internal/wiki/snapshots/v1.md", (text) => text.includes("hash:"), 15_000);
    expect(snapshot).toContain("type: snapshot");
    expect(snapshot).toContain("notes: 3");
    expect(readFileSync(path.join(obsidian.vault, "internal/wiki/snapshots/v1.json.gz")).length).toBeGreaterThan(20);
    await command("yami:wiki-versions");
    await page().waitForSelector(".yami-wiki-list .yami-wiki-hit");
    expect(await page().textContent(".yami-wiki-list .yami-wiki-hit-name")).toBe("Version 1");
    await close();

    // Restore: a hand edit is kept as version 2 before version 1 comes back as version 3.
    await page().evaluate(async () => void (await (window as any).app.vault.create("wiki/topics/Spelt.md", "---\ntype: topic\ndescription: Spelt.\n---\nAdded by hand.\n")));
    await command("yami:wiki-restore");
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
    await command("yami:wiki-ingest-folder");
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
    expect(existsSync(path.join(obsidian.vault, "internal/threads/agents/validator.md"))).toBe(true);

    // Publish: pick the volume; the edition's session opens with a source for each note.
    await page().evaluate(async () => {
      const vault = (window as any).app.vault;
      await vault.createFolder("journals/garden-log");
      await vault.create("journals/garden-log/Tomatoes.md", "Plant after the frost.\n");
    });
    await command("yami:journals-publish");
    await page().waitForSelector(".prompt-input");
    await page().keyboard.type("Garden Log");
    await page().keyboard.press("Enter");
    await page().waitForFunction(() => (window as any).app.workspace.getActiveFile()?.path.startsWith("internal/wiki/sessions/Garden Log edition "), undefined, { timeout: 10_000 });
    const edition = await obsidian.read(await activePath());
    expect(edition).toContain("[[wiki/sources/Tomatoes (source)|Tomatoes (source)]]");
    expect(edition).toContain("[[internal/journals/policies/Journal sources|Journal sources]]");

    // Return: a checkout made with the librarian's tool, a copy edited by the user, and the return command.
    const made = await page().evaluate(async () => {
      const app = (window as any).app;
      if (!app.vault.getFolderByPath("wiki/topics")) await app.vault.createFolder("wiki/topics");
      await app.vault.create("wiki/topics/Compost.md", "---\ntype: topic\ndescription: Rotted plant matter.\n---\nCompost feeds the soil.\n");
      const tool = (window as any).yami.claude.preferences.tools.tools.find((t: any) => t.name === "librarian_checkout");
      return JSON.parse(await tool.run({ request: "the material on compost", name: "Compost", documents: [{ path: "wiki/topics/Compost.md", why: "the basics" }] }, { signal: new AbortController().signal }));
    });
    await page().evaluate(async (copy) => {
      const app = (window as any).app;
      await app.vault.modify(app.vault.getFileByPath(copy), (await app.vault.read(app.vault.getFileByPath(copy))).replace("feeds the soil", "feeds the soil and holds water"));
    }, made.copies[0]);
    await page().evaluate((file) => (window as any).app.workspace.getLeaf().openFile((window as any).app.vault.getFileByPath(file)), made.session);
    await page().waitForFunction((file) => (window as any).app.metadataCache.getFileCache((window as any).app.vault.getFileByPath(file))?.frontmatter?.status === "out", made.session);
    await command("yami:librarian-return");
    await obsidian.waitForNote(made.session, (text) => text.includes("status: returned"), 15_000);
    expect(await obsidian.read("wiki/topics/Compost.md")).toContain("Compost feeds the soil and holds water.");
    expect(existsSync(path.join(obsidian.vault, made.copies[0]))).toBe(false);
  });

  it("installs the hello module when it loads", async () => {
    for (const file of ["Yami.base", "hello/sessions.base", "internal/hello/policies/Always say hello.md", "internal/hello/skills/greeting/SKILL.md"]) {
      await obsidian.waitForNote(file, (text) => text.length > 0, 10_000);
    }
    // A file at the vault root has no folder to create. A slice to the last slash once made "Yami.bas".
    expect(existsSync(path.join(obsidian.vault, "Yami.bas"))).toBe(false);
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
    await newConversation("yami:new-conversation-codex");
    await send("Reply with exactly the word: kiwi");
    await idle();
    const text = await obsidian.waitForNote(await activePath(), () => true);
    expect(text).toMatch(/^---\ntype: conversation\nagent: codex\n/);
    expect(text).toMatch(/\nkiwi\.?\n\n$/i);
  });

  it("calls a module tool from both agents", { timeout: TIMEOUT }, async () => {
    for (const command of ["yami:new-conversation-claude", "yami:new-conversation-codex"]) {
      await newConversation(command);
      await send("Call the greet_user tool of the hello module with the name Ada, then reply with exactly the text the tool returned.");
      await idle();
      const text = await obsidian.waitForNote(await activePath(), () => true);
      // Codex sometimes calls the tool twice, or first reads the module's greeting skill, which needs no approval;
      // the plumbing, not the count, is under test.
      expect(text, command).toMatch(/> \[!activity\]- (.+ · )?Used (a tool|\d tools)\n/);
      expect(text, command).toContain("> - `Greet Ada`\n");
      expect(text, command).not.toContain("yami-permission");
      expect(text, command).toMatch(/\nHello, Ada!\n\n$/);
    }
  });

  it("starts a conversation for another plugin and reports its turns", { timeout: TIMEOUT }, async () => {
    const result = await page().evaluate(async () => {
      const app = (window as any).app;
      const conversations = app.plugins.plugins.yami.conversations;
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

  it("runs a hello session from its document", { timeout: TIMEOUT }, async () => {
    await page().evaluate(() => (window as any).app.commands.executeCommandById("yami:hello-new-session"));
    await page().waitForFunction(() => (window as any).app.workspace.getActiveFile()?.path.startsWith("hello/"), undefined, { timeout: 10_000 });
    const session = await activePath();
    await page().evaluate(() => (window as any).app.commands.executeCommandById("yami:hello-run-claude"));
    const doc = await obsidian.waitForNote(session, (text) => /state: (done|failed|needs-attention)/.test(text), 180_000);
    expect(doc).toContain("state: done");
    expect(doc).toMatch(/- \[x\] \[\[internal\/hello\/promises\/Greeting note\|Greeting note\]\]/);
    const conversation = doc.match(/\nconversation: "\[\[(conversations\/[^|\]]+)\|/)?.[1];
    expect(conversation).toBeTruthy();
    const record = await obsidian.waitForNote(`${conversation}.md`, (text) => text.includes("> [!user]"), 10_000);
    expect(record).toMatch(/^---\ntype: conversation\nagent: claude\n/);
    expect(record).toContain(`module: "[[${session.replace(/\.md$/, "")}]]"`);
  });
});
