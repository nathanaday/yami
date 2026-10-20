import { describe, expect, it } from "vitest";
import { diffLines, type DiffLine } from "../../src/panel/diff";

/** A diff as a person reads it: one line each, `-`/`+`/` ` first, marked pieces in brackets, a fold as `…n`. */
function show(lines: DiffLine[]): string[] {
  return lines.map((line) => (line.kind === "skip" ? `…${line.count}` : `${{ same: " ", del: "-", add: "+" }[line.kind]}${line.parts.map((p) => (p.mark ? `[${p.text}]` : p.text)).join("")}`));
}

describe("diffLines", () => {
  it("marks an insertion inside a line, and keeps the lines around it", () => {
    const before = "---\ntype: topic\n---\nCompost feeds the soil.\nLine two.\n";
    const after = "---\ntype: topic\n---\nCompost feeds the soil and holds water.\nLine two.\n";
    expect(show(diffLines(before, after))).toEqual(["…1", " type: topic", " ---", "-Compost feeds the soil.", "+Compost feeds the soil[ and holds water].", " Line two."]);
  });

  it("marks a deletion, and a replaced word on both sides", () => {
    expect(show(diffLines("a\nb\nc\n", "a\nc\n"))).toEqual([" a", "-[b]", " c"]);
    expect(show(diffLines("The quick fox\n", "The slow fox\n"))).toEqual(["-The [quick] fox", "+The [slow] fox"]);
  });

  it("folds unchanged context to two lines at each edge, and one edge at the ends", () => {
    const same = Array.from({ length: 10 }, (_, i) => `line ${i}`);
    const before = [...same, "old", ...same].join("\n");
    const after = [...same, "new", ...same].join("\n");
    expect(show(diffLines(before, after))).toEqual(["…8", " line 8", " line 9", "-[old]", "+[new]", " line 0", " line 1", "…8"]);
    expect(show(diffLines(before, after, 0))).toEqual(["…10", "-[old]", "+[new]", "…10"]);
  });

  it("shows a create as all added and a remove as all removed", () => {
    expect(show(diffLines("", "one\ntwo\n"))).toEqual(["+[one]", "+[two]"]);
    expect(show(diffLines("one\ntwo\n", ""))).toEqual(["-[one]", "-[two]"]);
  });

  it("adds a line at the end after a text with no final newline", () => {
    expect(show(diffLines("a\nb", "a\nb\nc"))).toEqual([" a", " b", "+[c]"]);
  });

  it("gives nothing for two equal texts, since the context alone is folded away", () => {
    expect(show(diffLines("a\nb\nc\n", "a\nb\nc\n"))).toEqual(["…3"]);
  });
});
