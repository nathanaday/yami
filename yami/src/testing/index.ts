// Test a module without Obsidian or a harness: a vault on the file system, an agent that follows a
// script, and a Yami over both in a fresh folder.
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { YamiModule } from "../module/module.js";
import { Yami } from "../module/yami.js";
import type { WikiOptions } from "../wiki/wiki.js";
import { FsVault } from "./fs-vault.js";
import { ScriptedAgent, type Turn } from "./scripted-agent.js";

export { FsVault } from "./fs-vault.js";
export { review, ScriptedAgent, ScriptedSession, type ScriptedVerdict, type Turn } from "./scripted-agent.js";

export interface TestYami {
  yami: Yami;
  vault: FsVault;
  /** The vault's folder, which `dispose` removes. */
  root: string;
  /** The Yami's one agent. */
  agent: ScriptedAgent;
  /** Stops every run and removes the vault. */
  dispose(): Promise<void>;
}

export interface TestYamiOptions {
  modules?: YamiModule[];
  /** The agent's first turns. `agent.queue` adds more. */
  turns?: Turn[];
  wiki?: WikiOptions;
  /** Whether the Yami holds the built-in threads module, as the option of `Yami`. Default true. */
  threads?: boolean;
  /**
   * Files and folders to copy into the vault before the modules are enabled, so that `enable` finds them,
   * as a vault module: each vault path with the file or the folder on disk to copy there. A relative disk
   * path starts at the working directory of the test run.
   *
   * ```ts
   * await testYami({ files: { "internal/<id>": "test/fixtures/<id>", "notes/Idea.md": "test/fixtures/Idea.md" } });
   * ```
   */
  files?: Record<string, string>;
}

/**
 * A Yami over a fresh vault in a temporary folder, with the `files` copied in, a scripted agent, and every
 * module enabled. It throws when it cannot copy a file, and then leaves no folder behind.
 */
export async function testYami(options: TestYamiOptions = {}): Promise<TestYami> {
  const root = await mkdtemp(join(tmpdir(), "yami-test-"));
  for (const [to, from] of Object.entries(options.files ?? {})) {
    try {
      await cp(from, join(root, to), { recursive: true });
    } catch (error) {
      await rm(root, { recursive: true, force: true });
      throw new Error(`testYami cannot copy ${from} to ${to}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const vault = new FsVault(root);
  const agent = new ScriptedAgent(options.turns);
  const yami = new Yami({ vault, agents: [agent], modules: options.modules, wiki: options.wiki, threads: options.threads });
  await yami.enable();
  return {
    yami,
    vault,
    root,
    agent,
    async dispose() {
      await yami.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

/**
 * A Vite plugin, for Vitest, that imports a `.md` file as its text, as the plugin build does with
 * `yami/esbuild`. Add it to `plugins` in `vitest.config`.
 */
export function markdownText(): { name: string; enforce: "pre"; transform(code: string, id: string): string | undefined } {
  return {
    name: "yami-markdown-text",
    enforce: "pre",
    transform: (code, id) => (id.endsWith(".md") ? `export default ${JSON.stringify(code)};` : undefined),
  };
}
