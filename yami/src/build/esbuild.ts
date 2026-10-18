// The esbuild options that an Obsidian plugin built on Yami needs. The Claude Agent SDK and the MCP SDK
// expect Node; in Obsidian's renderer the globals are Chromium's, and Obsidian's review rejects code that
// generates code. These fixes apply to the SDKs' own files only.
import { builtinModules } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { BuildOptions, Plugin } from "esbuild";

/** The folder of the yami package. */
const PACKAGE = fileURLToPath(new URL("../../", import.meta.url));

/**
 * - Chromium's setTimeout returns a number, and the SDK calls .unref() on the result when it stops a CLI
 *   process. Each SDK file gets Node's timers.
 * - Node's events.setMaxListeners rejects Chromium AbortSignals. Chromium signals have no listener limit,
 *   so the SDK gets a version that skips them.
 */
const claudeSdkInRenderer: Plugin = {
  name: "claude-sdk-in-renderer",
  setup(build) {
    build.onLoad({ filter: /[\\/]claude-agent-sdk[\\/].*\.mjs$/ }, async (args) => ({
      loader: "js",
      contents: 'import { setTimeout, clearTimeout, setInterval, clearInterval } from "timers";\n' + (await readFile(args.path, "utf8")).replace(/^#!.*\n/, ""),
    }));
    build.onResolve({ filter: /^(node:)?events$/ }, (args) => (args.importer.includes("claude-agent-sdk") ? { path: "events", namespace: "renderer-events" } : undefined));
    build.onLoad({ filter: /.*/, namespace: "renderer-events" }, () => ({
      loader: "js",
      contents: `
        import { setMaxListeners as nodeSetMaxListeners } from "events";
        export * from "events";
        export function setMaxListeners(n, ...targets) {
          if (targets.length === 0) return nodeSetMaxListeners(n);
          for (const target of targets) {
            try {
              nodeSetMaxListeners(n, target);
            } catch (error) {
              if (error.code !== "ERR_INVALID_ARG_TYPE") throw error;
            }
          }
        }`,
    }));
  },
};

/** The MCP SDK validates JSON Schemas with ajv, which compiles each schema with `new Function`. The bundle uses the SDK's interpreting validator instead. */
const mcpValidator: Plugin = {
  name: "mcp-validator",
  setup(build) {
    build.onResolve({ filter: /\/validation\/ajv-provider\.js$/ }, () => ({ path: "mcp-validator", namespace: "mcp-validator" }));
    build.onLoad({ filter: /.*/, namespace: "mcp-validator" }, () => ({
      loader: "js",
      // The MCP SDK and the validator are dependencies of yami, so they resolve from its folder.
      resolveDir: PACKAGE,
      contents: `export { CfWorkerJsonSchemaValidator as AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";`,
    }));
  },
};

export interface PluginBuild {
  /** A minified bundle with no source map. Default: a development bundle with an inline source map. */
  production?: boolean;
  /** The host's own esbuild plugins, which run after Yami's. */
  plugins?: Plugin[];
}

/**
 * The esbuild options of an Obsidian plugin built on Yami: a CommonJS bundle with Obsidian, Electron,
 * CodeMirror, and Node's modules left out, the fixes for the agent SDKs, and `.md` files imported as text,
 * so a module's skills and policies can be markdown files. Add the entry point and the output file:
 *
 * ```js
 * const context = await esbuild.context({ ...pluginBuild({ production, plugins: [install] }), entryPoints: ["src/main.ts"], outfile: "main.js" });
 * ```
 */
export function pluginBuild({ production = false, plugins = [] }: PluginBuild = {}): BuildOptions & { plugins: Plugin[] } {
  return {
    bundle: true,
    plugins: [claudeSdkInRenderer, mcpValidator, ...plugins],
    external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...builtinModules, ...builtinModules.map((name) => `node:${name}`)],
    // The Agent SDK calls createRequire(import.meta.url) on load, and a CJS bundle has no import.meta.
    // Any file URL works for the built-in modules that the SDK requires.
    define: { "import.meta.url": JSON.stringify("file:///") },
    loader: { ".md": "text" },
    format: "cjs",
    target: "es2022",
    logLevel: "info",
    sourcemap: production ? false : "inline",
    minify: production,
  };
}

/**
 * Writes the stylesheet a plugin ships as the `styles.css` next to its `main.js`: the stylesheet of the
 * Obsidian layer, then the plugin's own stylesheets in order, so a plugin's rules come last. `to` is one
 * path, or several, such as the build folder and a test vault's plugin folder.
 *
 * ```js
 * await copyStyles(["styles.css", `${vault}/.obsidian/plugins/my-plugin/styles.css`], ["src/styles.css"]);
 * ```
 */
export async function copyStyles(to: string | string[] = "styles.css", own: string[] = []): Promise<void> {
  const parts = [await readFile(`${PACKAGE}src/obsidian/styles.css`, "utf8")];
  for (const file of own) parts.push(`/* ${file} */\n${await readFile(file, "utf8")}`);
  const text = parts.map((part) => part.replace(/\n*$/, "\n")).join("\n");
  for (const path of typeof to === "string" ? [to] : to) await writeFile(path, text);
}
