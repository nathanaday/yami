# Consumer notes · module-forms

## Built (rounds 1-2, yami 0.7.0)
- All module docs are in folder forms. Threads agents `reviewer` and `validator` are `access: read-only`; each brief is its AGENT.md body. The skills call `yami_agent` with `threads:<name>`.
- Thread idea = Request section. Librarian: no `request` property; `librarian_checkout` fills an empty Request section.
- Hello fixture: 5 forms, with a read-only agent `proofreader` in flow `greeting`.
- Round 2: panel meta uses `flow.title`; a document row shows `reason ?? description`; the Conversation section lists `details.agentRuns` (key `agent:<note>`, icon `bot`, note = STATUS_LABELS[status]). Tests use the new note names (`threads Divide validator.md`, `hello <session> proofreader.md`) and `agentRuns`. Validator brief: commands that read or check run; a command that writes fails → the requirement fails, notes names it.
- Live thread test passes (about 1 min). It now asserts a `threads:reviewer` run: the run skill's Small work section had let the worker skip /threads:spec.

## Hurt
- F2.1 (major, reopens F1.1): read-only can run git and node --test, but not `go test`/`go vet` (Go build cache in home; Claude denies, Codex denies all writes), and vitest fails on Codex. `GOCACHE=/tmp/... go test` is refused on Claude (an env prefix asks, and read-only denies).
- F2.2 (minor): only `create` refuses a `## ` line; `replaceSection` does not. Workaround in librarian/index.ts marked `library-loop: F2.2`.
- F2.3 (docs): the README lists a loop and `$(…)` as refused; a `VAR=value` prefix and `; echo $?` are refused too.

## Check next round
- F2.1: a cache/temp folder for read-only sessions → rerun the probe (scratchpad probe-ro.mjs pattern: ClaudeAgent/CodexAgent with access read-only, a Go module in `mktemp -d`). Update the README line on Go and Codex.
- F2.2: replaceSection refuses or a request helper exists → remove the workaround line; keep the librarian test.
- The guard blocks `git init`, `git log` without `-- obsidian_plugin` (even inside a probe prompt), and reading `node_modules/yami/dist`. The round's `api/dist/*.d.ts` is readable.
