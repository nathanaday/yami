import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { BASE_SKILL, BASE_SKILL_TEXT, VERSION } from "../../src/index.js";
import { hashText, SHIPPED } from "../../src/module/base-skill.js";
import { testYami, type TestYami } from "../../src/testing/index.js";

let t: TestYami | undefined;
afterEach(async () => {
  await t?.dispose();
  t = undefined;
});

/** The base skill that Yami 0.3.0 to 0.5.1 shipped. */
const SHIPPED_0_3_0 = await readFile(new URL("../fixtures/base-skill/0.3.0.md", import.meta.url), "utf8");
/** The base skill that Yami 0.2.0 shipped: its example of a skill command was hello's. */
const SHIPPED_0_2_0 = SHIPPED_0_3_0.replace("`/<module>:<skill>`", "such as `hello:greeting`");

describe("the base skill", () => {
  it("is written when the vault has no file at its path", async () => {
    t = await testYami();
    expect(await t.vault.read(BASE_SKILL)).toBe(BASE_SKILL_TEXT);
    expect(t.yami.problems).toEqual([]);
  });

  it("is written again at the next discovery after a person deletes it", async () => {
    t = await testYami();
    await t.vault.remove(BASE_SKILL);
    await t.yami.discover();
    expect(await t.vault.read(BASE_SKILL)).toBe(BASE_SKILL_TEXT);
  });

  it("is replaced when it holds a text that an earlier Yami shipped, since the person never edited it", async () => {
    t = await testYami();
    for (const earlier of [SHIPPED_0_2_0, SHIPPED_0_3_0]) {
      expect(earlier).not.toBe(BASE_SKILL_TEXT);
      await t.vault.write(BASE_SKILL, earlier);
      await t.yami.discover();
      expect(await t.vault.read(BASE_SKILL)).toBe(BASE_SKILL_TEXT);
      expect(t.yami.problems).toEqual([]);
    }
  });

  it("names the session's input and the agent tool", () => {
    expect(BASE_SKILL_TEXT).toContain("The session's input is its Request section, which says what to do, its session properties, and its articles.");
    expect(BASE_SKILL_TEXT).toContain("Call the tool `yami_agent` with the agent's name and a task that holds everything it needs.");
  });

  it("is kept when a person edited it, and the problems say how to get the new text", async () => {
    t = await testYami();
    const edited = `${BASE_SKILL_TEXT}\nAlways answer in French.\n`;
    await t.vault.write(BASE_SKILL, edited);
    let heard = 0;
    t.yami.onModulesChange(() => heard++);
    await t.yami.discover();
    expect(await t.vault.read(BASE_SKILL)).toBe(edited);
    expect(t.yami.problems).toEqual([
      {
        module: "yami",
        path: BASE_SKILL,
        document: BASE_SKILL,
        message: `The base skill differs from the text of Yami ${VERSION}, so Yami keeps your edits. To get the new text, delete the file: Yami writes it again. Then copy back the edits you want.`,
      },
    ]);
    expect(heard).toBe(1);

    await t.vault.write(BASE_SKILL, BASE_SKILL_TEXT);
    await t.yami.discover();
    expect(t.yami.problems).toEqual([]);
    expect(heard).toBe(2);
  });

  it("knows each text it shipped: when you change BASE_SKILL_TEXT, add its hash to SHIPPED", async () => {
    expect(SHIPPED).toContain(await hashText(BASE_SKILL_TEXT));
    expect(SHIPPED).toContain(await hashText(SHIPPED_0_2_0));
    expect(SHIPPED).toContain(await hashText(SHIPPED_0_3_0));
  });
});

describe("VERSION", () => {
  it("is the version of the package", async () => {
    const pkg = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });
});
