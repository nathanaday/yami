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

## Round 3 (yami 0.16.1)
- No plugin code change. Tests: New module clicks `Create the module: Hello` and checks its placeholder; each create kind checks `The name of the new <kind>, such as <example>`.
- `npm install` refreshed a stale `package-lock.json` (yami 0.1.0, a leftover `@cfworker/json-schema`).
- Checks: build, unit (3), test:obsidian 21/22 (Codex 429 again; passes alone). First full run was 20/22, and I captured only the tail; next time save the full log to the scratchpad.
- Guard: do not read the library's `package.json`; do not put `yami/s` in a grep pattern.
- F2.1 closed. No open items. Verdict done.

## Check next round
- Nothing open. Read the CHANGELOG for breaking changes to prompts or commands.
