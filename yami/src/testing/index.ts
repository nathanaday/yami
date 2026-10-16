// Test a module without Obsidian or a harness: a vault on the file system, an agent that follows a
// script, and a Yami over both in a fresh folder.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { YamiModule } from "../module/module.js";
import { Yami } from "../module/yami.js";
import type { WikiOptions } from "../wiki/wiki.js";
import { FsVault } from "./fs-vault.js";
import { ScriptedAgent, type Turn } from "./scripted-agent.js";

export { FsVault } from "./fs-vault.js";
export { ScriptedAgent, ScriptedSession, type Turn } from "./scripted-agent.js";

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
}

/** A Yami over a fresh vault in a temporary folder, with a scripted agent and every module enabled. */
export async function testYami(options: TestYamiOptions = {}): Promise<TestYami> {
  const root = await mkdtemp(join(tmpdir(), "yami-test-"));
  const vault = new FsVault(root);
  const agent = new ScriptedAgent(options.turns);
  const yami = new Yami({ vault, agents: [agent], modules: options.modules, wiki: options.wiki });
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
