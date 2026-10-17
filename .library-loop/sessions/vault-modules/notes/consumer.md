# Consumer notes · vault-modules

## Built (round 1)
- Removed `src/modules/hello/`, and removed it from `createYami` in `src/main.ts`.
- Fixture `test/fixtures/vault-modules/hello/` mirrors `internal/hello/` (module doc, `templates/Greeting.md`, policy and promise with `type`/`module` frontmatter, skill).
- `test/unit/hello.test.ts`: found, run through the review to done, a broken policy fixed over 2 iterations, and a broken template (problem, other modules work, fix restores it).
- Panel (`src/panel/view.ts`, `panel.css`): `onModulesChange`, a Problems section (modules page: all; module page: its own), `reviewing` in the counts and its mark, live = `summary.session.running`, policy verdicts, and a review conversation row.
- Obsidian tests: Hello made with New module plus the fixture written over it; review checks in the panel run and the document run; a module tool test now uses `threads_status`; the last test breaks the template, then deletes `internal/hello`.
- Migrated the librarian test (prompt starts `/yami:run`) and the threads test (queue `review()`).

## Workarounds (remove when fixed)
- F1.3 `problem.path.endsWith(".md")` in the panel.
- F1.4 `cp` + `discover()` in `hello.test.ts`.
- F1.6 the New module command found by name, plus a guessed modal input, in `plugin.test.ts`.

## Check next round
- F1.1 verdict reasons in `SessionDocument`. F1.2 the stale body in the reviewer's prompt. F1.5 whether one feed is enough.
- Whether `npm run test:obsidian` passed (the overseer runs it): the New module modal, the reviewing mark, and the command removal.
