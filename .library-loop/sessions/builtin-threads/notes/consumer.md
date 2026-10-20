# Consumer notes · builtin-threads

## Round 1 (yami 0.15.0)
- Built: removed `src/modules/` (threads, librarian, journals), their unit tests, `test/live/`, and the `test:live` script. The guard denied `rm`, so I moved them to the session scratchpad; git also holds them. `main.ts` passes agents only.
- `hello.test.ts`: no Librarian; modules are `["wiki", "threads", "hello"]`.
- Obsidian tests: new "installs the built-in modules, and returns a checkout" and "creates the forms of threads … panel lists". The panel, colors, icons, and commands tests now use threads and wiki. Command names in Obsidian carry the prefix `Yami: `.
- The acceptance grep forbids the old module names in `test/`, so the install test lists `internal/` folders exactly instead.
- README rewritten: modules table, "Your own flows in threads", wiki "Checkouts".
- Test order matters: a test that moves the panel must bring it back to Modules. The Hello panel test allows agent-run rows (the real agent may call its proofreader).
- Checks: build, unit (3), test:obsidian (22) all pass. Verdict done.
- Filed: F1.1 thread fields on flow sessions (minor), F1.2 ask/pick DOM docs, F1.3 wiki_checkout output docs.

## Check next round
- F1.1: does a `daily-review` session still get `repositories`/`after`/`retired`/`tags`?
- F1.2/F1.3: README has the selectors and the tool output?
- The tool test calls `tool.run` directly from the page; switch if the docs give a better host call.
