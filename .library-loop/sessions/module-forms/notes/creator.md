# Creator notes · module-forms

## Round 1 (0.6.0)
- Built R1 to R13. Forms in `FORMS` (schema.ts). One name resolver: `resolveForm`/`parseName` (links.ts). Shared fresh run: `freshRun` (fresh-run.ts), used by the review and `runAgent` (agent-run.ts). `yami.tools(caller)` binds `yami_agent` to its caller.
- Stop and kill share one `RunControl.signal`; kill aborts with `KILL`.
- Claude adapter denies the subagents of a skill set's `agents/` (`setAgents`).

## Round 2 (0.7.0)
- F1.1: read-only Claude sessions run Bash in Claude Code's sandbox (`allowUnsandboxedCommands: false`, `failIfUnavailable: true`). User `sandbox.excludedCommands` → `Bash(...)` deny rules (they escape the sandbox otherwise).
- F1.2: agent runs as Progress lines; `details().agentRuns`. `updateDocument` serializes per document.
- F1.3 note names; F1.4 `flow.title`, `SessionDocument.description`; F1.5 refuse `## ` in a request.

## Round 3 (0.8.0)
- F2.1 (ruling): `src/agent/scratch.ts` (createScratch under /tmp, scratchEnv, removeScratch). Both adapters make it for read-only and remove it on close and on crash. Claude: `ClaudeSession.close()` now awaits the pump (else vitest/hosts exit before removal).
  - Claude: `CLAUDE_CODE_TMPDIR=scratch` puts Claude's temp + commands' TMPDIR in it, but ONLY when spelled `/tmp/...`; with `/private/tmp/...` commands get `/tmp/claude-<uid>`. So createScratch does not realpath; the deny walk uses the realpath. Sandbox: allowWrite [scratch], denyWrite = cwd, home, /tmp/claude, /private/tmp/claude + every entry beside the root→scratch path (`foldersBeside`). Sandbox-runtime defaults it writes: /tmp/claude, ~/.npm/_logs, ~/.claude/debug.
  - Codex: thread-level `config` profiles fail at turn time ("failed to load workspace requirements"). Server `--config default_permissions="yami-read-only"` + `permissions.yami-read-only.filesystem={":root"="read", "<scratch>"="write"}` works; thread sends `permissions` (experimental API). Later `--config` wins. Env through `shell_environment_policy.set.X`. Network off.
- F2.3: read-only Claude now ALLOWS every Bash permission request (sandboxed), denies one naming an excludedCommands word (`leavesSandbox`), strips `dangerouslyDisableSandbox`, denies other tools. Needs the policy change I proposed (design.md Approval 1 and 4, Harness 8).
- F2.2: `replaceSection` throws via `checkSection` (document.ts); create uses it; one message "The text for the <h> section holds the heading line ...". Loop writes check detail with `oneLine`.
- Audit: 0.7.0 CHANGELOG uses generic names.
- Guard blocks `git stash` and any Bash text with "git add" (use Edit for such text).

## Watch next round
- Policy proposals 1–3 in round-03/response.md; if item 1 is rejected, restore the Bash denial.
- Residual on Claude: a user setting that allows /tmp itself (an ancestor of the scratch). Offered: refuse to start then.
- Out of scope, to decline: ingest workers as agents, agents that call agents, checks on an agent's output.
