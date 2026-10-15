import { readFileSync } from "node:fs";
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

  it("installs the hello module when it loads", async () => {
    for (const file of ["Yami.base", "hello/sessions.base", "internal/hello/policies/Always say hello.md", "internal/hello/skills/greeting/SKILL.md"]) {
      await obsidian.waitForNote(file, () => true, 10_000);
    }
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
      turn: { path: "Agents/From another plugin.md", status: "completed" },
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
  });
});
