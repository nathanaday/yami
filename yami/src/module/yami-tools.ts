import { defineTool, z } from "../agent/index.js";
import type { AgentTool } from "../agent/types.js";
import { linkTarget } from "../document/document.js";
import { YAMI_ID } from "./base-skill.js";
import { liveControl } from "./session.js";
import type { Yami } from "./yami.js";

/** A session document's path from what an agent gives: a path with or without `.md`, or a `[[link]]`. */
function sessionPath(value: string): string {
  const target = linkTarget(value);
  return target.endsWith(".md") ? target : `${target}.md`;
}

/**
 * The tools of Yami itself, beside the modules' tools, named `yami_<tool>`: `yami_check`, the self-check
 * that every agent calls before it ends a turn, and `yami_review`, which records a reviewer's verdicts.
 */
export function yamiTools(yami: Yami): AgentTool[] {
  const tools: AgentTool[] = [
    defineTool({
      name: "check",
      description:
        "Runs the checks of a session's promises now, and returns each result: met, unmet, or review (Yami cannot decide), with the detail. It records nothing in the session document. Call it before you end a turn, and fix each unmet promise. The promises in `judged` have no check: a reviewer judges them after your turn.",
      input: { session: z.string().describe("The session document, as a vault path.") },
      title: ({ session }) => `Check ${session.slice(0, 80)}`,
      run: async ({ session }) => JSON.stringify(await yami.session(sessionPath(session)).check()),
    }),
    defineTool({
      name: "review",
      description:
        "Records the verdicts of a review. Only the reviewer of a session calls it, while Yami reviews the session. A policy takes `followed` or `broken`, a promise `met` or `unmet`, each with a reason that names the evidence. A later verdict on an item replaces the earlier one. Returns what it recorded, the errors, and the items still to judge; call it with no verdicts to see them.",
      input: {
        session: z.string().describe("The session document, as a vault path."),
        verdicts: z
          .array(
            z.object({
              item: z.string().describe("The policy or the promise, as its path or its name."),
              verdict: z.enum(["followed", "broken", "met", "unmet"]),
              reason: z.string().min(1).describe("One or two sentences that name the evidence."),
            }),
          )
          .describe("One verdict for each policy and each promise of the review."),
      },
      title: ({ session, verdicts }) => `Record ${verdicts.length} verdict(s) on ${session.slice(0, 60)}`,
      run: async ({ session, verdicts }) => {
        const review = liveControl(yami.session(sessionPath(session)))?.review;
        if (!review) return { text: `No review of ${session} is live. Only the reviewer of a session records verdicts, while Yami reviews it.`, isError: true };
        const result = review.record(verdicts);
        return { text: JSON.stringify(result), isError: result.errors.length > 0 };
      },
    }),
  ];
  return tools.map((tool) => ({ ...tool, name: `${YAMI_ID}_${tool.name}` }));
}
