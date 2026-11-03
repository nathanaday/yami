// Builds the plugin: main.js and styles.css beside manifest.json, so the folder itself can be a plugin
// folder of a vault (a symlink into .obsidian/plugins/ works). A minified build, unless --watch.
//   node esbuild.config.mjs                  build once
//   node esbuild.config.mjs --watch          rebuild on every change, with source maps
//   node esbuild.config.mjs --vault <dir>    also copy the three files into <dir>/.obsidian/plugins/yami-wiki
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import esbuild from "esbuild";
import { copyStyles, pluginBuild } from "yami/esbuild";

const { values } = parseArgs({ options: { vault: { type: "string" }, watch: { type: "boolean" } } });
const target = values.vault ? path.join(values.vault, ".obsidian/plugins/yami-wiki") : undefined;

async function install() {
  await copyStyles([`styles.css`, ...(target ? [path.join(target, "styles.css")] : [])]);
  if (!target) return;
  await mkdir(target, { recursive: true });
  for (const file of ["main.js", "manifest.json"]) await copyFile(file, path.join(target, file));
  console.log(`Installed in ${values.vault}. Reload Obsidian, or turn Yami Wiki off and on.`);
}

const installPlugin = { name: "install", setup: (build) => build.onEnd((result) => (result.errors.length ? undefined : install())) };
const context = await esbuild.context({ ...pluginBuild({ production: !values.watch, plugins: [installPlugin] }), entryPoints: ["src/main.ts"], outfile: "main.js" });
if (values.watch) {
  await context.watch();
} else {
  await context.rebuild();
  await context.dispose();
}
