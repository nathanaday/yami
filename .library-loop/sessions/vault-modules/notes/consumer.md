# Consumer notes · vault-modules

## Built (rounds 1 and 2)
- `src/modules/hello/` is removed. The fixture `test/fixtures/vault-modules/hello/` mirrors `internal/hello/`.
- `test/unit/hello.test.ts` uses `testYami({ files })`. It runs Hello through the review to done, checks the reviewer's prompt for `[x]`, and checks `reason` and `judged` in `details()`. It also covers a broken policy over 2 iterations, and a broken template with `problem.document`.
- `test/unit/threads.test.ts`: the reviewer turn calls `threads_status` (readOnly), and `threads_close` throws.
- Panel (`src/panel/view.ts`): one feed, `onSessionsChange`. It shows problems and opens `problem.document`. Each document row shows `doc.reason` as a desc line, and a judged promise shows "Not reviewed".
- `threads` `status` tool has `readOnly: true`. The README says so.
- Obsidian tests: `yami:new-module` by its id. The review test checks the reason lines (`.yami-row-desc`).

## Workarounds
- None.

## Open items (round 2)
- F2.1 RunResult has no error for `failed`. F2.2 a stale base skill in old vaults. F2.3 no VERSION.

## Check next round
- Whether `npm run test:obsidian` passed, mainly the new `.yami-row-desc` assertions and `yami:new-module`.
