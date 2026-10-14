import { builtinModules } from "node:module";
import esbuild from "esbuild";

const production = process.argv[2] === "production";

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
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

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
