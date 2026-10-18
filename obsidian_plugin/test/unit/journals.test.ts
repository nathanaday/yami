import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readDocument } from "yami/document";
import { testYami, type FsVault, type TestYami } from "yami/testing";
import { Journals, volumeName } from "../../src/modules/journals/index.js";

let t: TestYami;
let vault: FsVault;
let journals: Journals;
const publish = (volume: string) => journals.publish(volume);
const volumes = () => journals.volumes();

beforeEach(async () => {
  // A fixed day, so a run that crosses midnight names the same edition as the test does.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 6, 12));
  journals = new Journals();
  t = await testYami({ modules: [journals] });
  ({ vault } = t);
  await vault.write("journals/cs566-notes/labs/Lab 1.md", "---\ntags: [lab]\n---\nThe loss fell after the warmup.\n");
  await vault.write("journals/cs566-notes/Week 1.md", "Backprop is the chain rule.\n");
  await vault.write("journals/garden/Tomatoes.md", "Plant after the frost.\n");
});
afterEach(async () => {
  vi.useRealTimers();
  await t.dispose();
});

const today = () => "2026-10-06";

describe("the journals module", () => {
  it("installs its policy, and has no sessions and no ledger", async () => {
    expect(await vault.exists("internal/journals/policies/journal-sources/POLICY.md")).toBe(true);
    expect(await vault.exists("internal/journals/sessions.base")).toBe(false);
    expect(await vault.exists("journals/sessions.base")).toBe(false);
    expect((await vault.read("internal/journals/journals.md"))).not.toContain("sessions.base");
    expect(journals.flows).toEqual([]);
    expect(journals.actions.map((a) => a.id)).toEqual(["publish"]);
  });

  it("names a volume by its folder", () => {
    expect(volumeName("cs566-notes")).toBe("CS566 Notes");
    expect(volumeName("garden_log 2026")).toBe("Garden Log 2026");
    expect(volumeName("ml")).toBe("Ml");
  });
});

describe("volumes and publish", () => {
  it("lists each volume with its notes, and how many wait to be published", async () => {
    expect(await volumes()).toEqual([
      { volume: "cs566-notes", name: "CS566 Notes", notes: 2, unpublished: 2 },
      { volume: "garden", name: "Garden", notes: 1, unpublished: 1 },
    ]);
  });

  it("publishes an edition: a source for each note, and a wiki ingest session with the journal policy", async () => {
    const edition = await publish("cs566-notes");
    expect(edition.session).toBe(`internal/wiki/sessions/CS566 Notes edition ${today()}.md`);
    expect(edition.sources.sort()).toEqual(["wiki/sources/Lab 1 (source).md", "wiki/sources/Week 1 (source).md"]);
    const session = await readDocument(vault, edition.session);
    expect(session.properties.module).toBe("wiki");
    expect(session.properties.sources).toHaveLength(2);
    expect(session.properties.policies).toEqual([
      "[[internal/wiki/policies/cite-every-claim/POLICY|cite-every-claim]]",
      "[[internal/wiki/policies/one-plan/POLICY|one-plan]]",
      "[[internal/wiki/policies/one-topic/POLICY|one-topic]]",
      "[[internal/journals/policies/journal-sources/POLICY|journal-sources]]",
    ]);
    expect((await readDocument(vault, "wiki/sources/Lab 1 (source).md")).properties.from).toBe("[[journals/cs566-notes/labs/Lab 1|Lab 1]]");
    expect((await volumes())[0]).toMatchObject({ unpublished: 0 });
  });

  it("refuses a volume with nothing new, and publishes only the notes that changed", async () => {
    await publish("cs566-notes");
    await expect(publish("cs566-notes")).rejects.toThrow("no change since its last publish");
    await vault.write("journals/cs566-notes/Week 1.md", "Backprop is the chain rule, applied backward.\n");
    expect(await volumes()).toContainEqual({ volume: "cs566-notes", name: "CS566 Notes", notes: 2, unpublished: 1 });
    const second = await publish("cs566-notes");
    expect(second).toEqual({ session: `internal/wiki/sessions/CS566 Notes edition ${today()} (2).md`, sources: ["wiki/sources/Week 1 (source 2).md"] });
    expect(await vault.read("journals/cs566-notes/Week 1.md")).toBe("Backprop is the chain rule, applied backward.\n");
  });

  it("refuses a volume that is no folder, holds no note, or is named by a path", async () => {
    await expect(publish("nothing")).rejects.toThrow("holds no note");
    await expect(publish("cs566-notes/labs")).rejects.toThrow("is not a volume");
    await expect(publish("")).rejects.toThrow("is not a volume");
  });
});

describe("what review found", () => {
  it("publishes a note again when it goes back to an older text", async () => {
    await publish("garden");
    await vault.write("journals/garden/Tomatoes.md", "Plant in May.\n");
    await publish("garden");
    await vault.write("journals/garden/Tomatoes.md", "Plant after the frost.\n");
    expect(await volumes()).toContainEqual({ volume: "garden", name: "Garden", notes: 1, unpublished: 1 });
    expect((await publish("garden")).sources).toEqual(["wiki/sources/Tomatoes (source 3).md"]);
  });

  it("gives two notes of one text one source, and counts a file directly under journals/ in no volume", async () => {
    await vault.write("journals/garden/Tomatoes copy.md", "Plant after the frost.\n");
    await vault.write("journals/Loose note.md", "Not in a volume.\n");
    expect(await volumes()).toEqual([
      { volume: "cs566-notes", name: "CS566 Notes", notes: 2, unpublished: 2 },
      { volume: "garden", name: "Garden", notes: 2, unpublished: 2 },
    ]);
    expect((await publish("garden")).sources).toHaveLength(1);
    expect((await volumes()).find((v) => v.volume === "garden")!.unpublished).toBe(0);
  });

  it("publishes a volume whose name holds a character no file name can take, before it captures anything", async () => {
    await vault.write("journals/c#-course/Lesson 1.md", "Types.\n");
    const edition = await publish("c#-course");
    expect(edition.session).toBe(`internal/wiki/sessions/C Course edition ${today()}.md`);
    expect(edition.sources).toEqual(["wiki/sources/Lesson 1 (source).md"]);
  });

  it("refuses a volume name that starts with a dot", async () => {
    await expect(publish(".hidden")).rejects.toThrow("is not a volume");
  });
});

describe("what the second review found", () => {
  it("publishes a note again after an edit back, in a volume whose name holds #", async () => {
    await vault.write("journals/C# course/Week 1.md", "A.\n");
    await publish("C# course");
    await vault.write("journals/C# course/Week 1.md", "B.\n");
    await publish("C# course");
    await vault.write("journals/C# course/Week 1.md", "A.\n");
    expect((await publish("C# course")).sources).toEqual(["wiki/sources/Week 1 (source 3).md"]);
  });
});

describe("the latest source", () => {
  it("is the newest by its time, also when it took a name an older source had freed", async () => {
    vi.setSystemTime(new Date(2026, 9, 6, 12));
    await publish("garden");
    vi.setSystemTime(new Date(2026, 9, 7, 12));
    await vault.write("journals/garden/Tomatoes.md", "Plant in May.\n");
    await publish("garden");
    await vault.remove("wiki/sources/Tomatoes (source).md");
    vi.setSystemTime(new Date(2026, 9, 8, 12));
    await vault.write("journals/garden/Tomatoes.md", "Plant after the frost, again.\n");
    expect((await publish("garden")).sources).toEqual(["wiki/sources/Tomatoes (source).md"]);
    expect((await volumes()).find((v) => v.volume === "garden")!.unpublished).toBe(0);
  });
});
