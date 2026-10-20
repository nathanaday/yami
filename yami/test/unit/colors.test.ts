import { describe, expect, it } from "vitest";
import { hexColor, INTERNAL_COLOR, MODULE_COLORS, mute, WIKI_COLOR, Yami, type YamiModule } from "../../src/index.js";
import { folderColorRules } from "../../src/obsidian/colors.js";
import { FsVault } from "../../src/testing/index.js";
import { Hello } from "../fixtures/hello.js";

const vault = new FsVault("/tmp/yami-colors");
const named = (id: string, color?: string) =>
  new (class extends Hello {
    readonly id = id;
    readonly color = color;
  })();
const colorsOf = (...modules: YamiModule[]) => {
  const yami = new Yami({ vault, modules });
  return Object.fromEntries(yami.modules.map((m) => [m.id, m.colors.folder]));
};

describe("module colors", () => {
  it("reads a hex code of three or six digits, in either case, and nothing else", () => {
    expect(hexColor("#3E63DD")).toBe("#3e63dd");
    expect(hexColor(" #abc ")).toBe("#aabbcc");
    for (const bad of ["red", "3e63dd", "#3e63d", "#3e63ddff", "#ggg", ""]) expect(hexColor(bad), bad).toBeUndefined();
  });

  it("mutes a color halfway toward the gray of internal/", () => {
    expect(mute(WIKI_COLOR)).toBe("#4596a9");
    expect(mute("#e5484d")).toBe("#b8696c");
    expect(mute("#123456", 0)).toBe("#123456");
    expect(mute("#123456", 1)).toBe(INTERNAL_COLOR);
  });

  it("gives the wiki cyan, a module its own color, and its internal folder the color muted", () => {
    const yami = new Yami({ vault, modules: [named("mine", "#ABC")] });
    expect(yami.module("wiki")!.colors).toEqual({ folder: WIKI_COLOR, internal: mute(WIKI_COLOR) });
    expect(yami.module("mine")!.colors).toEqual({ folder: "#aabbcc", internal: mute("#aabbcc") });
  });

  it("gives a module with no color a basic one by its id, the same on every start, and another module's only when none is free", () => {
    const first = colorsOf(named("alpha"), named("beta"), named("gamma"));
    expect(colorsOf(named("alpha"), named("beta"), named("gamma"))).toEqual(first);
    expect(colorsOf(named("gamma"))).toMatchObject({ gamma: first.gamma });
    for (const id of ["alpha", "beta", "gamma"]) expect(MODULE_COLORS).toContain(first[id]);
    // The wiki and threads have colors of their own, outside the basic ones, so they take none from a host's module.
    expect(new Set(Object.values(first)).size).toBe(5);
    const alone = new Yami({ vault, modules: [named("alpha"), named("beta"), named("gamma")], threads: false });
    expect(Object.fromEntries(alone.modules.map((m) => [m.id, m.colors.folder]))).toEqual({ wiki: first.wiki, alpha: first.alpha, beta: first.beta, gamma: first.gamma });
    expect(MODULE_COLORS).not.toContain(first.threads);

    const taken = colorsOf(named("owner", first.alpha), named("alpha"));
    expect(taken.owner).toBe(first.alpha);
    expect(taken.alpha).not.toBe(first.alpha);

    const many = colorsOf(...Array.from({ length: MODULE_COLORS.length + 2 }, (_, i) => named(`m${i}`)));
    expect(new Set(Object.values(many)).size).toBe(MODULE_COLORS.length + 2);
  });

  it("refuses a color that is no hex code, and knows no color before a Yami has the module", () => {
    expect(() => new Yami({ vault, modules: [named("bad", "blue")] })).toThrow('The bad module\'s color "blue" is not a hex code such as #3e63dd.');
    expect(() => named("loose").colors).toThrow("The loose module is not added to a Yami yet.");
  });

  it("writes a rule for internal/, and for each module's own and internal folders", () => {
    const rules = folderColorRules(new Yami({ vault, modules: [named("mine", "#e5484d")] }));
    expect(rules).toContain(`.nav-folder-title[data-path="internal"] {\n  --nav-item-color: ${INTERNAL_COLOR};\n`);
    expect(rules).toContain(`.nav-folder-title[data-path="wiki"] {\n  --nav-item-color: ${WIKI_COLOR};\n  --nav-item-color-hover: ${WIKI_COLOR};`);
    expect(rules).toContain(`.nav-folder-title[data-path="internal/wiki"] {\n  --nav-item-color: #4596a9;`);
    expect(rules).toContain('.nav-folder-title[data-path="mine"] {\n  --nav-item-color: #e5484d;');
    expect(rules).toContain('.nav-folder-title[data-path="internal/mine"] {\n  --nav-item-color: #b8696c;');
    expect(rules).toContain('.nav-folder-title[data-path="threads"] {\n  --nav-item-color: #6e56cf;');
    expect(rules.match(/\{/g)).toHaveLength(7);
  });
});
