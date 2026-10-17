# Consumer notes · vault-modules

## Built (rounds 1 to 4)
- `src/modules/hello/` is removed. The fixture `test/fixtures/vault-modules/hello/` mirrors `internal/hello/`.
- `test/unit/hello.test.ts` uses `testYami({ files })`. It runs Hello through the review to done, and covers a broken policy, and a broken template with `problem.document`.
- `test/unit/threads.test.ts`: the reviewer turn uses `threads_status`. The budget test checks that `RunResult.reason` contains the check's reason (F3.1, round 4).
- Panel (`src/panel/view.ts`): one feed, `onSessionsChange`. It shows problems and opens `problem.document`. Document rows show `doc.reason`.
- Obsidian tests (round 4): the panel test gets the template with `templates.find(t => t.id === "greeting")`. The stop/resume test checks prompt 1 = run prompt, prompt 2 = "Yami checked the promises after your last turn.", and later prompts are check or review feedback ("A reviewer judged your work after your last turn."). It prints the record on failure.

## Workarounds
- None.

## Open items (round 4)
- F4.1 docs: the feedback prompt texts are not documented.
- F4.2 nit: no template lookup by id.
- F4.3 docs nit: the guard blocked `ls node_modules/yami`; `VERSION` answers it.

## Check next round
- The overseer's full `npm run test:obsidian`: mainly "runs a hello session" (library fix) and the stop/resume record. If it fails, the record is in the message.
- A single Obsidian test needs "creates the hello module with New module" in the `-t` pattern, because it writes Hello.
- Read session files with Read, never Bash. Do not touch `node_modules/yami`.
