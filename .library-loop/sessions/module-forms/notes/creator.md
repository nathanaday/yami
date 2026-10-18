# Creator notes · module-forms

## Round 1 (0.6.0)
- Built R1 to R13. Forms in `FORMS` (schema.ts). One name resolver: `resolveForm`/`parseName` (links.ts). Shared fresh run: `freshRun` (fresh-run.ts), used by the review and `runAgent` (agent-run.ts). `yami.tools(caller)` binds `yami_agent` to its caller.
- Stop and kill share one `RunControl.signal`; kill aborts with `KILL`.
- A code module installs no FLOW.md (now in design.md).
- Claude adapter denies the subagents of a skill set's `agents/` (`setAgents`).

## Round 2 (0.7.0)
- F1.1 (ruling): read-only Claude sessions get Bash in Claude Code's sandbox: `allowUnsandboxedCommands: false`, `failIfUnavailable: true`, denyWrite = cwd, home, and every root folder except /tmp and /dev (a deny beats an allow from any setting). Denying "/" breaks every command: Claude writes /tmp/claude-<uid>/cwd-* after each one. A read-only session denies every permission request itself. The user's `sandbox.excludedCommands` become `Bash(...)` deny rules (I proved they escape with an allow rule). Codex read-only writes nowhere, not even TMPDIR. Live test on both passed; the full live suite passed (36).
- F1.2: agent runs go to the session's Progress section (start line + end line). `details().agentRuns` parses them; "started" + not live = stopped. I did not add a core field, because Entities 4 lists the core fields. `updateDocument` now runs the updates of one document one after another (per vault+path), because parallel agents raced.
- F1.3: note `<module> <session> <agent>`; a conversation keeps `<module> <agent>`.
- F1.4: `flow.title`; `SessionDocument.description`.
- F1.5: refuse a `## ` line in a request (no escaping).
- New file `src/module/progress.ts` (addProgress, readProgress, oneLine).
- Probes need a scratch folder inside yami/ (the guard blocks writes elsewhere): I used node_modules/.probe and deleted it. The guard also blocks the text "git log" in a Bash command.

## Watch next round
- Whether the consumer's threads tools write the session document with `updateDocument` (they should, to not race the agent lines).
- Policy proposals 1–4 in round-02/response.md.
- Residual: Claude read-only commands may write under /tmp. This is documented, and it is the one difference from Codex.
- Out of scope, to decline: ingest workers as agents, agents that call agents, checks on an agent's output.
