import { defineTool, z } from "../agent/index.js";
import type { AgentTool, ToolSet } from "../agent/types.js";
import { linkTarget } from "../document/document.js";
import { AGENT_TOOL, AgentError, runAgent, type AgentCaller } from "./agent-run.js";
import { YAMI_ID } from "./base-skill.js";
import type { Review } from "./review.js";
import type { Yami } from "./yami.js";

/** A session document's path from what an agent gives: a path with or without `.md`, or a `[[link]]`. */
function sessionPath(value: string): string {
  const target = linkTarget(value);
  return target.endsWith(".md") ? target : `${target}.md`;
}

/**
 * The tools of Yami itself that every agent gets, beside the modules' tools: `yami_check`, the self-check
 * that an agent calls before it ends a turn, and `yami_agent`, which runs an agent for the caller. The
 * agents that `yami_agent` runs get `served`, the tool set of the caller, as their access allows.
 */
export function yamiTools(yami: Yami, caller: AgentCaller, served: () => ToolSet): AgentTool[] {
  return [
    defineTool({
      name: `${YAMI_ID}_check`,
      description:
        "Runs the checks of a session's promises now, and returns each result: met, unmet, or review (Yami cannot decide), with the detail. It records nothing in the session document. Call it before you end a turn, and fix each unmet promise. The promises in `judged` have no check: a reviewer judges them after your turn.",
      input: { session: z.string().describe("The session document, as a vault path.") },
      readOnly: true,
      title: ({ session }) => `Check ${session.slice(0, 80)}`,
      run: async ({ session }) => JSON.stringify(await yami.session(sessionPath(session)).check()),
    }),
    defineTool({
      name: AGENT_TOOL,
      description:
        "Runs an agent of a Yami module: a worker with its own brief, in a fresh context that knows nothing of yours. Give it a task with everything it needs: the paths to read, what to do, and what to answer. It works in the vault and returns its final message, with the conversation note that records its run. A read-only agent changes no file. Several calls run at the same time. An unknown name returns the agents you can call.",
      input: {
        agent: z.string().describe("The agent's name: a bare name for an agent of your session's module, or <module>:<name>."),
        task: z.string().min(1).describe("The task, in full: the agent sees only this and its brief."),
      },
      title: ({ agent, task }) => `Agent ${agent}: ${task.slice(0, 60)}`,
      run: async ({ agent, task }, { signal }) => {
        try {
          return JSON.stringify(await runAgent(yami, caller, agent, task, served(), signal));
        } catch (error) {
          if (error instanceof AgentError) return { text: error.message, isError: true };
          throw error;
        }
      },
    }),
  ];
}

/**
 * `yami_review`, the tool that records the verdicts of one review. Only that review's conversation gets
 * it, so no other agent can record a verdict, and it refuses once the review has ended.
 */
export function reviewTool(review: Review): AgentTool {
  return defineTool({
    name: `${YAMI_ID}_review`,
    description:
      "Records the verdicts of this review. A policy takes `followed` or `broken`, a promise `met` or `unmet`, each with a reason that names the evidence. A later verdict on an item replaces the earlier one. Returns what it recorded, the errors, and the items still to judge; call it with no `verdicts` to see them.",
    input: {
      verdicts: z
        .array(
          z.object({
            item: z.string().describe("The policy or the promise, as its path or its name."),
            verdict: z.enum(["followed", "broken", "met", "unmet"]),
            reason: z.string().min(1).describe("One or two sentences that name the evidence."),
          }),
        )
        .default([])
        .describe("One verdict for each policy and each promise of the review. Leave it out to see the items still to judge."),
    },
    title: ({ verdicts }) => (verdicts.length ? `Record ${verdicts.length} verdict(s)` : "List the items to judge"),
    run: async ({ verdicts }) => {
      if (!review.open) return { text: "This review has ended. A verdict counts only while its review runs.", isError: true };
      const result = review.record(verdicts);
      return { text: JSON.stringify(result), isError: result.errors.length > 0 };
    },
  });
}
