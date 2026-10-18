import { basename, documentName, linkTarget, type Document } from "../document/document.js";

/** A reviewer's verdict: a policy is `followed` or `broken`, a promise is `met` or `unmet`. */
export type Verdict = "followed" | "broken" | "met" | "unmet";

/** One thing that a review judges: a policy of the session, or a promise of the session that has no check. */
export interface ReviewItem {
  kind: "policy" | "promise";
  /** The document's name. */
  name: string;
  /** The document's vault path. */
  path: string;
}

/** What `yami_review` returns to the reviewer. */
export interface ReviewRecord {
  /** The verdicts that this call recorded. */
  recorded: number;
  /** Why a verdict of this call was not recorded. */
  errors: string[];
  /** The items that have no verdict yet. */
  remaining: ReviewItem[];
}

const PASSES: Record<ReviewItem["kind"], Verdict> = { policy: "followed", promise: "met" };
const FAILS: Record<ReviewItem["kind"], Verdict> = { policy: "broken", promise: "unmet" };

/** Whether a promise has no check, so that the review judges it. */
export function isJudged(promise: Document): boolean {
  const check = promise.properties.check;
  return typeof check !== "string" || check.trim() === "";
}

/** The verdicts of one review, as the reviewer records them with `yami_review`. A later verdict on an item replaces an earlier one. */
export class Review {
  readonly verdicts = new Map<string, { verdict: Verdict; reason: string }>();
  /** Whether the review runs. The run sets it false when the review ends, and `yami_review` then refuses. */
  open = true;

  constructor(readonly items: ReviewItem[]) {}

  /** The item that a path, a link, or a name names. */
  find(target: string): ReviewItem | undefined {
    const clean = linkTarget(target).replace(/\.md$/, "");
    return (
      this.items.find((item) => item.path.replace(/\.md$/, "") === clean) ??
      this.items.find((item) => item.name.toLowerCase() === documentName(`${clean}.md`).toLowerCase())
    );
  }

  record(verdicts: { item: string; verdict: Verdict; reason: string }[]): ReviewRecord {
    const errors: string[] = [];
    let recorded = 0;
    for (const { item: target, verdict, reason } of verdicts) {
      const item = this.find(target);
      if (!item) errors.push(`"${target}" is no policy or promise of this review. Judge only: ${this.items.map((i) => i.name).join(", ")}.`);
      else if (verdict !== PASSES[item.kind] && verdict !== FAILS[item.kind]) errors.push(`${item.name} is a ${item.kind}: its verdict is ${PASSES[item.kind]} or ${FAILS[item.kind]}, not ${verdict}.`);
      else {
        this.verdicts.set(item.path, { verdict, reason: reason.trim() });
        recorded += 1;
      }
    }
    return { recorded, errors, remaining: this.missing };
  }

  /** The items with no verdict. */
  get missing(): ReviewItem[] {
    return this.items.filter((item) => !this.verdicts.has(item.path));
  }

  /** The items whose verdict is broken or unmet, with the verdict. */
  get failed(): (ReviewItem & { verdict: Verdict; reason: string })[] {
    return this.items.flatMap((item) => {
      const v = this.verdicts.get(item.path);
      return v && v.verdict === FAILS[item.kind] ? [{ ...item, ...v }] : [];
    });
  }

  /** One line: how many of each verdict, and the items with none. */
  summary(): string {
    const count = (verdict: Verdict) => [...this.verdicts.values()].filter((v) => v.verdict === verdict).length;
    const policies = this.items.some((i) => i.kind === "policy") ? [`${count("followed")} followed`, `${count("broken")} broken`] : [];
    const promises = this.items.some((i) => i.kind === "promise") ? [`${count("met")} met`, `${count("unmet")} unmet`] : [];
    const missing = this.missing;
    return `review: ${[...policies, ...promises].join(", ")}${missing.length ? `; no verdict on ${missing.map((i) => i.name).join(", ")}` : ""}`;
  }

  /** Whether a verdict passes: followed or met. */
  static passes(verdict: Verdict): boolean {
    return verdict === "followed" || verdict === "met";
  }
}

/** The first message of a review. */
export function reviewPrompt(options: {
  path: string;
  kind: string;
  conversation: string | undefined;
  session: Document;
  reply: string | undefined;
  policies: Document[];
  promises: Document[];
}): string {
  const { path, session, policies, promises } = options;
  const section = (title: string, docs: Document[]) =>
    docs.length ? `## ${title}\n\n${docs.map((d) => `### ${documentName(d.path)}\n\nPath: ${d.path}\n\n${d.body.trim()}`).join("\n\n")}` : "";
  return [
    `You review the Yami session "${basename(path)}", ${options.kind}. You judge the work, and you change no file.`,
    `The session document is ${path}. ${options.conversation ? `The conversation note ${options.conversation} records the run: the worker's messages and its tool calls. ` : ""}Read the files that the work changed, and any other file that you need. You can run commands that only read or check, such as git log or the tests.`,
    `Judge each policy and each promise below, and only these: ${[...policies, ...promises].map((d) => documentName(d.path)).join(", ")}. Yami's checks decided the other promises of the session. A policy is \`followed\` or \`broken\`. A promise is \`met\` or \`unmet\`. Give each verdict a reason of one or two sentences that names the evidence. Record the verdicts with the tool \`yami_review\`. An item with no recorded verdict is not judged, and then a person must look at the session.`,
    `## Session\n\n${session.body.trim()}`,
    options.reply?.trim() ? `## The worker's last message\n\n${options.reply.trim()}` : "",
    section("Policies", policies),
    section("Promises", promises),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The message to the worker after a review that found a broken policy or an unmet promise. */
export function reviewFeedback(review: Review): string {
  const lines = review.failed.map((item) => `- ${item.name} (${item.kind}): ${item.verdict}, ${item.reason}`);
  return `A reviewer judged your work after your last turn.\n\n${lines.join("\n")}\n\nFix what is broken or unmet. Follow the policies.`;
}
