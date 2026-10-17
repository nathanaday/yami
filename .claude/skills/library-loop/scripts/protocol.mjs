import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const KINDS = ["bug", "gap", "ergonomics", "perf", "docs", "nit"];
export const SEVERITIES = ["blocker", "major", "minor", "nit"];
export const ANSWERS = ["accepted", "declined", "deferred"];
const OPEN = new Set(["blocker", "major"]);
const NEEDS_CODE = new Set(["bug", "gap", "ergonomics", "perf"]);
const SEP = String.raw`\s*[·|:—–-]\s*`;
const ITEM = new RegExp(String.raw`^## (F(\d+)\.\d+)${SEP}(\w+)${SEP}(\w+)(?:${SEP}(.*))?$`);
const ANSWER = new RegExp(String.raw`^## (F\d+\.\d+)${SEP}(\w+)(?:${SEP}(.*))?$`);

export const roundName = (n) => `round-${String(n).padStart(2, "0")}`;

/** Splits a document into its preamble and its `## ` sections. */
function sections(text) {
  const out = { preamble: [], sections: [] };
  let current = null;
  let fence = null;
  text.split("\n").forEach((line, index) => {
    const marker = /^\s*(```|~~~)/.exec(line)?.[1];
    if (marker && (!fence || fence === marker)) fence = fence ? null : marker;
    if (!fence && !marker && line.startsWith("## ")) {
      current = { heading: line.trim(), line: index + 1, body: [] };
      out.sections.push(current);
    } else {
      (current ? current.body : out.preamble).push(line);
    }
  });
  return out;
}

const verdictOf = (lines) => /^verdict:\s*(\S+)/m.exec(lines.join("\n"))?.[1];

export function parseFeedback(text, round) {
  const errors = [];
  const { preamble, sections: parts } = sections(text);
  const verdict = verdictOf(preamble);
  if (!["done", "not-done"].includes(verdict)) errors.push(`the preamble needs "verdict: done" or "verdict: not-done".`);
  const items = [];
  for (const { heading, line, body } of parts) {
    const m = ITEM.exec(heading);
    if (!m) {
      errors.push(`line ${line}: "${heading}" is not an item heading "## F${round}.<n> · <kind> · <severity> · <title>".`);
      continue;
    }
    const [, id, itemRound, kind, severity, title = ""] = m;
    const content = body.join("\n");
    const item = { id, kind, severity, title: title.trim(), reopens: /^reopens:\s*(F\d+\.\d+)/m.exec(content)?.[1] ?? null };
    if (Number(itemRound) !== round) errors.push(`${id}: an item of round ${round} is numbered F${round}.<n>.`);
    if (!KINDS.includes(kind)) errors.push(`${id}: the kind "${kind}" is not one of ${KINDS.join(", ")}.`);
    if (!SEVERITIES.includes(severity)) errors.push(`${id}: the severity "${severity}" is not one of ${SEVERITIES.join(", ")}.`);
    if (NEEDS_CODE.has(kind) && !/^\s*(```|~~~)/m.test(content)) {
      errors.push(`${id}: a ${kind} item needs a code block: the code you tried, or the call site you wish for.`);
    }
    if (items.some((i) => i.id === id)) errors.push(`${id}: the id is used twice.`);
    items.push(item);
  }
  if (verdict === "done" && items.some((i) => OPEN.has(i.severity))) {
    errors.push(`"verdict: done" with a blocker or major item open. Change the verdict or the severity.`);
  }
  return { verdict, items, errors };
}

export function parseResponse(text, asked) {
  const errors = [];
  const { preamble, sections: parts } = sections(text);
  const verdict = verdictOf(preamble);
  if (!["ready", "not-ready"].includes(verdict)) errors.push(`the preamble needs "verdict: ready" or "verdict: not-ready".`);
  const answers = new Map();
  for (const { heading, line, body } of parts) {
    if (heading === "## Policy") continue;
    const m = ANSWER.exec(heading);
    if (!m) {
      errors.push(`line ${line}: "${heading}" is not an answer heading "## <item id> · accepted|declined|deferred".`);
      continue;
    }
    const [, id, answer] = m;
    if (!ANSWERS.includes(answer)) errors.push(`${id}: the answer "${answer}" is not one of ${ANSWERS.join(", ")}.`);
    if (!asked.some((i) => i.id === id)) errors.push(`${id}: the last feedback has no such item.`);
    if (answers.has(id)) errors.push(`${id}: answered twice.`);
    if (answer !== "accepted" && !body.join("").trim()) errors.push(`${id}: a ${answer} item needs its reason.`);
    answers.set(id, answer);
  }
  for (const item of asked) if (!answers.has(item.id)) errors.push(`${item.id}: no answer.`);
  return { verdict, answers, errors };
}

export function listRounds(sessionDir) {
  if (!existsSync(sessionDir)) return [];
  return readdirSync(sessionDir)
    .filter((name) => /^round-\d+$/.test(name))
    .map((name) => ({ n: Number(name.slice(6)), dir: path.join(sessionDir, name) }))
    .sort((a, b) => a.n - b.n);
}

const readIf = (file) => (existsSync(file) ? readFileSync(file, "utf8") : null);

/** The state of a session, read from its round folders. */
export function status(sessionDir) {
  const session = JSON.parse(readFileSync(path.join(sessionDir, "session.json"), "utf8"));
  const rounds = listRounds(sessionDir);
  const errors = [];
  const items = new Map();
  const answers = new Map();
  let asked = [];
  let creator = null;
  let consumer = null;
  let lastAnswers = new Map();

  for (const { n, dir } of rounds) {
    const name = roundName(n);
    const response = readIf(path.join(dir, "response.md"));
    const feedback = readIf(path.join(dir, "feedback.md"));
    creator = null;
    consumer = null;
    lastAnswers = new Map();
    if (response !== null) {
      const parsed = parseResponse(response, asked);
      errors.push(...parsed.errors.map((e) => `${name}/response.md: ${e}`));
      for (const [id, answer] of parsed.answers) answers.set(id, answer);
      lastAnswers = parsed.answers;
      creator = { verdict: parsed.verdict };
    } else if (n > 0 && feedback !== null) {
      errors.push(`${name}: feedback.md exists without response.md.`);
    }
    if (feedback !== null) {
      const parsed = parseFeedback(feedback, n);
      errors.push(...parsed.errors.map((e) => `${name}/feedback.md: ${e}`));
      for (const item of parsed.items) {
        if (item.reopens && !items.has(item.reopens)) errors.push(`${name}/feedback.md: ${item.id} reopens ${item.reopens}, which does not exist.`);
        items.set(item.id, { ...item, round: n });
      }
      asked = parsed.items;
      consumer = { verdict: parsed.verdict };
    } else {
      asked = [];
    }
  }

  const last = rounds.at(-1);
  const latest = [...items.values()].filter((i) => i.round === last?.n);
  const escalate = [];
  for (const [id, answer] of lastAnswers) {
    const reopened = items.get(id)?.reopens;
    if (answer === "declined" && reopened && answers.get(reopened) === "declined") {
      escalate.push({ id, reason: `declined twice: ${reopened}, then ${id}` });
    }
  }
  for (const item of latest) {
    const chain = [item.id];
    for (let id = item.reopens; id; id = items.get(id)?.reopens) chain.unshift(id);
    if (chain.length >= 3) escalate.push({ id: item.id, reason: `reopened twice: ${chain.join(" → ")}` });
  }
  const superseded = new Set([...items.values()].map((i) => i.reopens).filter(Boolean));
  const unresolved = [...items.values()]
    .filter((i) => !superseded.has(i.id) && answers.get(i.id) !== "accepted")
    .map((i) => ({ ...i, answer: answers.get(i.id) ?? "unanswered" }));

  let next;
  if (!last) next = "round";
  else if (last.n > 0 && !creator) next = "creator";
  else if (!existsSync(path.join(last.dir, "api"))) next = "snapshot";
  else if (!consumer) next = "consumer";
  else next = "overseer";

  const open = latest.filter((i) => OPEN.has(i.severity));
  const done =
    next === "overseer" && !errors.length && last.n > 0 && creator?.verdict === "ready" && consumer?.verdict === "done" && !open.length;
  return {
    slug: session.slug,
    round: last?.n ?? null,
    max_rounds: session.max_rounds,
    limit_reached: (last?.n ?? 0) >= session.max_rounds,
    next,
    creator,
    consumer,
    open,
    escalate,
    unresolved,
    errors,
    done,
  };
}
