# Feedback · round 4

verdict: done

I moved the plugin onto 0.9.0. The ruling said to remove the `library-loop: F3.1` workaround, and I did. `librarian_checkout` now calls `checkSection("Request", order.request)` and `checkSection("Notes", order.notes ?? "")` before it writes a copy. The librarian test still asserts that a refused checkout writes no copies, and it passes with no change. I added one sentence to the plugin README. It says that a validator command that needs the network fails, such as `git push` or a suite that fetches its dependencies, and that the person must fetch the dependencies before the validator runs. The plugin uses no background task, so the `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` change did not affect it.

Checks: `npm run build` passes. `npm test` passes: 85 tests. The greps of acceptance 2 to 4 find nothing, and the one `FLOW.md` has no body. `YAMI_LIVE_THREAD=1 npm run test:live` passes with Claude Code (81 s). I did not run `npm run test:obsidian`, because the overseer runs it.

F3.3: `checkSection` throws on `   ## X` and on a bare `##`. It accepts `    ## X`, `\t## X`, and `### X`, as CommonMark reads them.

F3.2: I ran the probe again on 0.9.0. A read-only session had a Go module, and the prompt said "measure its test coverage with a coverage profile" and named no folder. Then the agent ran a `curl` to `https://example.org`.

| | Claude Code, cwd = vault | Claude Code, cwd = repo | Codex, cwd = repo |
| --- | --- | --- | --- |
| coverage profile | `-coverprofile="$TMPDIR/cover.out"`, 100.0% | `-coverprofile="$TMPDIR/cover.out"`, 100.0% | `-coverprofile="$TMPDIR/coverage.out"`, 100.0% |
| `curl https://example.org` | `CONNECT tunnel failed, response 403`, sandbox: `host is not on the allow list` | same | `Could not resolve host`, `exit=6` |
| files left in the repo | none | none | none |
| permission requests | 0 | 0 | 0 |

No `/tmp/yami-read-only-*` folder stayed after the sessions. Each agent chose `$TMPDIR` without a hint, so I close F3.2. One small residue, which I do not file: when the probe asked "which folders can your commands write", Claude Code still listed "the working directory (`.`), `$TMPDIR`, `/tmp/claude`". Then it added "This session is read-only, so I wrote only to `$TMPDIR`." Codex listed only the scratch folder. The agent's actions are correct, but its report of the sandbox rule repeats Claude Code's note. If a validator copies that list into a person's report, the report is wrong. That is not enough for an item.
