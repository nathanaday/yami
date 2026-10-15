import { copyFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { builtinModules } from "node:module";
import esbuild from "esbuild";

const production = process.argv[2] === "production";

// The Claude Agent SDK expects Node's timers and AbortController, but in
// Obsidian's renderer the globals are Chromium's. These fixes apply only to the
// SDK's own files:
// - Chromium's setTimeout returns a number, and the SDK calls .unref() on the
//   result when it stops a CLI process. Each SDK file gets Node's timers.
// - Node's events.setMaxListeners rejects Chromium AbortSignals. Chromium
//   signals have no listener limit, so the SDK gets a version that skips them.
const claudeSdkInRenderer = {
  name: "claude-sdk-in-renderer",
  setup(build) {
    build.onLoad({ filter: /[\\/]claude-agent-sdk[\\/].*\.mjs$/ }, async (args) => ({
      loader: "js",
      contents:
        'import { setTimeout, clearTimeout, setInterval, clearInterval } from "timers";\n' +
        (await readFile(args.path, "utf8")).replace(/^#!.*\n/, ""),
    }));
    build.onResolve({ filter: /^(node:)?events$/ }, (args) =>
      args.importer.includes("claude-agent-sdk") ? { path: "events", namespace: "renderer-events" } : undefined,
    );
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

/**
 * The MCP SDK validates JSON Schemas with ajv, which compiles each schema with
 * `new Function`. Obsidian's review rejects code that generates code, so the
 * bundle uses the SDK's interpreting validator instead.
 */
const mcpValidator = {
  name: "mcp-validator",
  setup(build) {
    build.onResolve({ filter: /\/validation\/ajv-provider\.js$/ }, () => ({ path: "mcp-validator", namespace: "mcp-validator" }));
    build.onLoad({ filter: /.*/, namespace: "mcp-validator" }, () => ({
      loader: "js",
      // The MCP SDK and the validator are dependencies of yami, so resolve from there.
      resolveDir: fileURLToPath(new URL("./node_modules/yami/", import.meta.url)),
      contents: `export { CfWorkerJsonSchemaValidator as AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";`,
    }));
  },
};

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  plugins: [claudeSdkInRenderer, mcpValidator],
  external: [
    "obsidian",
    "electron",
    "@codemirror/*",
    "@lezer/*",
    ...builtinModules,
    ...builtinModules.map((name) => `node:${name}`),
  ],
  // The Agent SDK calls createRequire(import.meta.url) on load, and a CJS
  // bundle has no import.meta. Any file URL works for the built-in modules
  // that the SDK requires.
  define: { "import.meta.url": JSON.stringify("file:///") },
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  minify: production,
  outfile: "main.js",
});

// The stylesheet of the Obsidian layer ships next to main.js.
await copyFile(fileURLToPath(new URL("./node_modules/yami-obsidian/styles.css", import.meta.url)), "styles.css");

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
