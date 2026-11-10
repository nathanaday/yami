import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runTool } from "../../src/agent/index.js";
import { DEFAULT_FOLDERS, followEdit, link, marksOf, protect, protectedLost, protectedRanges, readDocument, readProtected, renameProtected, touches, unprotect, writeProtected, type ProtectedMap } from "../../src/document/index.js";
import { runCheck, type WikiModule } from "../../src/index.js";
import { testYami, type FsVault, type TestYami } from "../../src/testing/index.js";
import { InvalidPlan, type Wiki } from "../../src/wiki/index.js";

const { sources: SOURCES, pages: TOPICS } = DEFAULT_FOLDERS;

let t: TestYami;
let vault: FsVault;
let wiki: Wiki;
let module: WikiModule;
const note = (path: string, properties: Record<string, unknown>, body: string) => vault.write(path, `---\n${vault.stringifyProperties(properties)}---\n${body}`);
const TOPIC = `${TOPICS}/Levain.md`;
const BODY = "## Definition\n\nLevain is a sourdough starter ([[Baking (source)]], p. 3).\n\nMy own words: I feed mine at dawn, and it never fails me.\n\n## Related\n\n[[Sourdough]].\n";
const MINE = "My own words: I feed mine at dawn, and it never fails me.";

beforeEach(async () => {
  t = await testYami();
  ({ vault } = t);
  wiki = t.yami.wiki;
  module = t.yami.module("wiki") as WikiModule;
  await note(`${SOURCES}/Baking (source).md`, { type: "source", description: "A book.", file: "[[x.pdf]]", status: "absorbed" }, "## Summary\n\nBread.\n");
  await note(TOPIC, { type: "topic", description: "A starter.", sources: [link(`${SOURCES}/Baking (source).md`)] }, BODY);
  await note(`${TOPICS}/Sourdough.md`, { type: "topic", description: "Bread." }, "Bread from [[Levain]].\n");
  await wiki.refresh();
});
afterEach(() => t.dispose());

describe("the protected text map", () => {
  it("protects a text of a note, once, and unprotects what a text touches", () => {
    let map = protect({ version: 1, notes: {} }, TOPIC, `  ${MINE}\r\n`, { since: "2026-11-04T12:00:00", note: "mine" });
    expect(map).toEqual({ version: 1, notes: { [TOPIC]: [{ text: MINE, since: "2026-11-04T12:00:00", note: "mine" }] } });
    // A text inside a mark adds nothing; a text around a mark replaces it.
    expect(protect(map, TOPIC, "I feed mine at dawn")).toBe(map);
    const wider = protect(map, TOPIC, `${MINE}\n\n## Related`, { since: "2026-11-04T13:00:00" });
    expect(marksOf(wider, TOPIC).map((m) => m.text)).toEqual([`${MINE}\n\n## Related`]);
    expect(() => protect(map, TOPIC, "  ")).toThrow("The text to protect is empty.");
    expect(() => protect(map, TOPIC, "not there", { body: BODY })).toThrow('The note does not hold the text "not there".');
    map = protect(map, TOPIC, "Levain is a sourdough starter", { since: "2026-11-04T12:01:00" });
    expect(marksOf(map, TOPIC)).toHaveLength(2);
    expect(marksOf(unprotect(map, TOPIC, "feed mine"), TOPIC).map((m) => m.text)).toEqual(["Levain is a sourdough starter"]);
    expect(unprotect(map, TOPIC).notes).toEqual({});
    expect(marksOf(map, "other.md")).toEqual([]);
    expect(renameProtected(map, TOPIC, "moved.md").notes).toEqual({ "moved.md": marksOf(map, TOPIC) });
    expect(renameProtected(map, "none.md", "moved.md")).toBe(map);
  });

  it("finds the marks a text lost, their ranges, and what a change touches", () => {
    const map = protect({ version: 1, notes: {} }, TOPIC, MINE, { since: "s" });
    expect(protectedLost(map, TOPIC, BODY)).toEqual([]);
    expect(protectedLost(map, TOPIC, BODY.replace("never fails", "sometimes fails"))).toEqual(marksOf(map, TOPIC));
    const [range] = protectedRanges(marksOf(map, TOPIC), BODY);
    expect(range).toMatchObject({ from: BODY.indexOf(MINE), to: BODY.indexOf(MINE) + MINE.length });
    expect(protectedRanges(marksOf(map, TOPIC), "gone")).toEqual([]);
    const r = { from: 10, to: 20 };
    expect(touches(r, { from: 12, to: 12 })).toBe(true);
    expect(touches(r, { from: 10, to: 10 })).toBe(false);
    expect(touches(r, { from: 20, to: 20 })).toBe(false);
    expect(touches(r, { from: 5, to: 11 })).toBe(true);
    expect(touches(r, { from: 20, to: 25 })).toBe(false);
    expect(touches(r, { from: 0, to: 30 })).toBe(true);
  });

  it("follows a person's edit: the mark takes the text of its range after the change, and an emptied mark goes", () => {
    const map = protect({ version: 1, notes: {} }, TOPIC, MINE, { since: "s" });
    const at = BODY.indexOf("never");
    const edited = followEdit(map, TOPIC, BODY, [{ from: at, to: at + 5, insert: "rarely" }]);
    expect(marksOf(edited, TOPIC)[0]!.text).toBe(MINE.replace("never", "rarely"));
    // An edit elsewhere leaves the mark as the same object.
    expect(marksOf(followEdit(map, TOPIC, BODY, [{ from: 0, to: 0, insert: "# Title\n\n" }]), TOPIC)[0]).toBe(marksOf(map, TOPIC)[0]);
    const start = BODY.indexOf(MINE);
    expect(followEdit(map, TOPIC, BODY, [{ from: start, to: start + MINE.length, insert: "" }]).notes).toEqual({});
    // A delete that covers part of the mark cuts it.
    expect(marksOf(followEdit(map, TOPIC, BODY, [{ from: start, to: start + "My own words: ".length, insert: "" }]), TOPIC)[0]!.text).toBe(MINE.slice("My own words: ".length));
    // A mark the text no longer holds stays, lost.
    const lost = protect(map, TOPIC, "nowhere in the body", { since: "s" });
    expect(marksOf(followEdit(lost, TOPIC, BODY, [{ from: 0, to: 1, insert: "x" }]), TOPIC).map((m) => m.text)).toEqual([MINE, "nowhere in the body"]);
  });

  it("reads an empty map when the vault has none, writes and reads one back, and refuses a broken one", async () => {
    expect(await readProtected(vault)).toEqual({ version: 1, notes: {} });
    const map = protect({ version: 1, notes: {} }, TOPIC, MINE, { since: "s" });
    await writeProtected(vault, map);
    expect(await vault.exists(DEFAULT_FOLDERS.protected)).toBe(true);
    expect(await readProtected(vault)).toEqual(map);
    await writeProtected(vault, { version: 1, notes: {} });
    expect(await readProtected(vault)).toEqual({ version: 1, notes: {} });
    await vault.write(DEFAULT_FOLDERS.protected, "{ not json");
    await expect(readProtected(vault)).rejects.toThrow(`${DEFAULT_FOLDERS.protected} does not parse`);
    await vault.write(DEFAULT_FOLDERS.protected, JSON.stringify({ version: 2, notes: {} }));
    await expect(readProtected(vault)).rejects.toThrow("is not a protected text map of version 1");
    await vault.write(DEFAULT_FOLDERS.protected, JSON.stringify({ version: 1, notes: { [TOPIC]: [{ text: "", since: "s" }, { text: "ok", since: "s" }, "junk"] } }));
    expect(await readProtected(vault)).toEqual({ version: 1, notes: { [TOPIC]: [{ text: "ok", since: "s" }] } });
  });
});

describe("protected text and the wiki", () => {
  const guard = async (text = MINE) => writeProtected(vault, protect({ version: 1, notes: {} }, TOPIC, text, { since: "2026-11-04T12:00:00" }));
  const modify = (body: string) => ({ title: "Edit Levain", writes: [{ op: "modify" as const, path: TOPIC, body, why: "test" }] });

  it("refuses a change that drops a protected text or removes its note, and takes one that keeps it, or the person's own", async () => {
    await guard();
    await expect(wiki.change(modify(BODY.replace(MINE, "An agent's rewording.")))).rejects.toThrow(InvalidPlan);
    await expect(wiki.change(modify(BODY.replace(MINE, "An agent's rewording.")))).rejects.toThrow(`write 1 (modify ${TOPIC}): the new body drops the text "${MINE}", which a person protected; keep it as it is`);
    await expect(wiki.change({ title: "Remove", writes: [{ op: "remove", path: TOPIC }] })).rejects.toThrow("the note holds text that a person protected, so it cannot be removed");
    const kept = await wiki.change(modify(`${BODY}\nA new claim beside it ([[Baking (source)]], p. 4).\n`));
    expect(kept.status).toBe("proposed");
    // A protection added after the proposal is checked again at the approval.
    const dropping = await wiki.change(modify(BODY.replace("Levain is a sourdough starter", "Levain is a starter")));
    await guard("Levain is a sourdough starter");
    await expect(wiki.approve(dropping.path)).rejects.toThrow("which a person protected");
    await guard(MINE);
    expect((await readDocument(vault, dropping.path)).properties.status).toBe("proposed");
    const own = await wiki.change(modify(BODY.replace(MINE, "My own words, changed by me.")), { person: true });
    await wiki.approve(own.path, { person: true });
    expect((await readDocument(vault, TOPIC)).body).toContain("My own words, changed by me.");
    // A map that does not parse refuses every plan, and says why.
    await vault.write(DEFAULT_FOLDERS.protected, "{");
    await expect(wiki.change(modify(BODY))).rejects.toThrow(`${DEFAULT_FOLDERS.protected} does not parse`);
  });

  it("lets the return of a checkout change protected text, since the edits are the person's own", async () => {
    await guard();
    const { copies, session } = await module.makeCheckout({ request: "levain", name: "Levain", documents: [{ path: "Levain", why: "x" }] });
    const copy = await readDocument(vault, copies[0]!);
    await note(copy.path, copy.properties, copy.body.replace(MINE, "My own words, edited in the copy."));
    const returned = await module.returnCheckout(session);
    expect(returned.returned).toEqual([TOPIC]);
    expect((await readDocument(vault, TOPIC)).body).toContain("My own words, edited in the copy.");
  });

  it("is a core check, a lint warning, and a tool", async () => {
    await guard();
    const check = (properties: Record<string, unknown>, field?: string) => runCheck({ path: "p", properties: { check: "protected", ...(field && { field }) }, body: "" }, { vault, wiki, path: "s.md", properties });
    expect(await check({})).toMatchObject({ status: "met", detail: "every protected text of 1 note(s) is in place" });
    expect(await check({ notes: [link(`${TOPICS}/Sourdough.md`)] }, "notes")).toMatchObject({ status: "met", detail: "no note has protected text" });
    expect(await check({ notes: ["[[Nowhere]]"] }, "notes")).toMatchObject({ status: "unmet", detail: "notes links Nowhere, which are not notes" });
    expect((await wiki.lint({ paths: [TOPIC] })).filter((f) => f.check === "protected-lost")).toEqual([]);
    const tool = t.yami.tools().tools.find((x) => x.name === "yami_protected")!;
    expect(tool.readOnly).toBe(true);
    const signal = new AbortController().signal;
    expect(JSON.parse((await runTool(tool, { note: "[[Levain]]" }, signal)).text)).toEqual({ path: TOPIC, marks: [{ text: MINE, since: "2026-11-04T12:00:00" }] });
    expect(JSON.parse((await runTool(tool, { note: "Sourdough" }, signal)).text)).toEqual({ path: `${TOPICS}/Sourdough.md`, marks: [] });
    expect(JSON.parse((await runTool(tool, {}, signal)).text)).toEqual({ notes: [{ path: TOPIC, marks: [{ text: MINE, since: "2026-11-04T12:00:00" }] }] });
    // The text goes, by an edit outside Yami: the check fails, and lint warns with the fix.
    await note(TOPIC, { type: "topic", description: "A starter.", sources: [] }, BODY.replace(MINE, "Gone."));
    await wiki.refresh();
    expect(await check({})).toMatchObject({ status: "unmet", detail: `protected text is gone from 1 place(s): ${TOPIC}: "${MINE}"` });
    expect(await check({ notes: [link(TOPIC)] }, "notes")).toMatchObject({ status: "unmet" });
    expect((await wiki.lint({ paths: [TOPIC] })).filter((f) => f.check === "protected-lost")).toEqual([
      { path: TOPIC, check: "protected-lost", severity: "warning", message: `no longer holds the protected text "${MINE}"`, fix: "put the text back, protect the text that replaced it, or unprotect it" },
    ]);
    await vault.write(DEFAULT_FOLDERS.protected, "{");
    expect((await wiki.lint())[0]).toMatchObject({ path: DEFAULT_FOLDERS.protected, check: "bad-protected-map", severity: "error" });
  });

  it("gives the wiki's flows the protected-text policy", async () => {
    for (const flow of ["ingest", "import", "figures"]) expect(module.flowOf(flow)!.policies.map((p) => p.name), flow).toContain("protected-text");
    expect(await vault.read("internal/wiki/policies/protected-text/POLICY.md")).toContain("yami_protected");
    expect(t.yami.problems).toEqual([]);
  });
});
