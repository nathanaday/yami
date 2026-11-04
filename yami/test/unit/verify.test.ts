import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runTool } from "../../src/agent/index.js";
import { link, readDocument } from "../../src/document/index.js";
import { runCheck, type WikiModule } from "../../src/index.js";
import { VERIFY_BATCH } from "../../src/module/wiki/verify.js";
import { testYami, type FsVault, type TestYami } from "../../src/testing/index.js";
import { captureSource, SOURCES, TOPICS, type Wiki } from "../../src/wiki/index.js";

let t: TestYami;
let vault: FsVault;
let wiki: Wiki;
let module: WikiModule;
const note = (path: string, properties: Record<string, unknown>, body: string) => vault.write(path, `---\n${vault.stringifyProperties(properties)}---\n${body}`);
const tool = (name: string) => t.yami.tools().tools.find((tool) => tool.name === name)!;
const signal = new AbortController().signal;

beforeEach(async () => {
  t = await testYami();
  ({ vault } = t);
  wiki = t.yami.wiki;
  module = t.yami.module("wiki") as WikiModule;
  await vault.write("papers/notes.md", ["# Notes", "An autoencoder learns a compressed code.", "The decoder expands it.", "", "## Training", "It trains with no labels."].join("\n"));
  const notes = await captureSource(vault, "papers/notes.md");
  await note(`${TOPICS}/Autoencoder.md`, { type: "topic", description: "A network that reproduces its input.", sources: [link(notes)] }, "An autoencoder learns a compressed code ([[notes (source)]], lines 2-3). It trains with no labels ([[notes (source)]], § Training). It has nine layers ([[notes (source)]], lines 40-41).\n");
  await note(`${TOPICS}/Decoder.md`, { type: "topic", description: "The half that expands the code.", sources: [link(notes)], verified: "2026-01-01T00:00:00" }, "The decoder expands the code ([[notes (source)]], lines 3-3). See [[Autoencoder]].\n");
  await wiki.refresh();
});
afterEach(() => t.dispose());

describe("the citations tool", () => {
  it("gives a verifier each citation with its claim, the file to read, and the range, and refuses what is not a topic", async () => {
    const citations = tool("wiki_citations");
    expect(citations.readOnly).toBe(true);
    const result = JSON.parse((await runTool(citations, { topic: "Autoencoder" }, signal)).text);
    expect(result.topic).toBe(`${TOPICS}/Autoencoder.md`);
    expect(result.verified).toBeNull();
    expect(result.citations.map((c: Record<string, unknown>) => [c.claim, c.locator, c.lines, c.problem])).toEqual([
      ["An autoencoder learns a compressed code", "lines 2-3", { from: 2, to: 3 }, undefined],
      ["It trains with no labels", "§ Training", { from: 5, to: 6 }, undefined],
      ["It has nine layers", "lines 40-41", undefined, "its copy has 6 lines"],
    ]);
    expect(result.citations[0].file).toMatch(/^internal\/wiki\/originals\/[0-9a-f]{16}\.md$/);
    expect(result.citations[0].source).toBe(`${SOURCES}/notes (source).md`);
    expect(result.citations[0].from).toBeUndefined();
    expect(JSON.parse((await runTool(citations, { topic: `${TOPICS}/Decoder.md` }, signal)).text).verified).toBe("2026-01-01T00:00:00");
    expect(await runTool(citations, { topic: "notes (source)" }, signal)).toMatchObject({ isError: true, text: "notes (source) is not a topic of the wiki." });
  });
});

describe("the verify flow", () => {
  it("is read-only with a command, a verifier, and a check that holds its topics to a verified date of the session", async () => {
    expect(module.verify.command).toBe(true);
    expect(module.verify.access).toBe("read-only");
    expect(module.verify.agents.map((a) => a.name)).toEqual(["verifier"]);
    expect(module.verify.promises.map((p) => p.name)).toEqual(["change-applied", "claims-verified"]);
    expect((await readDocument(vault, "internal/wiki/agents/verifier/AGENT.md")).properties).toMatchObject({ name: "verifier", access: "read-only" });
    const skill = await vault.read("internal/wiki/skills/verify/SKILL.md");
    expect(skill).toContain("call `yami_agent` with the agent `verifier`");
    expect(skill).toContain(`at most ${VERIFY_BATCH} in one session`);
    expect(await vault.read("internal/wiki/skills/ingest/page-forms.md")).toContain("verified:");
    expect(t.yami.problems).toEqual([]);

    const session = (await module.verify.create({ name: "Verify", exact: true })).path;
    const created = String((await readDocument(vault, session)).properties.created);
    const check = async (properties: Record<string, unknown>) =>
      runCheck({ path: "p", properties: { check: "verified" }, body: "" }, { vault, wiki, path: session, properties: { created, ...properties } }, module.checks);
    expect(await check({ topics: [], changes: [] })).toMatchObject({ status: "unmet", detail: expect.stringContaining("no topic is verified") });
    expect(await check({ topics: ["[[Nowhere]]"], changes: [] })).toMatchObject({ status: "unmet", detail: "topics links Nowhere, which are not notes" });
    // A date before the session does not count.
    expect(await check({ topics: [link(`${TOPICS}/Decoder.md`)], changes: [] })).toMatchObject({ status: "unmet", detail: expect.stringContaining("not verified in this session: Decoder") });

    const stamp = "2099-01-01T00:00:00";
    const body = (await readDocument(vault, `${TOPICS}/Autoencoder.md`)).body.replace(" It has nine layers ([[notes (source)]], lines 40-41).", "");
    const proposal = await wiki.change({
      title: "Verify Autoencoder",
      session,
      writes: [
        { op: "modify", path: `${TOPICS}/Autoencoder.md`, properties: { verified: stamp }, body, why: "one claim the source does not hold" },
        { op: "modify", path: `${TOPICS}/Decoder.md`, properties: { verified: stamp }, why: "every claim holds" },
      ],
    });
    await wiki.refresh();
    const properties = (await readDocument(vault, session)).properties;
    expect(properties.changes).toEqual([link(proposal.path)]);
    // With the field empty, the topics are the ones the standing change modifies.
    expect(await check({ ...properties, topics: [] })).toMatchObject({ status: "met", detail: "2 topic(s) verified, in the wiki or in the standing changes" });
    expect(await check({ ...properties, topics: [link(`${TOPICS}/Autoencoder.md`)] })).toMatchObject({ status: "met" });
    await wiki.approve(proposal.path);
    await wiki.refresh();
    expect(await check({ topics: [link(`${TOPICS}/Autoencoder.md`), link(`${TOPICS}/Decoder.md`)], changes: [] })).toMatchObject({ status: "met" });
    expect((await readDocument(vault, `${TOPICS}/Decoder.md`)).properties.verified).toBe(stamp);
    expect((await wiki.lint()).filter((f) => f.check === "bad-citation")).toEqual([]);
  });
});
