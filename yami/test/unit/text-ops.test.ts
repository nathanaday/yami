import { describe, expect, it, vi } from "vitest";

// A plugin's unit test imports the text operations with no Obsidian at all: any import of it fails here.
vi.mock("obsidian", () => {
  throw new Error("yami/document loaded obsidian.");
});

import { applyOps, deltaOps, diffOps, normalizeNewlines, shiftOps } from "../../src/document/index.js";

describe("the text operations of yami/document", () => {
  it.each([
    ["The quick brown fox", "The slow brown fox"],
    ["one\ntwo\nthree", "one\n2\nthree\nfour"],
    ["", "new text"],
    ["old text", ""],
    ["abc", "abc"],
  ])("diffOps turns %j into %j", (before, after) => {
    expect(applyOps(before, diffOps(before, after))).toBe(after);
  });

  it("joins a delete and an insert at one spot into one replacement", () => {
    expect(diffOps("The quick fox", "The slow fox")).toEqual([{ from: 4, to: 9, insert: "slow" }]);
  });

  it("turns a text delta into ops on the text before the change, and shifts them", () => {
    const ops = deltaOps([{ retain: 4 }, { delete: 5 }, { insert: "slow" }, { retain: 4 }, { insert: "!" }]);
    expect(ops).toEqual([
      { from: 4, to: 9, insert: "slow" },
      { from: 13, to: 13, insert: "!" },
    ]);
    expect(applyOps("The quick fox", ops)).toBe("The slow fox!");
    expect(shiftOps(ops, 2)).toEqual([
      { from: 6, to: 11, insert: "slow" },
      { from: 15, to: 15, insert: "!" },
    ]);
    expect(normalizeNewlines("a\r\nb\rc")).toBe("a\nb\nc");
  });
});
