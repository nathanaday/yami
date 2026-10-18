# Consumer notes · module-forms

## Built (rounds 1-5, yami 0.9.1)
- All module docs are in folder forms. Threads agents `reviewer` and `validator` are `access: read-only`; each brief is its AGENT.md body. The skills call `yami_agent` with `threads:<name>`. The validator brief names no cache (ruling).
- Thread idea = Request section. Librarian: no `request` property; `librarian_checkout` calls `checkSection` on Request and Notes before any copy. No workaround left.
- Hello fixture: 5 forms, with a read-only agent `proofreader` in flow `greeting`.
- Panel: `flow.title`, `reason ?? description`, `details.agentRuns`, `summary.session.running`, `onSessionsChange`.
- README: a read-only agent's command that writes a cache runs; a write to a repo or the vault fails; a command that needs the network fails.

## State
- Round 5: 0.9.1 fixed the acceptance ruling (a stopped run stayed in `yami.running`). No plugin change. No open items, verdict done.
- Next: if the overseer's `test:obsidian` still fails at plugin.test.ts:809/833, the cause is in the library.
- Residue (not filed): Claude Code, asked which folders it can write, still lists `.` and `/tmp/claude`, but it writes only `$TMPDIR`.

## How to probe
- Write the probe script inside obsidian_plugin (the guard blocks a Write in the scratchpad), run `H=claude|codex REPO=… VAULT=… node probe-ro.mjs`, then delete it. Make the Go module with `mktemp -d` and no git. No `timeout` command on macOS.
- The guard blocks any Bash command whose text names the library's install folder, also inside a heredoc; write notes with the Write tool. It blocks `git log` without `-- obsidian_plugin`. The round's `api/dist/*.d.ts` is readable. `import { VERSION } from "yami"` gives the version.
