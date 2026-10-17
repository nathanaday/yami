import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { parseFeedback, parseResponse, status } from "../protocol.mjs";

const code = "```ts\nyami.sync({ since })\n```";

describe("parseFeedback", () => {
  test("reads items, titles, and reopens", () => {
    const parsed = parseFeedback(
      `# Feedback\n\nverdict: not-done\n\n## F2.1 · gap · major · No change feed\nreopens: F1.4\n${code}\n\n## F2.2 · nit · nit · A name\nThe name reads oddly.\n`,
      2,
    );
    assert.deepEqual(parsed.errors, []);
    assert.equal(parsed.verdict, "not-done");
    assert.deepEqual(parsed.items[0], { id: "F2.1", kind: "gap", severity: "major", title: "No change feed", reopens: "F1.4" });
    assert.equal(parsed.items[1].reopens, null);
  });

  test("names each format error", () => {
    const { errors } = parseFeedback(`## Summary\n\n## F1.1 · gap · huge\nno code\n## F1.1 · nit · nit\n`, 2);
    assert.deepEqual(errors, [
      `the preamble needs "verdict: done" or "verdict: not-done".`,
      `line 1: "## Summary" is not an item heading "## F2.<n> · <kind> · <severity> · <title>".`,
      "F1.1: an item of round 2 is numbered F2.<n>.",
      "F1.1: the severity \"huge\" is not one of blocker, major, minor, nit.",
      "F1.1: a gap item needs a code block: the code you tried, or the call site you wish for.",
      "F1.1: an item of round 2 is numbered F2.<n>.",
      "F1.1: the id is used twice.",
    ]);
  });

  test("ignores headings inside code blocks, and takes either fence", () => {
    const parsed = parseFeedback("verdict: not-done\n## F1.1 · gap · minor\n~~~md\n## not an item\n~~~\n", 1);
    assert.deepEqual(parsed.errors, []);
    assert.equal(parsed.items.length, 1);
  });

  test("refuses done with a major item open", () => {
    const { errors } = parseFeedback(`verdict: done\n## F1.1 · bug · major\n${code}\n`, 1);
    assert.match(errors[0], /verdict: done" with a blocker or major item open/);
  });
});

describe("parseResponse", () => {
  const asked = [{ id: "F1.1" }, { id: "F1.2" }, { id: "F1.3" }];
  test("needs one answer for each item, and a reason for each decline", () => {
    const { errors, answers } = parseResponse(`verdict: ready\n## F1.1 · accepted\n## F1.2 · declined\n\n## Policy\nA change.\n## F1.9 · accepted\n`, asked);
    assert.equal(answers.get("F1.1"), "accepted");
    assert.deepEqual(errors, ["F1.2: a declined item needs its reason.", "F1.9: the last feedback has no such item.", "F1.3: no answer."]);
  });
});

describe("status", () => {
  const session = (first = "creator") => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "library-loop-status-"));
    writeFileSync(path.join(dir, "session.json"), JSON.stringify({ slug: "s", first, max_rounds: 3 }));
    const write = (round, name, text) => {
      mkdirSync(path.join(dir, `round-0${round}`, "api"), { recursive: true });
      if (name) writeFileSync(path.join(dir, `round-0${round}`, name), text);
    };
    return { dir, write };
  };

  test("names the next step", () => {
    const { dir, write } = session();
    assert.equal(status(dir).next, "round");
    mkdirSync(path.join(dir, "round-01"));
    assert.equal(status(dir).next, "creator");
    writeFileSync(path.join(dir, "round-01/response.md"), "verdict: ready\n");
    assert.equal(status(dir).next, "snapshot");
    write(1);
    assert.equal(status(dir).next, "consumer");
    write(1, "feedback.md", `verdict: not-done\n## F1.1 · gap · blocker · No sync\n${code}\n`);
    const s = status(dir);
    assert.equal(s.next, "overseer");
    assert.equal(s.done, false);
    assert.deepEqual(s.open.map((i) => i.id), ["F1.1"]);
    rmSync(dir, { recursive: true });
  });

  test("a round 0 by the consumer needs no response", () => {
    const { dir, write } = session("consumer");
    write(0, "feedback.md", `verdict: not-done\n## F0.1 · gap · major\n${code}\n`);
    const s = status(dir);
    assert.deepEqual(s.errors, []);
    assert.equal(s.done, false);
    rmSync(dir, { recursive: true });
  });

  test("is done when both sides agree, and keeps what stays unresolved", () => {
    const { dir, write } = session();
    write(1, "response.md", "verdict: not-ready\n");
    write(1, "feedback.md", `verdict: not-done\n## F1.1 · gap · major\n${code}\n## F1.2 · nit · nit\nA name.\n## F1.3 · ergonomics · minor\n${code}\n`);
    write(2, "response.md", "verdict: ready\n## F1.1 · accepted\n## F1.2 · declined\nThe name is right.\n## F1.3 · deferred\nLater.\n");
    write(2, "feedback.md", "verdict: done\n## F2.1 · docs · minor\nreopens: F1.3\nStill awkward.\n");
    const s = status(dir);
    assert.deepEqual(s.errors, []);
    assert.equal(s.done, true);
    assert.deepEqual(s.unresolved.map((i) => [i.id, i.answer]), [["F1.2", "declined"], ["F2.1", "unanswered"]]);
    rmSync(dir, { recursive: true });
  });

  test("escalates an item reopened twice, and a decline declined again", () => {
    const { dir, write } = session();
    write(1, "response.md", "verdict: not-ready\n");
    write(1, "feedback.md", `verdict: not-done\n## F1.1 · gap · major\n${code}\n## F1.2 · gap · major\n${code}\n`);
    write(2, "response.md", "verdict: ready\n## F1.1 · declined\nApp logic.\n## F1.2 · accepted\n");
    write(2, "feedback.md", `verdict: not-done\n## F2.1 · gap · major\nreopens: F1.1\n${code}\n## F2.2 · gap · major\nreopens: F1.2\n${code}\n`);
    write(3, "response.md", "verdict: ready\n## F2.1 · declined\nStill app logic.\n## F2.2 · accepted\n");
    write(3, "feedback.md", `verdict: not-done\n## F3.1 · gap · major\nreopens: F2.2\n${code}\n`);
    const s = status(dir);
    assert.deepEqual(s.escalate, [
      { id: "F2.1", reason: "declined twice: F1.1, then F2.1" },
      { id: "F3.1", reason: "reopened twice: F1.2 → F2.2 → F3.1" },
    ]);
    assert.equal(s.limit_reached, true);
    rmSync(dir, { recursive: true });
  });

  test("reports feedback without a response, and a reopen of nothing", () => {
    const { dir, write } = session();
    write(1, "feedback.md", `verdict: not-done\n## F1.1 · gap · major\nreopens: F0.9\n${code}\n`);
    assert.deepEqual(status(dir).errors, [
      "round-01: feedback.md exists without response.md.",
      "round-01/feedback.md: F1.1 reopens F0.9, which does not exist.",
    ]);
    rmSync(dir, { recursive: true });
  });
});
