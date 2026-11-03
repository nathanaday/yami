import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { launchObsidian, type ObsidianInstance } from "./harness.js";

const TIMEOUT = 240_000;
describe("Yami Threads in Obsidian", () => {
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
      const hub = app.plugins.plugins["yami-threads"]?.yami.hub;
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
    await page().waitForFunction(() => (window as any).app.plugins.plugins["yami-threads"].yami.conversations.working.length === 0, undefined, { timeout, polling: 250 });
    await page().waitForTimeout(600);
  }

  async function newConversation(command = "yami-threads:yami-new-conversation-claude") {
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


  it("installs the threads module and no wiki files, and adds no wiki command", { timeout: 30_000 }, async () => {
    await obsidian.waitForNote("internal/threads/threads.md", (text) => text.length > 0, 10_000);
    expect(existsSync(path.join(obsidian.vault, "internal/threads/agents/validator/AGENT.md"))).toBe(true);
    // The threads module and Yami's own skill set are all that the install writes: no wiki module, and no module of the plugin's own.
    const folders = (dir: string) => readdirSync(path.join(obsidian.vault, dir), { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name).sort();
    expect(folders("internal")).toEqual(["threads", "yami"]);
    expect(existsSync(path.join(obsidian.vault, "wiki"))).toBe(false);
    const ids = await page().evaluate(() => Object.keys((window as any).app.commands.commands).filter((id) => id.startsWith("yami-threads:")));
    for (const id of ["run-session-claude", "run-session-codex", "resume-session", "stop-session", "kill-session", "threads-create-agent", "threads-create-flow", "threads-create-policy", "threads-create-promise", "threads-create-skill", "threads-create-session"]) {
      expect(ids, id).toContain(`yami-threads:yami-${id}`);
    }
    expect(ids).toContain("yami-threads:open-panel");
    expect(ids.filter((id) => id.includes("wiki") || id.includes("new-module"))).toEqual([]);
    // A thread's document holds sections only the tools write.
    expect(ids).not.toContain("yami-threads:yami-threads-new-thread");
    // The vault's wiki index is still there for the links and the checks, and the agents get the threads tools only.
    const tools = await page().evaluate(() => (window as any).app.plugins.plugins["yami-threads"].yami.tools().tools.map((t: any) => t.name as string));
    expect(tools).toContain("threads_status");
    expect(tools.filter((name: string) => name.startsWith("wiki_"))).toEqual([]);
  });

  it("shows the threads module alone in the panel, with no waiting list", async () => {
    await run("yami-threads:open-panel");
    await page().waitForSelector(".yami-panel .yami-module-row");
    expect(await page().$$eval(".yami-panel .yami-module-row", (els) => els.map((el) => el.getAttribute("data-key")))).toEqual(["module:threads"]);
    expect(await page().$$eval(".yami-panel .yami-section-head h3", (els) => els.map((el) => el.textContent))).not.toContain("Waiting for approval");
    expect(await page().$eval('.yami-panel [data-key="module:threads"] .yami-module-icon svg', (el) => el.classList.contains("lucide-spool"))).toBe(true);
  });

  it("creates the forms of threads from the command palette, and a session of the person's own flow, which the panel lists", { timeout: 60_000 }, async () => {
    const forms: [kind: string, name: string, file: string, example: string][] = [
      ["agent", "Code checker", "internal/threads/agents/code-checker/AGENT.md", "Reviewer"],
      ["flow", "Daily review", "internal/threads/flows/daily-review/FLOW.md", "Daily review"],
      ["policy", "Plain words", "internal/threads/policies/plain-words/POLICY.md", "Cite sources"],
      ["promise", "Review written", "internal/threads/promises/review-written/PROMISE.md", "Summary written"],
      ["skill", "Summarize commits", "internal/threads/skills/summarize-commits/SKILL.md", "Summarize"],
    ];
    for (const [kind, name, file, example] of forms) {
      const id = `yami-threads:yami-threads-create-${kind}`;
      expect(await page().evaluate((command) => (window as any).app.commands.findCommand(command)?.name, id)).toBe(`Yami Threads: Threads: create ${kind}`);
      await run(id);
      await page().waitForSelector(".yami-ask", { timeout: 5_000 });
      expect(await page().textContent(".yami-ask")).toContain("Type a name.");
      expect(await page().$$(".yami-ask .suggestion-item")).toHaveLength(0);
      expect(await page().getAttribute(".yami-ask input.prompt-input", "placeholder")).toBe(`The name of the new ${kind}, such as ${example}`);
      await page().locator(".yami-ask input.prompt-input").fill(name);
      await page().locator(".yami-ask .suggestion-item", { hasText: `Create the ${kind}: ${name}` }).click();
      await page().waitForFunction((want) => (window as any).app.workspace.getActiveFile()?.path === want, file, { timeout: 10_000 });
      expect(await obsidian.read(file), file).toMatch(/^---\nname: [a-z-]+\ndescription: /);
    }
    // Every starter is valid as written.
    expect(await page().evaluate(async () => {
      const yami = (window as any).app.plugins.plugins["yami-threads"].yami;
      await yami.discover();
      return yami.problems;
    })).toEqual([]);
    await page().waitForFunction(() => Boolean((window as any).app.commands.commands["yami-threads:yami-threads-new-daily-review"]), undefined, { timeout: 10_000 });

    // Create a flow session: pick the person's flow, and its session opens in threads/.
    await run("yami-threads:yami-threads-create-session");
    await page().waitForSelector(".yami-pick", { timeout: 5_000 });
    expect(await page().getAttribute(".yami-pick input.prompt-input", "placeholder")).toBe("The flow of the new Threads session");
    const offered = await page().$$eval(".yami-pick .suggestion-item", (els) => els.map((el) => el.textContent ?? ""));
    expect(offered).toContain("Daily review");
    await page().locator(".yami-pick .suggestion-item", { hasText: "Daily review" }).click();
    await page().waitForFunction(
      () => {
        const app = (window as any).app;
        const file = app.workspace.getActiveFile();
        return file?.path.startsWith("threads/") && app.metadataCache.getFileCache(file)?.frontmatter?.flow === "daily-review";
      },
      undefined,
      { timeout: 10_000 },
    );
    const session = await activePath();
    const doc = await obsidian.read(session);
    expect(doc).toContain("type: session");
    expect(doc).toContain("module: threads");
    // A session of the person's own flow is not a thread: it carries no field of the thread flow's schema.
    const { threadFields, properties } = await page().evaluate((file) => {
      const app = (window as any).app;
      return {
        threadFields: Object.keys((window as any).app.plugins.plugins["yami-threads"].yami.module("threads").thread.schema),
        properties: Object.keys(app.metadataCache.getFileCache(app.vault.getFileByPath(file))?.frontmatter ?? {}),
      };
    }, session);
    expect(threadFields).toEqual(expect.arrayContaining(["repositories", "after", "retired", "tags"]));
    expect(properties.filter((key) => threadFields.includes(key)), doc).toEqual([]);
    // A new thread carries the thread fields that have a default.
    const threadProperties = await page().evaluate(async () => {
      const app = (window as any).app;
      const thread = await (window as any).app.plugins.plugins["yami-threads"].yami.module("threads").thread.create({ name: "Contrast", request: "A thread to compare." });
      await new Promise<void>((resolve) => {
        const check = () => (app.metadataCache.getFileCache(app.vault.getFileByPath(thread.path))?.frontmatter ? resolve() : setTimeout(check, 50));
        check();
      });
      const keys = Object.keys(app.metadataCache.getFileCache(app.vault.getFileByPath(thread.path)).frontmatter);
      await app.vault.delete(app.vault.getFileByPath(thread.path));
      return keys;
    });
    expect(threadProperties).toEqual(expect.arrayContaining(["repositories", "after", "retired", "tags"]));

    // The panel lists it under Threads, as any session.
    await run("yami-threads:open-panel");
    await page().evaluate(() => (window as any).app.workspace.getLeavesOfType("yami-panel")[0].view.go({ level: "module", module: "threads" }));
    await page().waitForSelector(`.yami-panel [data-key="session:${session}"]`, { timeout: 10_000 });
    expect(await page().textContent(`.yami-panel [data-key="session:${session}"] .yami-row-meta span`)).toBe("Not started");
    expect(await page().$('.yami-panel button:has-text("New daily review")')).not.toBeNull();
    await page().click(".yami-panel .yami-back");
    await page().waitForSelector('.yami-panel .yami-panel-title:text-is("Modules")');
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

  it("calls a module tool from both agents", { timeout: TIMEOUT }, async () => {
    for (const command of ["yami-threads:yami-new-conversation-claude", "yami-threads:yami-new-conversation-codex"]) {
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

});
