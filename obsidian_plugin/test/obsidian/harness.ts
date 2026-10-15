import { type ChildProcess, spawn } from "node:child_process";
import { copyFile, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { type Browser, chromium, type Page } from "playwright-core";

const OBSIDIAN = process.env.OBSIDIAN_BINARY ?? "/Applications/Obsidian.app/Contents/MacOS/Obsidian";
/** Obsidian's own data folder, where it keeps the app updates that it downloaded. */
const OBSIDIAN_DATA = process.env.OBSIDIAN_DATA ?? path.join(homedir(), "Library/Application Support/obsidian");
const PLUGIN_ID = "yami";

export interface ObsidianInstance {
  page: Page;
  vault: string;
  read(note: string): Promise<string>;
  /** Waits until `check` returns true for the note's text, and returns that text. */
  waitForNote(note: string, check: (text: string) => boolean, timeout?: number): Promise<string>;
  close(): Promise<void>;
}

export interface LaunchOptions {
  /** The vault to copy. Default: the sample vault in the test fixtures. */
  vault?: string;
}

/**
 * Starts a separate Obsidian with its own profile and a fresh copy of a vault,
 * with the built plugin installed and enabled. The user's own Obsidian and vaults are not touched.
 */
export async function launchObsidian({ vault: source = "test/fixtures/sample-vault" }: LaunchOptions = {}): Promise<ObsidianInstance> {
  const root = await mkdtemp(path.join(tmpdir(), "yami-plugin-"));
  const vault = path.join(root, "vault");
  const profile = path.join(root, "profile");
  const pluginDir = path.join(vault, `.obsidian/plugins/${PLUGIN_ID}`);

  await cp(source, vault, { recursive: true });
  await mkdir(pluginDir, { recursive: true });
  for (const file of ["main.js", "manifest.json", "styles.css"]) await cp(file, path.join(pluginDir, file));
  await mkdir(profile);
  await linkAppUpdate(profile);
  await writeFile(path.join(profile, "obsidian.json"), JSON.stringify({ vaults: { yamitest00001: { path: vault, ts: Date.now(), open: true } } }));

  const port = await freePort();
  const child = spawn(OBSIDIAN, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`], { stdio: "ignore" });
  let browser: Browser | undefined;
  try {
    browser = await connect(port);
    const page = await vaultPage(browser);
    await page.waitForFunction(() => (window as any).app?.workspace?.layoutReady, undefined, { timeout: 30_000 });
    await page.evaluate(async (id) => {
      const plugins = (window as any).app.plugins;
      // The plugin is not in community-plugins.json yet, so turning on community plugins loads nothing,
      // and enablePluginAndSave loads it exactly once.
      plugins.setEnable(true);
      await plugins.enablePluginAndSave(id);
    }, PLUGIN_ID);
    await page.waitForFunction((id) => !!(window as any).app.plugins.plugins[id], PLUGIN_ID, { timeout: 10_000 });
    // Turning on community plugins opens the settings window a moment later. It would take the keyboard.
    await page.waitForSelector(".modal-container", { timeout: 3_000 }).catch(() => undefined);
    for (let attempt = 0; attempt < 5 && (await page.$(".modal-container")); attempt++) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
    }
    if (await page.$(".modal-container")) throw new Error("A dialog stayed open in Obsidian.");

    const read = (note: string) => readFile(path.join(vault, note), "utf8");
    return {
      page,
      vault,
      read,
      async waitForNote(note, check, timeout = 120_000) {
        const deadline = Date.now() + timeout;
        let text = "";
        while (Date.now() < deadline) {
          // Read through Obsidian, which includes edits that are not saved to disk yet.
          text = await page.evaluate((file) => {
            const app = (window as any).app;
            const leaf = app.workspace.getLeavesOfType("markdown").find((l: any) => l.view.file?.path === file);
            return leaf ? leaf.view.editor.getValue() : app.vault.adapter.read(file);
          }, note);
          if (check(text)) return text;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        throw new Error(`Timed out waiting for ${note}. Last text:\n${text}`);
      },
      async close() {
        await browser?.close().catch(() => undefined);
        await stop(child);
        await rm(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await browser?.close().catch(() => undefined);
    await stop(child);
    throw error;
  }
}

/**
 * Obsidian runs the newest app update in its profile folder. A new profile has none, so it would run the
 * installer's older version. A copy of the installed update makes the test run the version that the user runs.
 */
async function linkAppUpdate(profile: string): Promise<void> {
  const updates = (await readdir(OBSIDIAN_DATA).catch(() => [] as string[])).filter((name) => /^obsidian-[\d.]+\.asar$/.test(name));
  const version = (name: string) => name.slice("obsidian-".length, -".asar".length).split(".").map(Number);
  const newest = updates
    .sort((a, b) => {
      const [x, y] = [version(a), version(b)];
      for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
      return 0;
    })
    .at(-1);
  if (newest) await copyFile(path.join(OBSIDIAN_DATA, newest), path.join(profile, newest));
}

async function connect(port: number): Promise<Browser> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
}

async function vaultPage(browser: Browser): Promise<Page> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) if (page.url().startsWith("app://obsidian.md/index.html")) return page;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("Obsidian did not open the vault window.");
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
  if (child.exitCode === null) child.kill("SIGKILL");
}
