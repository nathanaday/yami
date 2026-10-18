import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkSection, readDocument, replaceSection, sectionText, updateDocument, writeDocument } from "../../src/document/index.js";
import { FsVault } from "../../src/testing/index.js";

let root: string | undefined;
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

describe("replaceSection", () => {
  it("refuses a text with a line that would start a section, and writes any other text", () => {
    const body = "# H\n\n## Request\n\n## Deliverables\n- [ ] x\n";
    expect(() => replaceSection(body, "Request", "Read on RL.\n## Deliverables\nsneaky")).toThrow(
      'The text for the Request section holds the heading line "## Deliverables", which would start a section of its own. Write it as plain text, or as a ### heading.',
    );
    const written = replaceSection(body, "Request", "Read on RL.\n### Notes\n#hashtag\n##no-space");
    expect(sectionText(written, "Request")).toBe("Read on RL.\n### Notes\n#hashtag\n##no-space");
    expect(sectionText(written, "Deliverables")).toBe("- [ ] x");
  });

  it("refuses a level-2 heading as Markdown reads it: indented by up to three spaces, or with no text", () => {
    const body = "# H\n\n## Request\n\n## Deliverables\n- [ ] x\n";
    expect(() => replaceSection(body, "Request", "Read.\n   ## Deliverables\nsneaky")).toThrow('holds the heading line "## Deliverables"');
    expect(() => replaceSection(body, "Request", "Read.\n##")).toThrow('holds the heading line "##"');
    // Four spaces make a code block, not a heading.
    expect(sectionText(replaceSection(body, "Request", "Read.\n    ## code"), "Request")).toBe("Read.\n    ## code");
  });

  it("ends a section at a heading that Markdown reads, also an indented one", () => {
    expect(sectionText("## Request\nA\n  ## Notes\nB\n", "Request")).toBe("A");
  });
});

describe("checkSection", () => {
  it("throws the message of replaceSection, so a tool checks a text before it writes anything", () => {
    expect(() => checkSection("Notes", "a\n## Deliverables")).toThrow(
      'The text for the Notes section holds the heading line "## Deliverables", which would start a section of its own. Write it as plain text, or as a ### heading.',
    );
    expect(() => checkSection("Notes", "a\n### Deliverables")).not.toThrow();
  });
});

describe("updateDocument", () => {
  it("runs the changes of one document one after another, so no change loses another", async () => {
    root = mkdtempSync(join(tmpdir(), "yami-update-"));
    const vault = new FsVault(root);
    await writeDocument(vault, { path: "a.md", properties: { n: 0 }, body: "" });
    await writeDocument(vault, { path: "b.md", properties: { n: 0 }, body: "" });
    const count = (doc: { properties: Record<string, unknown> }) => {
      doc.properties.n = Number(doc.properties.n) + 1;
    };
    await Promise.all([...Array.from({ length: 10 }, () => updateDocument(vault, "a.md", count)), updateDocument(vault, "b.md", count)]);
    expect((await readDocument(vault, "a.md")).properties.n).toBe(10);
    expect((await readDocument(vault, "b.md")).properties.n).toBe(1);
  });

  it("rejects the change that throws, and runs the next", async () => {
    root = mkdtempSync(join(tmpdir(), "yami-update-"));
    const vault = new FsVault(root);
    await writeDocument(vault, { path: "a.md", properties: { n: 0 }, body: "" });
    const failed = updateDocument(vault, "a.md", () => {
      throw new Error("no");
    });
    const next = updateDocument(vault, "a.md", (doc) => void (doc.properties.n = 1));
    await expect(failed).rejects.toThrow("no");
    expect((await next).properties.n).toBe(1);
  });
});
