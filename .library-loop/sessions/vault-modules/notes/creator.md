# Creator notes · vault-modules

## Round 1 (0.2.0): what I built and why
- Vault modules are in `src/module/vault-module.ts`. `Yami.modules` is a getter: code modules first, then vault modules. `discover()` runs calls in sequence, keeps a module object when its definition JSON did not change, and calls listeners only when something changed.
- A template with any problem stays out. Template id = `idFromName(file name)`. Template links resolve as session links do (ruled in round 2).
- Review: `src/module/review.ts` and `runReview` in `run.ts`. The core fields `review`, `followed`, and `broken` are new.
- Base skill: `internal/yami/skills/run/SKILL.md`, invoked as `/yami:run`. It is inlined when the agent does not have the skill set.

## Round 2 (0.3.0): decisions
- Reviewer tool limit (audit): `AgentTool.readOnly`. The reviewer's conversation gets `OpenConversation.tools` = the read-only tools of `yami.tools()` + `reviewTool(review)`. `yami_review` is bound to one `Review` and refuses after `review.open = false`. I removed `liveControl` and `RunControl.review`. `ConversationController.tools` carries the tools in Obsidian (in memory only). A custom `Conversations` must honor `tools`, and the docs say so.
- F1.1/F1.8: `SessionDocument.reason` (the line text from Deliverables or Review) and `judged`. They are parsed in `details()`, the same way as the Progress section.
- F1.3: `ModuleProblem.document`, only when a document holds the problem.
- F1.4: `testYami({ files })`, a map from vault path to disk path, copied with `cp`. On failure, it removes the temporary folder.
- Trigger audit: `watchModules(app, component, yami)` in `src/obsidian/discovery.ts`. `ChangeFeed` moved to `change-feed.ts`. Tests: `test/unit/obsidian/discovery.test.ts`.
- Generic examples: the base skill uses `/<module>:<skill>`. README, module, and testing docs use `notes` and `code-review`, not hello.

## Round 3 (0.4.0): decisions
- F2.1: `RunResult.reason`, only for `failed` and `needs-attention`. It is the last `write` line, cut by `oneLine`, without the time. Named `reason`, not `error`, to match `SessionDocument.reason`. A session act's message ends with `: <reason>`.
- F2.2: `installBaseSkill(vault)` in `base-skill.ts`, called at the start of each `#discover`. Missing, or a hash in `SHIPPED` → write. Another text → problem `{ module: "yami", path/document: BASE_SKILL }`. `SHIPPED` holds the hash of every shipped text, the current one too. A test fails when `BASE_SKILL_TEXT` changes until its hash is added. `watchModules` also fires on `BASE_SKILL`. Listed as Breaking: a problem's module may not be in `yami.modules`.
- F2.3: `VERSION` in `src/version.ts`. A test compares it with `package.json`.
- Policy proposal: an exception to Entities item 5 for the base skill.

## Watch next round
- Showcase module tools that only read and that a reviewer needs must add `readOnly: true`.
- The Deliverables detail of a check is not cut to one line. A multi-line check detail would break the `reason` parse and the checklist line.
- Field-type conflict rule: the first template by file name wins.
- Each version bump: `package.json`, `package-lock.json`, `src/version.ts`. Each change of the base skill text: add its hash to `SHIPPED`.
- The overseer takes the update question for the documents of code modules to the user.
