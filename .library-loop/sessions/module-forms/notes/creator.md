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

## Round 4 (0.9.0)
- Ruling, network. Claude: `network.strictAllowlist: true` in the read-only sandbox. Before it, Claude Code sent `SandboxNetworkAccess {host}` to canUseTool, and the "not Bash" rule denied it only by luck. Codex: the profile has no network by default, but a host `--config permissions.yami-read-only.network.enabled=true` turned it on (http=200). Now `network.enabled=false` comes after the host's config. Live test "off the network" (curl example.org, git push to a local bare remote).
- Ruling, refuse. Probes: project/local `allowWrite`, `Edit(//tmp/**)`, `additionalDirectories`, `sdkOptions.settings`, and `allowedTools` do NOT widen a read-only sandbox. Only the user and managed layers do (from the CLI source: `Kae`, `ffe`). Path rules (KAr/qAr): allowWrite `//x`=`/x`, `/x` absolute, relative to the settings folder; Edit `//x` absolute, `/x` = settings folder + x (user: the config dir; managed: cwd), else relative to cwd. `bindingSettings` + `refuseWideWrites` in claude.ts. User-layer live proof is impossible without editing the real ~/.claude settings. Unit test only.
- F3.2: `READ_ONLY_RULE` + `sessionInstructions` (scratch.ts), in both adapters' instructions, not in Yami's prompts. The fake-claude `initialize` prompt returns the SDK's initialize request (appendSystemPrompt).
- F3.3: one `LEVEL_2` regex (document.ts) for check and section end. F3.1: `checkSection` exported.
- Found: Claude Code 2.1.302 backgrounds a running Bash command on interrupt (`turnAbortBackgrounds`). The live interrupt test failed on 0.8.0 too. Fix: `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` default in env; a host sets "" to opt out ("0" is truthy there). Interrupt test now waits for the process, and uses sleep 45/46 by harness (the suites run in parallel).
- Guard: Write is allowed only in yami/ and session files; Bash text "git log" is blocked (use Edit for README text).

## Watch next round
- Policy proposals 1–2 in round-04/response.md (background tasks, network/refuse facts).
- Did the consumer's plugin use Claude background tasks? 0.9.0 turns them off.
- Out of scope, to decline: ingest workers as agents, agents that call agents, checks on an agent's output.
