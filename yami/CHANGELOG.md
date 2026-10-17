# Changelog

## 0.5.0 · library-loop vault-modules round 4

### Breaking
- The text of two kinds of Progress line, and so of `RunResult.reason` and of an act's message, is longer. A promise for review now comes with its check's reason: `iteration 1: 0 met, 0 unmet, 1 for review` → `iteration 1: 0 met, 0 unmet, 1 for review: Thread closed — ask the user: …`. A fault of Yami's own code now gives the error's kind and where it was thrown: `failed: boom` → `failed: TypeError: boom (at runSession (run.js:12:5))`. Migrate a test that compares the whole line: `toBe(line)` → `toContain(line)` or `expect.stringContaining(line)`, or compare the new text.

### Added
- `toolTitle(tool, input)` from `yami/agent`: the title of an app tool call for its `tool-start` event. It gives `title` only an input that the schema accepts, and the tool's `name` for any other input and for a `title` that throws. Both adapters use it; an adapter of a host's own calls it as it calls `runTool`.
- `yami_review({})` with no `verdicts` lists the items still to judge, as its description says. Its title is then "List the items to judge".

### Changed
- The review prompt names the items to judge, and says that Yami's checks decided the other promises. Reviewers sent verdicts on promises with a check, which the tool refused.
- A fault of Yami's own code during a review ends the run `failed`, as a harness failure does, with `iteration N: review failed: <kind>: <message> (at <frame>)`. It is not `needs-attention`, which means that the work waits for a person's judgment.

### Fixed
- A review in Obsidian with Claude Code no longer crashes when the reviewer calls `yami_review` with no `verdicts`. The adapter called the tool's `title` with the model's raw input, `verdicts.length` threw, and the throw closed the Claude Code session: the run ended `failed` with `review failed: Cannot read properties of undefined (reading 'length')`. A note whose properties do not parse played no part. Every app tool with a `title` had the fault, on both harnesses; on Codex the throw was uncaught.
- The Claude adapter tells a fault of its own from a failure of Claude Code: a message that it cannot read fails the turn and closes the session with `Yami could not read a message of Claude Code: <kind>: <message> (at <frame>)`, and stops the CLI.

## 0.4.0 · library-loop vault-modules round 3

### Breaking
- `yami.problems` can hold a problem of the module `yami`, which is no module of `yami.modules`: the base skill holds a person's edits. Its `path` and `document` are `BASE_SKILL`. Migrate a view that looks up each problem's module: `yami.module(problem.module)!` → `yami.module(problem.module)`, and show a problem with no module by its `document`.

### Added
- `RunResult.reason`: why a run ended `failed` or `needs-attention`, the same text as the last Progress line without its time. `expect(await session.start()).toMatchObject({ state: "done" })` now shows the reason in the diff of a failed test. A session act's message ends with it: `PR 12: failed after 1 iteration: iteration 1: turn failed: boom`.
- `VERSION` from `yami`: the version of the package, `"0.4.0"`.

### Changed
- `yami.discover()`, and so `yami.enable()`, replaces the base skill when the file holds a text that an earlier version of Yami shipped, since the person never edited it. A vault that ran 0.2.0 gets the new text at the next start. A file with any other text stays, and `yami.problems` reports it. A deleted base skill comes back at the next `discover`.
- `watchModules`, and so `createYami`, discovers again when the base skill changes, so its problem comes and goes with the edit.

## 0.3.0 · library-loop vault-modules round 2

### Breaking
- `yami_review` is no longer in `yami.tools()`, or in the tools of any agent but a reviewer. Each review gets its own `yami_review`, bound to that review, and it refuses once the review ends. Its input lost `session`: `yami_review({ session, verdicts })` → `yami_review({ verdicts })`. Migrate a test that called the tool from `yami.tools()`: play the reviewer with `review()` from `yami/testing`, or call `session.tool("yami_review", { verdicts })` in the reviewer's turn.
- A review gets only the tools whose new `readOnly` is `true`, and `yami_review`. A module tool without `readOnly` is no longer the reviewer's. Migrate a module tool that only reads and that a reviewer needs: add `readOnly: true` to its `defineTool`.

### Added
- `AgentTool.readOnly`: the tool changes nothing, no file and no state of the host. Yami's `yami_check` and every wiki tool but `wiki_change` set it.
- `OpenConversation.tools`: the tools of a conversation's agent sessions, in place of the agent's. `FileConversations` and the conversations of `createYami` honor it; a `Conversations` of a host's own must too. `ConversationController.tools` holds them in Obsidian.
- `SessionDocument.reason`: why the last check or review decided so, as the session document shows it. `SessionDocument.judged`: for a promise, whether it has no check, so the review judges it.
- `ModuleProblem.document`: the document with the problem, which a view can open; none for a problem of the folder.
- `testYami({ files })`: files and folders on disk to copy into the vault before the modules are enabled. `testYami({ files: { "internal/<id>": "test/fixtures/<id>" } })` replaces a copy and a second `discover()`.
- `watchModules(app, component, yami)` in `yami/obsidian`: the discovery trigger that `createYami` uses, now with tests over a fake Obsidian app.

### Changed
- The base skill's example of a skill command is `/<module>:<skill>`, and the docs of public exports use generic examples. Yami never overwrites `internal/yami/skills/run/SKILL.md`: to get the new text in a vault, delete the file and start Yami again.
- The docs of `onSessionsChange` say that it fires after each discovery that changes `modules` or `problems`, so a view needs that one feed. The README lists the id of each command, and how the New module prompt works, and names each document of the starter module.

### Fixed
- The reviewer's first message shows the session body as the verification left it, with the Deliverables checked, not as it was before the checks.

## 0.2.0 · library-loop vault-modules round 1

### Breaking
- A session that links a policy, or a promise with no `check`, now has a review after its checks pass, and a promise with no check no longer ends the session `needs-attention`: the reviewer judges it. Migrate a test that runs such a session with `ScriptedAgent`: queue `review()` from `yami/testing` after the turn that meets the checks. `t.agent.queue(write)` → `t.agent.queue(write, review())`. The reviewer is a new session of the agent, so `agent.last` is the reviewer after a review; use `agent.started[0]` for the worker.
- `SessionStatus` has a new member, `reviewing`, and `STATUS_LABELS` has "Reviewing". Migrate a `Record<SessionStatus, …>` or an exhaustive `switch`: add the `reviewing` case.
- `review`, `followed`, and `broken` are core session fields. A module schema that declares one throws when the Yami is built. Migrate: rename the module's field.
- The first prompt of a run starts with `/yami:run`, the base skill, instead of the session's first skill, and the fixed instructions moved into the skill. The prompt starts `This is the Yami session "<name>", …`. Migrate a test that matched `You are running the Yami session` or `/<module>:<skill> You are running`: match `/yami:run This is the Yami session`.
- `SessionTemplate`'s `skills`, `policies`, `promises`, and `articles`, and `template.links()`, are `DocumentRef[]`: `{ kind, name, path, link }`. `ModuleDocument` is one, so `TemplateOptions` takes the same values. Migrate code that read `.text`, `.files`, or `.install` of a template's document: read it from `module.documents`.
- `yami.tools()` always returns a tool set, and its first tools are Yami's own, `yami_check` and `yami_review`. Migrate code that took a tool by its position: find it by its name.
- `yami.skills()`, and so the agents' skill sets, start with Yami's own, `<vault>/internal/yami`.
- A code module with the id `yami` throws: the id is Yami's own. Migrate: give the module another id.

### Added
- Vault modules: a module defined in the vault with markdown only, as `internal/<id>/<id>.md` (`type: module`) and template documents in `internal/<id>/templates/`. `VaultModule` is a `YamiModule`, so every API of a module works for it; `module instanceof VaultModule` says that a module came from the vault.
- `yami.discover()`, `yami.problems` (`ModuleProblem`: `module`, `path`, `message`), `yami.onModulesChange(listener)`, and `yami.createModule(name)`. `yami.enable()` discovers.
- The `template` document type and its schema, `TEMPLATE`. `MODULE` takes `icon`, `color`, and `instructions`. The field type `map`.
- `idFromName(name)`: the rule that gives a template's id from its file name, and a new module's id from its name.
- The review step of the loop, with the `reviewing` status. `RunResult.review` and `SessionDetails.review` give the review's conversation note; `SessionDocument.followed` says whether the last review found a policy followed.
- The base Yami skill, `BASE_SKILL` (`internal/yami/skills/run/SKILL.md`), which `yami.enable()` writes when no file is there. `BASE_SKILL_TEXT` and `BASE_SKILL_COMMAND`.
- The self-check tool `yami_check`, and `session.check()`, which run the checks of a session's promises and record nothing.
- The review tool `yami_review`, which records a reviewer's verdicts. The types `Verdict`, `ReviewItem`, and `ReviewRecord`.
- `module.hasSkills`.
- `yami/testing`: `review(verdicts?)`, a turn that plays the reviewer; `ScriptedSession.tool(name, input)`; a `Turn` gets the session as its second argument.
- `yami/obsidian`: the New module command, in the new command group `modules`.

### Changed
- `createYami` discovers the vault modules a moment after a module document or a template document changes, or a file is created, renamed, or removed. It adds and removes each template's command as the template appears and goes, updates the folder colors, and calls the `onSessionsChange` listeners. Removing a command needs Obsidian 1.7.2 or later.
- `NewSession.add` and `IngestOptions.policies` take any `DocumentRef`, so a session can link a document of a vault module.
