# Summary · vault-modules

Goal: a person defines a whole Yami module in the vault with markdown only. Yami finds it, shows it like any module, and runs its sessions in the one loop. The loop adds a review that judges policies and promises with no check. The test: the showcase's code module Hello became a vault module.

## Rounds

| Round | Library | Plugin | Items open after |
| --- | --- | --- | --- |
| 1 | 0.2.0: vault modules, the template document, discovery and problems, the base skill `/yami:run`, `yami_check`, the review, the New module command | Hello deleted from code and written as a vault fixture; the panel shows vault modules, problems, and verdicts | 6 minor, 2 nit |
| 2 | 0.3.0: reviewer gets only `readOnly` tools and its own `yami_review`; verdict reasons; `testYami({ files })`; tested discovery trigger; generic shipped text | adopted all answers; three workarounds removed; `threads_status` read-only | 2 minor, 1 nit |
| 3 | 0.4.0: `RunResult.reason`; the base skill updates when unedited and is a problem when edited; `VERSION` | tests for both | 1 minor |
| 4 | 0.5.0: fixed the review crash in the real app (a tool `title` read unchecked input on both harnesses); first Claude adapter unit tests; Yami's own faults end `failed` with a reason | Obsidian tests fixed for the template API and review feedback | 1 minor, 2 nit |
| 5 | 0.5.1: docs for the feedback prompts and `templateOf` | tests use `templateOf` | none |

## What the library gained

From `yami/CHANGELOG.md`, 0.2.0 to 0.5.1:

- **Vault modules.** `internal/<id>/` with a module document and `templates/*.md` (`type: template`) is a `VaultModule`. `yami.discover()`, `yami.problems`, `yami.onModulesChange`, `yami.createModule(name)`, and live discovery in Obsidian through `watchModules`. Template commands come and go with no reload. A code module wins a shared id.
- **The run.** The base skill `internal/yami/skills/run/SKILL.md` drives every run. Agents check their work with `yami_check` and `session.check()`.
- **The review.** The phase is `reviewing`. A fresh read-only conversation with the same agent judges policies and unchecked promises through a `yami_review` bound to that review. It gets only tools that declare `readOnly`. Verdicts and reasons are in the session document and in `SessionDocument.reason` and `judged`. Broken or unmet items go back to the worker.
- **Results.** `RunResult.reason` gives why a run ended `failed` or `needs-attention`. A fault in Yami's own code names the error and its place.
- **Robustness.** `toolTitle` keeps a tool's title from reading unchecked input, on both harnesses.
- **Testing.** `testYami({ files })`, a scripted `review()` turn, `session.tool()`, and a fake Claude CLI.
- **Other.** `VERSION`. `AgentTool.readOnly`. `OpenConversation.tools`.

`design.md` changed with the work: the Vault module, Template, and Review terms; the `template` type; the reserved fields `review`, `followed`, and `broken`; the reserved id `yami`; the review step in the loop; `failed` for Yami's own faults; and the base skill as the one exception to never overwriting a document.

## Declined

- **F4.2**, a lookup of a template by its id: `templateOf(id)` already does it, so it was documented and given a test.
- **F4.3**, the version of the installed package: `VERSION` answers it.

## Backlog

1. **Stale module documents.** A code module installs its documents once and never overwrites them. After a plugin update, a vault keeps the old text of every skill, policy, and promise. Round 3 fixed this for the base skill only. The general rule is a product decision for the user.
2. **The reviewer and the user's own MCP servers.** The reviewer gets only Yami's read-only tools. But the user's own harness setup still applies, by design (Approval, item 5), and that setup can include MCP servers that write.
3. **A template switch to turn the review off.** Out of scope here. A reason to add it would be a cost problem, for example threads sessions, which link a policy and so get a review.
4. **A list of changed files for the reviewer.** Today the reviewer reads the worker's last message and the conversation note. A list from the harness would need work in the conversation layer.

## Guard

- **Blocks:** 12. Each one was correct: reads of the other side's folder or session files, a `git rm`, and a read of the library's `package.json`.
- **Gap:** in round 4, the creator read Claude Code transcripts under `~/.claude/projects/` of the Obsidian test vault. Those hold the plugin tests' prompts. The guard does not fence that folder. The leak was small, and it found the root cause of the crash. Consider fencing the harness transcript folders.

## Acceptance

1. `npm run build` and `npm test` pass in `yami/` (297 tests) and in `obsidian_plugin/` (83 tests).
2. `obsidian_plugin/src/modules/hello/` does not exist, and `src/` does not name Hello.
3. `src/` has no branch on whether a module came from the vault.
4. `test/unit/hello.test.ts` runs the fixture through the review to `done`, with the verdicts and their reasons in the session document.
5. `npm run test:obsidian` passes, 20 of 20, with real Claude Code and Codex. It also passed after round 4. After round 3 it failed 3 of 20, and round 4 fixed all three.
6. The Obsidian tests make Hello with New module, see it in the panel, break its template, and delete its folder, with no reload.
