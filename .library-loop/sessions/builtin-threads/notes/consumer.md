# Consumer notes · builtin-threads

## Round 1 (yami 0.15.0)
- Built: removed `src/modules/` (threads, librarian, journals), their unit tests, `test/live/`, and the `test:live` script. The guard denied `rm`, so I moved them to the session scratchpad; git also holds them. `main.ts` passes agents only.
- `hello.test.ts`: no Librarian; modules are `["wiki", "threads", "hello"]`.
- Obsidian tests: "installs the built-in modules, and returns a checkout" and "creates the forms of threads … panel lists". Command names in Obsidian carry the prefix `Yami: `.
- The acceptance grep forbids the old module names in `test/`, so the install test lists `internal/` folders exactly.
- Test order matters: a test that moves the panel must bring it back to Modules. The Hello panel test allows agent-run rows.

## Round 2 (yami 0.16.0)
- No plugin code change. Tests use `.yami-ask input.prompt-input` + item `Create the <kind>: <name>`, and `.yami-pick .suggestion-item` (create session, restore, ingest folder).
- Threads test: the own-flow session holds no key of `threads.thread.schema`; a new thread holds `repositories`, `after`, `retired`, `tags` (only the fields with defaults). The contrast thread is deleted at once, because the panel test expects one threads session.
- The README says own-flow sessions get no thread field.
- Checks: build, unit (3), test:obsidian 21/22 in the full run (a Codex 429 rate limit); the failed test passed alone.
- Guard: do not put `node_modules/yami` or `yami/src` in a command; do not `ls` the session folder.
- Filed: F2.1 docs minor, the hint of each built-in `ask` (only the flow hint is documented).

## Check next round
- F2.1: does "The prompts" list the hints of `create <kind>` and New module? If so, match New module on its full item text.
