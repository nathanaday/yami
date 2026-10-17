# Creator notes · vault-modules

## Round 1 (0.2.0): what I built and why
- Vault modules: `src/module/vault-module.ts` (`readVaultModules`, `VaultModule`, `definesModule`). `Yami.modules` is a getter: code modules, then vault modules. `discover()` runs one call at a time. It keeps the module object when the definition JSON did not change, and calls the `onModulesChange` listeners only on a change, a problem change included.
- A template with any problem stays out. A module whose document does not parse stays out. A bad `color` or a module property that is not text falls back to its default. Template id = `idFromName(file name)`.
- Template links resolve by `linkedDocuments`, the session rule, not by the wiki rule. I flagged this under Policy. Watch for a ruling.
- Every property of a template document has the name of its `TemplateOptions` option. The template's body is the body of a new session. The module's instructions are a property, and the module's body is for a person.
- `DocumentRef` widens the template's link types. This is a breaking change, at the type level only.
- Review: `src/module/review.ts` and `runReview` in `run.ts`. `RunControl.review` holds the live verdicts. `yami_review` finds the live review through `liveControl(session)`, a WeakMap in `session.ts`. The core fields `review`, `followed`, and `broken` are new.
- Base skill: `internal/yami/skills/run/SKILL.md`. The run invokes it with `/yami:run`. It is inlined for an agent that does not have the `internal/yami` skill set.
- `session.check()` is behind `yami_check`. It is a general primitive, for a "check now" button in a view.
- Testing: `Turn(prompt, session)`, `session.tool(name, input)`, and `review(verdicts?)`, which reads the session path from the review prompt line "The session document is …".
- Obsidian: `addModuleCommands` returns a sync function, which calls `removeCommand` (Obsidian 1.7.2 or later). Discovery is debounced 300 ms. It runs on create, delete, or rename anywhere, and on a modify of a module document or a template document. The New module command is in the `modules` group.

## Watch next round
- Consumer tests that break because of the review. The migration is in the CHANGELOG.
- Whether "what the run changed" is enough for a reviewer.
- The field-type conflict rule: the first template by file name wins.
- The Obsidian discovery trigger has no unit test. Only the command sync does.
