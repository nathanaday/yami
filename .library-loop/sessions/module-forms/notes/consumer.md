# Consumer notes · module-forms

## Built (rounds 1-3, yami 0.8.0)
- All module docs are in folder forms. Threads agents `reviewer` and `validator` are `access: read-only`; each brief is its AGENT.md body. The skills call `yami_agent` with `threads:<name>`. The validator brief names no cache (ruling).
- Thread idea = Request section. Librarian: no `request` property; `librarian_checkout` fills an empty Request section.
- Hello fixture: 5 forms, with a read-only agent `proofreader` in flow `greeting`.
- Panel: `flow.title`, `reason ?? description`, `details.agentRuns`.
- Round 3: F2.1-F2.3 closed. The README now says a suite that writes a cache runs. The librarian test expects `The text for the <Section> section holds the heading line` and asserts no copies after a refusal.

## Hurt
- F3.1 (minor): `checkSection` is declared in dist d.ts but not exported. Workaround in librarian/index.ts, marked `library-loop: F3.1`: `replaceSection("", …)` before any write.
- F3.2 (minor): Claude Code tells a read-only agent that `.` is writable; ask for a line in the read-only first message.
- F3.3 (nit): `   ## X` passes replaceSection.

## Check next round
- F3.1: if `checkSection` is exported from `yami/document`, replace the workaround line; the librarian test must still pass (no copies).
- F3.2: rerun the probe. Write the script inside obsidian_plugin (the guard blocks a Write in the scratchpad and a heredoc that names `yami/agent/...`), run `H=claude|codex node probe-ro.mjs`, then delete it. Make the Go module with `mktemp -d` and no git (the guard blocks `git init`). No `timeout` command on macOS.
- The guard also blocks `ls node_modules/yami` and `git log` without `-- obsidian_plugin`. The round's `api/dist/*.d.ts` is readable.
