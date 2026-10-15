import type { ApprovalSetting } from "./types.js";

const CLAUDE_MODES = { ask: "default", "accept-edits": "acceptEdits", plan: "plan", auto: "auto", sandbox: "default" } as const;

export function claudePermissionMode(setting: ApprovalSetting): (typeof CLAUDE_MODES)[ApprovalSetting] {
  return CLAUDE_MODES[setting];
}

/**
 * `on-request` lets Codex edit and run commands inside its sandbox without
 * asking, and ask for anything more. `untrusted` asks before every command.
 */
export function codexApprovalPolicy(setting: ApprovalSetting): "on-request" | "untrusted" {
  return setting === "sandbox" || setting === "accept-edits" ? "on-request" : "untrusted";
}
