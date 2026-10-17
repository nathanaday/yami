# Consumer notes · vault-modules

## Built (rounds 1 to 5)
- `src/modules/hello/` is removed. The fixture `test/fixtures/vault-modules/hello/` mirrors `internal/hello/`.
- `test/unit/hello.test.ts` uses `testYami({ files })`. It runs Hello through the review to done, and covers a broken policy, and a broken template with `problem.document`. It creates sessions with `templateOf("greeting")` (round 5).
- `test/unit/threads.test.ts`: the reviewer turn uses `threads_status`. The budget test checks that `RunResult.reason` contains the check's reason.
- Panel (`src/panel/view.ts`): one feed, `onSessionsChange`. It shows problems and opens `problem.document`. Document rows show `doc.reason`.
- Obsidian tests: the panel test uses `module("hello").templateOf("greeting")` (round 5). The stop/resume test compares the first line of each prompt with the texts that the README quotes (0.5.1).

## Workarounds
- None.

## Open items (round 5)
- None. Verdict: done.

## Check next round
- Only if the session goes on: the overseer's `npm run test:obsidian`, the panel test (the `templateOf` change).
- A single Obsidian test needs "creates the hello module with New module" in the `-t` pattern, because it writes Hello.
- Read session files with Read, never Bash. Do not touch `node_modules/yami`.
