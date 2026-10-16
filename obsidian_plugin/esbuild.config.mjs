import esbuild from "esbuild";
import { copyStyles, pluginBuild } from "yami/esbuild";

const production = process.argv[2] === "production";

const context = await esbuild.context({ ...pluginBuild({ production }), entryPoints: ["src/main.ts"], outfile: "main.js" });
await copyStyles("styles.css");

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
