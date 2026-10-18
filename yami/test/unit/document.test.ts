import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readDocument, updateDocument, writeDocument } from "../../src/document/index.js";
import { FsVault } from "../../src/testing/index.js";

let root: string | undefined;
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
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
