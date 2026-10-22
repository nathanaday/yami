import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { copyStyles, pluginBuild } from "../../src/build/esbuild.js";

describe("esbuild options", () => {
  it("builds a development bundle by default and a minified one in production", () => {
    const dev = pluginBuild();
    expect(dev).toMatchObject({ bundle: true, format: "cjs", sourcemap: "inline", minify: false, loader: { ".md": "text" } });
    expect(pluginBuild({ production: true })).toMatchObject({ sourcemap: false, minify: true });
  });

  it("keeps Obsidian, Electron, CodeMirror and Node modules out, and runs the host's plugins after its own", () => {
    const own = { name: "own", setup() {} };
    const options = pluginBuild({ plugins: [own] });
    expect(options.external).toEqual(expect.arrayContaining(["obsidian", "electron", "@codemirror/*", "fs", "node:fs"]));
    expect(options.plugins.at(-1)).toBe(own);
    expect(options.plugins.map((p) => p.name).slice(0, 2)).toEqual(["claude-sdk-in-renderer", "mcp-validator"]);
  });

  it("bundles an entry that imports a markdown file as text and leaves obsidian external", async () => {
    const dir = await mkdtemp(join(tmpdir(), "yami-esbuild-"));
    try {
      await writeFile(join(dir, "skill.md"), "# Skill\n");
      await writeFile(join(dir, "main.ts"), `import skill from "./skill.md";\nimport "obsidian";\nexport const text = skill;\n`);
      const outfile = join(dir, "main.js");
      await build({ ...pluginBuild({ production: true }), entryPoints: [join(dir, "main.ts")], outfile, logLevel: "silent" });
      const code = await readFile(outfile, "utf8");
      expect(code).toContain("# Skill");
      expect(code).toMatch(/require\(["']obsidian["']\)/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("writes the Obsidian stylesheet and then the plugin's own, to each path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "yami-styles-"));
    try {
      const own = join(dir, "own.css");
      await writeFile(own, ".mine{color:red}");
      const a = join(dir, "a.css");
      const b = join(dir, "b.css");
      await copyStyles([a, b], [own]);
      const text = await readFile(a, "utf8");
      expect(text).toBe(await readFile(b, "utf8"));
      expect(text.endsWith(".mine{color:red}\n")).toBe(true);
      expect(text.indexOf(`/* ${own} */`)).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
