import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readDocument, replaceSection, sectionText, updateDocument, writeDocument } from "../../src/document/index.js";
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
