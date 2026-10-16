import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readDocument } from "../../src/document/index.js";
import { createSession, enableModule } from "../../src/module/index.js";
import { journals, publish, volumeName, volumes } from "../../src/modules/journals/index.js";
import { wiki as wikiModule } from "../../src/modules/wiki.js";
import { FsVault } from "../fixtures/fs-vault.js";

let root = "";
let vault: FsVault;

beforeEach(async () => {
  // A fixed day, so a run that crosses midnight names the same edition as the test does.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 6, 12));
  root = await mkdtemp(join(tmpdir(), "yami-journals-"));
  vault = new FsVault(root);
  await enableModule(vault, wikiModule);
  await enableModule(vault, journals);
  await vault.write("journals/cs566-notes/labs/Lab 1.md", "---\ntags: [lab]\n---\nThe loss fell after the warmup.\n");
  await vault.write("journals/cs566-notes/Week 1.md", "Backprop is the chain rule.\n");
  await vault.write("journals/garden/Tomatoes.md", "Plant after the frost.\n");
});
afterEach(async () => {
  vi.useRealTimers();
  if (root) await rm(root, { recursive: true, force: true });
});

const today = () => "2026-10-06";

describe("the journals module", () => {
  it("installs its policy, and has no sessions and no ledger", async () => {
    expect(await vault.exists("internal/journals/policies/Journal sources.md")).toBe(true);
    expect(await vault.exists("internal/journals/sessions.base")).toBe(false);
    expect(await vault.exists("journals/sessions.base")).toBe(false);
    expect((await vault.read("internal/journals/journals.md"))).not.toContain("sessions.base");
    await expect(createSession(vault, journals, "x")).rejects.toThrow("has no sessions");
  });

  it("names a volume by its folder", () => {
    expect(volumeName("cs566-notes")).toBe("CS566 Notes");
    expect(volumeName("garden_log 2026")).toBe("Garden Log 2026");
    expect(volumeName("ml")).toBe("Ml");
  });
});

describe("volumes and publish", () => {
  it("lists each volume with its notes, and how many wait to be published", async () => {
    expect(await volumes(vault)).toEqual([
      { volume: "cs566-notes", name: "CS566 Notes", notes: 2, unpublished: 2 },
      { volume: "garden", name: "Garden", notes: 1, unpublished: 1 },
    ]);
  });

  it("publishes an edition: a source for each note, and a wiki ingest session with the journal policy", async () => {
    const edition = await publish(vault, "cs566-notes");
    expect(edition.session).toBe(`internal/wiki/sessions/CS566 Notes edition ${today()}.md`);
    expect(edition.sources.sort()).toEqual(["wiki/sources/Lab 1 (source).md", "wiki/sources/Week 1 (source).md"]);
    const session = await readDocument(vault, edition.session);
    expect(session.properties.module).toBe("wiki");
    expect(session.properties.sources).toHaveLength(2);
    expect(session.properties.policies).toEqual([
      "[[internal/wiki/policies/Cite every claim|Cite every claim]]",
      "[[internal/wiki/policies/Change the wiki through one plan|Change the wiki through one plan]]",
      "[[internal/wiki/policies/One subject, one topic|One subject, one topic]]",
      "[[internal/journals/policies/Journal sources|Journal sources]]",
    ]);
    expect((await readDocument(vault, "wiki/sources/Lab 1 (source).md")).properties.from).toBe("[[journals/cs566-notes/labs/Lab 1|Lab 1]]");
    expect((await volumes(vault))[0]).toMatchObject({ unpublished: 0 });
  });

  it("refuses a volume with nothing new, and publishes only the notes that changed", async () => {
    await publish(vault, "cs566-notes");
    await expect(publish(vault, "cs566-notes")).rejects.toThrow("no change since its last publish");
    await vault.write("journals/cs566-notes/Week 1.md", "Backprop is the chain rule, applied backward.\n");
    expect(await volumes(vault)).toContainEqual({ volume: "cs566-notes", name: "CS566 Notes", notes: 2, unpublished: 1 });
    const second = await publish(vault, "cs566-notes");
    expect(second).toEqual({ session: `internal/wiki/sessions/CS566 Notes edition ${today()} (2).md`, sources: ["wiki/sources/Week 1 (source 2).md"] });
    expect(await vault.read("journals/cs566-notes/Week 1.md")).toBe("Backprop is the chain rule, applied backward.\n");
  });

  it("refuses a volume that is no folder, holds no note, or is named by a path", async () => {
    await expect(publish(vault, "nothing")).rejects.toThrow("holds no note");
    await expect(publish(vault, "cs566-notes/labs")).rejects.toThrow("is not a volume");
    await expect(publish(vault, "")).rejects.toThrow("is not a volume");
  });
});

describe("what review found", () => {
  it("publishes a note again when it goes back to an older text", async () => {
    await publish(vault, "garden");
    await vault.write("journals/garden/Tomatoes.md", "Plant in May.\n");
    await publish(vault, "garden");
    await vault.write("journals/garden/Tomatoes.md", "Plant after the frost.\n");
    expect(await volumes(vault)).toContainEqual({ volume: "garden", name: "Garden", notes: 1, unpublished: 1 });
    expect((await publish(vault, "garden")).sources).toEqual(["wiki/sources/Tomatoes (source 3).md"]);
  });

  it("gives two notes of one text one source, and counts a file directly under journals/ in no volume", async () => {
    await vault.write("journals/garden/Tomatoes copy.md", "Plant after the frost.\n");
    await vault.write("journals/Loose note.md", "Not in a volume.\n");
    expect(await volumes(vault)).toEqual([
      { volume: "cs566-notes", name: "CS566 Notes", notes: 2, unpublished: 2 },
      { volume: "garden", name: "Garden", notes: 2, unpublished: 2 },
    ]);
    expect((await publish(vault, "garden")).sources).toHaveLength(1);
    expect((await volumes(vault)).find((v) => v.volume === "garden")!.unpublished).toBe(0);
  });

  it("publishes a volume whose name holds a character no file name can take, before it captures anything", async () => {
    await vault.write("journals/c#-course/Lesson 1.md", "Types.\n");
    const edition = await publish(vault, "c#-course");
    expect(edition.session).toBe(`internal/wiki/sessions/C Course edition ${today()}.md`);
    expect(edition.sources).toEqual(["wiki/sources/Lesson 1 (source).md"]);
  });

  it("refuses a volume name that starts with a dot", async () => {
    await expect(publish(vault, ".hidden")).rejects.toThrow("is not a volume");
  });
});

describe("what the second review found", () => {
  it("publishes a note again after an edit back, in a volume whose name holds #", async () => {
    await vault.write("journals/C# course/Week 1.md", "A.\n");
    await publish(vault, "C# course");
    await vault.write("journals/C# course/Week 1.md", "B.\n");
    await publish(vault, "C# course");
    await vault.write("journals/C# course/Week 1.md", "A.\n");
    expect((await publish(vault, "C# course")).sources).toEqual(["wiki/sources/Week 1 (source 3).md"]);
  });
});

describe("the latest source", () => {
  it("is the newest by its time, also when it took a name an older source had freed", async () => {
    vi.setSystemTime(new Date(2026, 9, 6, 12));
    await publish(vault, "garden");
    vi.setSystemTime(new Date(2026, 9, 7, 12));
    await vault.write("journals/garden/Tomatoes.md", "Plant in May.\n");
    await publish(vault, "garden");
    await vault.remove("wiki/sources/Tomatoes (source).md");
    vi.setSystemTime(new Date(2026, 9, 8, 12));
    await vault.write("journals/garden/Tomatoes.md", "Plant after the frost, again.\n");
    expect((await publish(vault, "garden")).sources).toEqual(["wiki/sources/Tomatoes (source).md"]);
    expect((await volumes(vault)).find((v) => v.volume === "garden")!.unpublished).toBe(0);
  });
});
