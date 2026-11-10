import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runTool } from "../../src/agent/index.js";
import { DEFAULT_FOLDERS, link, parseSchema, readDocument, readProtected } from "../../src/document/index.js";
import { testYami, type FsVault, type TestYami } from "../../src/testing/index.js";
import { BUILT_IN_TEMPLATES, gunzip, gzip, parseTemplate, sectionProblems, templateChecks, type Wiki } from "../../src/wiki/index.js";

const { pages: PAGES, sources: SOURCES, templates: TEMPLATES } = DEFAULT_FOLDERS;

let t: TestYami;
let vault: FsVault;
let wiki: Wiki;
const note = (path: string, properties: Record<string, unknown>, body: string) => vault.write(path, `---\n${vault.stringifyProperties(properties)}---\n${body}`);
const tool = (name: string) => t.yami.tools().tools.find((tool) => tool.name === name)!;
const signal = new AbortController().signal;
const SOURCE = `${SOURCES}/Book (source).md`;
const cited = { sources: [link(SOURCE)] };
const checks = async (path: string) => (await wiki.lint({ paths: [path] })).map((f) => f.check).sort();

beforeEach(async () => {
  t = await testYami();
  ({ vault } = t);
  wiki = t.yami.wiki;
  await note(SOURCE, { type: "source", description: "A book.", file: "[[book.pdf]]", status: "pending" }, "![[book.pdf]]\n");
  await vault.write("book.pdf", "pdf");
});
afterEach(() => t.dispose());

describe("the built-in templates", () => {
  it("are installed in the wiki's internal folder, each valid as written, and listed by the tool", async () => {
    for (const [name, text] of Object.entries(BUILT_IN_TEMPLATES)) {
      const path = `${TEMPLATES}/${name}/TEMPLATE.md`;
      expect(await vault.read(path)).toBe(text(vault.folders));
      expect(parseTemplate(vault, path, text(vault.folders), name).problems).toEqual([]);
    }
    expect((await wiki.templates()).map((t) => t.name)).toEqual(["event", "glossary", "list", "portal", "source", "stub", "timeline", "topic"]);
    expect(wiki.template("event")).toMatchObject({ sections: ["Summary", "Proceedings", "Related", "Sources", "Notes"], cites: true, checks: [], builtIn: true, properties: { date: { type: "date", required: true } } });
    expect(wiki.template("portal")).toMatchObject({ cites: false, checks: ["coverage"], properties: { tag: { type: "text", required: true } } });
    expect(wiki.template("timeline")!.checks).toEqual(["chronological"]);
    const listed = JSON.parse((await runTool(tool("wiki_templates"), {}, signal)).text);
    expect(tool("wiki_templates").readOnly).toBe(true);
    expect(listed.problems).toEqual([]);
    expect(listed.templates.find((t: { name: string }) => t.name === "stub")).toMatchObject({ path: `${TEMPLATES}/stub/TEMPLATE.md`, sections: [], cites: false });
    expect(listed.templates[0].body).toBeUndefined();
  });

  it("stay out of the index, and a vault with no wiki module reads the library's text", async () => {
    expect(wiki.notes.some((n) => n.path.startsWith(`${TEMPLATES}/`))).toBe(false);
    const bare = await testYami({ wikiModule: false });
    try {
      expect(await bare.vault.exists(`${TEMPLATES}/topic/TEMPLATE.md`)).toBe(false);
      expect((await bare.yami.wiki.templates()).map((t) => t.name)).toContain("timeline");
    } finally {
      await bare.dispose();
    }
  });

  it("fall back to the library's text when the vault's copy is broken, and say why", async () => {
    await vault.write(`${TEMPLATES}/event/TEMPLATE.md`, "---\nname: event\ndescription: Mine.\nproperties: {description: text}\n---\n");
    await wiki.refresh();
    expect(wiki.template("event")!.description).toBe(parseTemplate(vault, "x", BUILT_IN_TEMPLATES.event!(vault.folders), "event").template!.description);
    expect(wiki.templateProblems).toEqual([{ path: `${TEMPLATES}/event/TEMPLATE.md`, message: "description is a property of every page, so the template cannot declare it. Remove it from properties." }]);
  });
});

describe("a person's own template", () => {
  const PERSON = `${TEMPLATES}/person/TEMPLATE.md`;
  const person = "---\nname: person\ndescription: A person the sources name.\nproperties:\n  born: {type: date, required: true}\n  field: text\n  role: {type: text, values: [author, speaker]}\nsections: [Biography, Sources]\ncites: true\n---\n# Person\n";

  it("is a template like a built-in one: its pages are validated by its properties and its sections", async () => {
    await vault.write(PERSON, person);
    const template = (await wiki.templates()).find((t) => t.name === "person")!;
    expect(template).toMatchObject({ builtIn: false, sections: ["Biography", "Sources"], properties: { born: { type: "date", required: true }, field: { type: "text" }, role: { type: "text", values: ["author", "speaker"] } } });
    const create = (properties: Record<string, unknown>) => wiki.change({ title: "Ada", writes: [{ op: "create", path: `${PAGES}/Ada Lovelace.md`, properties: { type: "person", description: "A mathematician.", ...cited, ...properties }, body: "## Biography\n\nShe wrote the first program ([[Book (source)]], p. 2).\n" }] });
    await expect(create({})).rejects.toThrow("born is missing");
    await expect(create({ born: "1815-12-10", role: "poet" })).rejects.toThrow("role must be one of author, speaker");
    const proposed = await create({ born: "1815-12-10" });
    expect(proposed.warnings).toEqual([`${PAGES}/Ada Lovelace.md has no ## Sources section, which the person template asks for`]);
    await wiki.approve(proposed.path);
    expect((await readDocument(vault, `${PAGES}/Ada Lovelace.md`)).properties).toMatchObject({ type: "person", born: "1815-12-10", status: "draft", tags: [] });
  });

  it("is a problem, and its pages lint as unknown-template, when it does not read", async () => {
    const bad = [
      [`${TEMPLATES}/session/TEMPLATE.md`, "---\nname: session\ndescription: x\n---\n", '"session" is the type of Yami\'s own documents, so no template can take it. Rename the folder.'],
      [`${TEMPLATES}/place/TEMPLATE.md`, "---\nname: spot\ndescription: x\nchecks: [nearby]\nproperties: {lat: number, lon: float}\n---\n", ""],
      [`${TEMPLATES}/Recipe.md`, "---\nname: recipe\ndescription: x\n---\n", `A template is a folder with a TEMPLATE.md in it. Move this file to ${TEMPLATES}/recipe/TEMPLATE.md.`],
    ];
    for (const [path, text] of bad) await vault.write(path!, text!);
    await note(`${PAGES}/Rome.md`, { type: "place", description: "A city.", ...cited }, "Rome is a city ([[Book (source)]], p. 9).\n");
    await wiki.refresh();
    const names = wiki.templateNames();
    expect(names).not.toContain("session");
    expect(names).not.toContain("place");
    const messages = wiki.templateProblems.map((p) => p.message);
    expect(messages).toContain(bad[0]![2]);
    expect(messages).toContain(bad[2]![2]);
    expect(wiki.templateProblems.filter((p) => p.path === `${TEMPLATES}/place/TEMPLATE.md`).map((p) => p.message)).toEqual([
      'The name is "spot", and the folder is place. A template\'s name is its folder\'s name: set name: place, or rename the folder.',
      "The property lon has the type float; a type is one of text, number, boolean, date, list, link, links, map.",
      "The check nearby is not a template check. The checks are chronological, coverage.",
    ]);
    const finding = (await wiki.lint({ paths: [`${PAGES}/Rome.md`] })).find((f) => f.check === "unknown-template")!;
    expect(finding).toMatchObject({ severity: "warning", message: `has the type place, which names no template: ${TEMPLATES}/place/TEMPLATE.md has a problem` });
    await expect(wiki.change({ title: "Paris", writes: [{ op: "create", path: `${PAGES}/Paris.md`, properties: { type: "place", description: "A city." }, body: "x" }] })).rejects.toThrow(
      `the type place names no template; a page's type is one of event, glossary, list, portal, stub, timeline, topic, or a template of ${TEMPLATES}/`,
    );
  });
});

describe("parseSchema", () => {
  it("reads a field as its type or as a map, and says what does not read", () => {
    expect(parseSchema({ a: "date", b: { type: "list", default: [] }, c: { type: "text", required: true, values: ["x"] } })).toEqual({
      schema: { a: { type: "date" }, b: { type: "list", default: [] }, c: { type: "text", required: true, values: ["x"] } },
      problems: [],
    });
    expect(parseSchema({ a: { type: "number", values: ["1"] }, b: { type: "boolean", default: "yes" }, c: { type: "text", min: 1 }, d: 3 }).problems).toEqual([
      "the property a: values must be a list of texts, for a text property",
      "the property b: its default must be true or false",
      "the property c has min; a field has only type, required, default, and values",
      "the property d must be a field type, or a map with type",
    ]);
    expect(parseSchema(["a"]).problems).toEqual(["properties must be names with fields, such as date: {type: date, required: true}"]);
  });
});

describe("the type of a page", () => {
  it("is topic when a create names none, and a page and a source stay in their own folders", async () => {
    const proposed = await wiki.change({ title: "Plain", writes: [{ op: "create", path: `${PAGES}/Plain.md`, properties: { description: "A page.", ...cited }, body: "## Definition\n\nx\n" }] });
    await wiki.approve(proposed.path);
    expect((await readDocument(vault, `${PAGES}/Plain.md`)).properties.type).toBe("topic");
    await expect(wiki.change({ title: "A", writes: [{ op: "create", path: `${PAGES}/A.md`, properties: { type: "source", description: "x" }, body: "x" }] })).rejects.toThrow(`a source goes in ${SOURCES}/, not with the pages`);
    await expect(wiki.change({ title: "B", writes: [{ op: "create", path: `${SOURCES}/B.md`, properties: { type: "event", description: "x" }, body: "x" }] })).rejects.toThrow(`a note in ${SOURCES}/ has type source`);
  });

  it("changes with a modify: a stub becomes an event once the event's properties are there", async () => {
    await note(`${PAGES}/Launch.md`, { type: "stub", description: "The launch of the first version.", becomes: "event" }, "The first version launched in 2024 ([[Book (source)]], p. 4).\n");
    await note(`${PAGES}/Home.md`, { type: "topic", description: "Home." }, "See [[Launch]].\n");
    await wiki.refresh();
    expect(await checks(`${PAGES}/Launch.md`)).toEqual(["stub"]);
    expect((await wiki.lint({ paths: [`${PAGES}/Launch.md`] }))[0]).toMatchObject({ severity: "info", message: "is a stub, which becomes: event" });
    const write = { op: "modify" as const, path: `${PAGES}/Launch.md`, properties: { type: "event", becomes: null } };
    await expect(wiki.change({ title: "Launch", writes: [write] })).rejects.toThrow("date is missing");
    const proposed = await wiki.change({ title: "Launch", writes: [{ ...write, properties: { ...write.properties, date: "2024-03-14", ...cited } }] });
    expect(proposed.warnings).toEqual([`${PAGES}/Launch.md has no ## Summary, ## Proceedings, ## Related, ## Sources, ## Notes sections, which the event template asks for`]);
    await wiki.approve(proposed.path);
    expect((await readDocument(vault, `${PAGES}/Launch.md`)).properties).toMatchObject({ type: "event", date: "2024-03-14" });
    expect((await readDocument(vault, `${PAGES}/Launch.md`)).properties.becomes).toBeUndefined();
    expect(await checks(`${PAGES}/Launch.md`)).toEqual(["missing-section"]);
  });

  it("is searched by template, or as any page", async () => {
    await note(`${PAGES}/Summit.md`, { type: "event", description: "A summit on bread.", date: "2025-05-01", ...cited }, "Bread bakers met.\n");
    await note(`${PAGES}/Bread.md`, { type: "topic", description: "Bread from flour.", ...cited }, "Bread is baked.\n");
    await note("journal/Bread day.md", { type: "event", description: "My bread day." }, "Bread.\n");
    await wiki.refresh();
    expect((await wiki.search("bread", { types: ["event"] })).map((h) => h.path).sort()).toEqual(["journal/Bread day.md", `${PAGES}/Summit.md`]);
    expect((await wiki.search("bread", { types: ["page"] })).map((h) => h.path).sort()).toEqual([`${PAGES}/Bread.md`, `${PAGES}/Summit.md`]);
    expect(wiki.isPage("journal/Bread day.md")).toBe(false);
    expect((await wiki.match(["Summit"]))[0]).toMatchObject({ match: "hit", path: `${PAGES}/Summit.md` });
  });
});

describe("lint by template", () => {
  it("names a missing section, a section out of order, and a property the template does not allow", async () => {
    expect(sectionProblems("## Related\n\n## Definition\n\n```\n## Explanation\n```\n", { name: "topic", sections: ["Definition", "Explanation", "Related"] })).toEqual([
      "has no ## Explanation section, which the topic template asks for",
      "has ## Related before ## Definition; the topic template puts Definition first",
    ]);
    await note(`${PAGES}/Meetup.md`, { type: "event", description: "A meetup.", date: 2024, ...cited }, "## Summary\n\n## Proceedings\n\n## Related\n\n## Sources\n\n## Notes\n");
    await note(`${PAGES}/Home.md`, { type: "topic", description: "Home." }, "[[Meetup]]\n");
    await wiki.refresh();
    expect(await wiki.lint({ paths: [`${PAGES}/Meetup.md`] })).toEqual([
      { path: `${PAGES}/Meetup.md`, check: "bad-property", severity: "warning", message: "date must be text, as the event template has it", fix: `fix the property, or change the template in ${TEMPLATES}/event/TEMPLATE.md` },
    ]);
  });

  it("holds a timeline's entries to date order, and a portal to every page of its tag", async () => {
    const timeline = "## Overview\n\n## Entries\n\n- **2024-03**: Second ([[Book (source)]]).\n- **2023**: First.\n- **soon**: Third.\n- **2025-01-02**: Fourth.\n\n## Related\n\n## Sources\n\n## Notes\n";
    await note(`${PAGES}/History.md`, { type: "timeline", description: "The history.", ...cited }, timeline);
    await note(`${PAGES}/Vision.md`, { type: "portal", description: "The entrance to vision.", tag: "ml/vision", tags: ["ml/vision"] }, "## Introduction\n\n- [[ViT]]: patches.\n- [[History]]\n");
    await note(`${PAGES}/ViT.md`, { type: "topic", description: "Vision transformer.", tags: ["ml/vision"], ...cited }, "x [[Vision]]\n");
    await note(`${PAGES}/CNN.md`, { type: "topic", description: "Convolutional network.", tags: ["ml/vision/cnn"], ...cited }, "x\n");
    await note(`${PAGES}/BERT.md`, { type: "topic", description: "A language model.", tags: ["ml/nlp"], ...cited }, "x\n");
    await wiki.refresh();
    const findings = await wiki.lint({ paths: [`${PAGES}/History.md`, `${PAGES}/Vision.md`] });
    expect(findings.filter((f) => f.check === "chronological").map((f) => f.message)).toEqual([
      "has the entry 2023 after 2024-03; the entries go oldest first",
      'has the entry "soon", whose date is not YYYY, YYYY-MM, or YYYY-MM-DD',
    ]);
    expect(findings.filter((f) => f.check === "coverage").map((f) => f.message)).toEqual(["does not link 1 page under #ml/vision: [[CNN]]"]);
    expect(findings.filter((f) => f.path === `${PAGES}/Vision.md`).map((f) => f.check)).toEqual(["coverage"]);
    expect(Object.keys(templateChecks)).toEqual(["chronological", "coverage"]);
  });

  it("says what a topic's kind became", async () => {
    await note(`${PAGES}/Vision.md`, { type: "topic", kind: "overview", description: "Vision.", ...cited }, "## Definition\n\n## Explanation\n\n## Related\n\n## Sources\n\n## Notes\n");
    await wiki.refresh();
    expect((await wiki.lint({ paths: [`${PAGES}/Vision.md`] })).find((f) => f.check === "kind-retired")).toMatchObject({ severity: "info", fix: "set type: portal, and remove kind" });
  });
});

describe("a wiki from before templates", () => {
  it("moves its topics to the pages folder at the start, with the links, the protected text, and a proposed change", async () => {
    const root = await mkdtemp(join(tmpdir(), "yami-legacy-"));
    const write = async (path: string, text: string) => {
      await mkdir(join(root, path, ".."), { recursive: true });
      await writeFile(join(root, path), text);
    };
    await write("wiki/topics/RL.md", "---\ntype: topic\nkind: concept\ndescription: Reward.\n---\nSee [[wiki/topics/Q-learning|Q]] and [[Q-learning]].\n");
    await write("wiki/topics/Q-learning.md", "---\ntype: topic\ndescription: Values.\n---\nMy own words.\n");
    await write("journal/day.md", "Read [[wiki/topics/RL]] and ![](wiki/topics/RL.md).\n");
    await write("internal/yami/protected.json", JSON.stringify({ version: 1, notes: { "wiki/topics/Q-learning.md": [{ text: "My own words.", since: "s" }] } }));
    const legacy = await testYami({ files: { "wiki/topics": join(root, "wiki/topics"), journal: join(root, "journal"), "internal/yami/protected.json": join(root, "internal/yami/protected.json") } });
    try {
      const v = legacy.vault;
      expect(await v.exists("wiki/topics")).toBe(false);
      expect(await v.read("wiki/pages/RL.md")).toContain("See [[wiki/pages/Q-learning|Q]] and [[Q-learning]].");
      expect(await v.read("journal/day.md")).toBe("Read [[wiki/pages/RL]] and ![](wiki/pages/RL.md).\n");
      expect(Object.keys((await readProtected(v)).notes)).toEqual(["wiki/pages/Q-learning.md"]);
      expect((await legacy.yami.wiki.lint({ paths: ["wiki/pages/RL.md"] })).find((f) => f.check === "kind-retired")).toMatchObject({ fix: "set type: topic, and remove kind" });
    } finally {
      await legacy.dispose();
    }
  });

  it("restores a version whose archive holds the topics folder into the pages folder", async () => {
    await note(`${PAGES}/A.md`, { type: "topic", description: "A." }, "a\n");
    const first = await wiki.snapshot();
    const archive = JSON.parse(await gunzip(await vault.readBinary(first.archive)));
    archive.notes = { "wiki/topics/Old.md": "---\ntype: topic\ndescription: Old.\n---\nSee [[wiki/topics/Old]].\n" };
    await vault.writeBinary(first.archive, await gzip(JSON.stringify(archive)));
    await wiki.restore(first.version);
    expect(await vault.exists(`${PAGES}/A.md`)).toBe(false);
    expect(await vault.read(`${PAGES}/Old.md`)).toContain("See [[wiki/pages/Old]].");
    expect(await vault.exists("wiki/topics/Old.md")).toBe(false);
  });
});
