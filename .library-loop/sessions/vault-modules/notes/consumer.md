# Consumer notes · vault-modules

## Built (rounds 1 to 3)
- `src/modules/hello/` is removed. The fixture `test/fixtures/vault-modules/hello/` mirrors `internal/hello/`.
- `test/unit/hello.test.ts` uses `testYami({ files })`. It runs Hello through the review to done, checks the reviewer's prompt for `[x]`, and checks `reason` and `judged` in `details()`. It also covers a broken policy over 2 iterations, and a broken template with `problem.document`.
- `test/unit/threads.test.ts`: the reviewer turn calls `threads_status` (readOnly), and `threads_close` throws. The budget test checks `RunResult.reason` (round 3).
- Panel (`src/panel/view.ts`): one feed, `onSessionsChange`. It shows problems and opens `problem.document`; it never looks up `yami.module(problem.module)`, so the `yami` base skill problem shows with no change. Document rows show `doc.reason`.
- Obsidian tests: `yami:new-module` by its id; the problems test also edits `BASE_SKILL`, waits for its row, deletes it, and waits for `BASE_SKILL_TEXT` (round 3).

## Workarounds
- None.

## Open items (round 3)
- F3.1 `RunResult.reason` for a `review` check gives counts only, not the check's reason.

## Check next round
- Whether `npm run test:obsidian` passed, mainly the new base skill step.
- Read session files with Read, never Bash: the guard blocks Bash in the session folder.
