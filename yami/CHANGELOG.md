# Changelog

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
