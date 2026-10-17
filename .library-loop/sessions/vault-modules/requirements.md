# Requirements: modules defined in the vault

Today a module is a subclass of `YamiModule`. Its policies, promises, skills, agents, and articles are markdown, but its templates exist only in code. After this work, a person can define a whole module in the vault with markdown only. Yami finds it, and its sessions run in the same loop as the sessions of any module.

The loop also gets a review step. After the code checks pass, a new read-only agent judges the session's policies, and the promises that have no check. A base Yami skill holds the instructions for every run.

Read `design.md` first. It already describes vault modules, the template document, the base skill, and the review step. These requirements make that description checkable.

## Vault modules

**R1 · Layout.** A vault module is the folder `internal/<id>/`. It holds the module document `<id>.md` (`type: module`) and one or more template documents in `internal/<id>/templates/`. Its other documents use the folders that a code module installs: `policies/`, `promises/`, `skills/<name>/SKILL.md`, `agents/`, and `articles/`. Its sessions and its module ledger go where a code module's go. The module document gives the name, description, icon, color, and module instructions. The README documents where each one goes.

**R2 · Template document.** A new document type, `template`, with its schema in `yami/src/document/schema.ts`. A template document can hold every option of `TemplateOptions` that markdown can express: name, description, links to skills, policies, promises, and articles (the first skill loads first), `maxIterations`, `access`, instructions, the body of a new session, session fields with their defaults, and `command`. Its links resolve as the wiki resolves links, by path or by name. A link to a document of another module is allowed. The template's id comes from the document by a rule in the README. Yami generates no ID.

**R3 · Discovery.** Yami finds the vault modules when it starts. A folder is a vault module when it has a module document and at least one template document, and no code module has its id. A module document that a code module left behind, with no templates, is not a module. The id `yami` is reserved.

**R4 · Live changes.** When a person creates, changes, renames, or removes a module document, a template document, or a document that a template links, Yami updates its modules within a few seconds. No reload is necessary. A host hears each change through a public subscription, in the same form as the session and wiki change feeds. In Obsidian, `createYami` adds and removes each template's command as the template appears and goes, and new agent sessions get the module's skill set. A run that is live keeps what it started with.

**R5 · Problems, not crashes.** These problems never stop Yami, another module, or a valid template of the same module:

- A module or template document that does not parse.
- A link to nothing.
- A bad value, such as an unknown `access`.
- An invalid id, or an id that a code module has.

The public API gives each problem with its module, its file, and a message that says how to fix it. A session whose template is gone fails to run with a clear error, as a session with an unknown template does today.

**R6 · One module API.** A host uses a vault module through the API it uses for a code module: the module list, summaries, details, acts, templates, sessions, colors, icon, and ledger. Code that lists modules needs no branch for vault modules. A host can read whether a module came from the vault, so that a view can show it, but no API needs that information.

**R7 · No code.** A vault module has no tools, no checks of its own, and no actions. Its sessions get every tool that Yami serves and the core checks.

## The run

**R8 · Base Yami skill.** Yami ships one skill and installs it into the vault when no file is at its path, so a person can read and edit it. The skill tells an agent how to run a session:

- Read the session document.
- Load the session's skills.
- Follow every policy.
- Deliver every promise.
- Check the work before the turn ends.
- Expect a review.

Every run of every module uses the skill. The fixed instructions in today's first prompt move into the skill. The prompt keeps only what is particular to the session. The skill works on both harnesses.

**R9 · Self-check tool.** Every agent gets a tool that runs the code checks of a session's promises and returns the results. It records nothing in the document. An agent calls it before it ends a turn.

**R10 · Review step.** After a turn, Yami does a review when both of these are true:

- Every promise that has a check is met.
- The session links at least one policy, or at least one promise with no `check` property.

For the review, Yami opens a new conversation with the same agent, with `access: read-only`. The reviewer gets the session document, the policies, the promises to judge, and what the run changed. It gives each policy the verdict `followed` or `broken`, and each promise the verdict `met` or `unmet`, each with a reason. It records the verdicts through a tool. Then:

- A broken policy or an unmet promise goes back to the worker as feedback, the same as an unmet code check. The next iteration starts.
- When every policy is followed and every promise is met, the session is `done`.
- When the reviewer ends without a verdict on each item, the session is `needs-attention`, with the reason.
- During the review, `status()` and the session events report a new phase, with a label in `STATUS_LABELS`.
- `stop()` and `kill()` stop the review.
- The session document records the verdicts and links the review's conversation note.
- A session with no policies and no promises without a check runs as it does today.
- A promise whose check returns `review`, for example an unknown check name, still makes the session `needs-attention`. The reviewer judges only promises with no `check` property.

**R11 · New module command.** The Obsidian layer has a command that asks for a name and creates a vault module from a starter: one template, one skill, one policy, and one promise with a core check. A session from the starter runs to `done`. The starter is generic. The command refuses a name whose id exists.

## Tests and docs

**R12 · Tests.** Use `yami/testing` for unit tests of these behaviors:

- Discovery, and each problem of R5.
- Live add, change, and remove.
- The template document.
- The self-check tool.
- Each review outcome: all followed; a broken policy that the worker then fixes; a reviewer that gives no verdict; a stop during the review.

The scripted agent of `yami/testing` must be able to play the reviewer. Each export has docs.

**R13 · Docs.** The README documents the vault module layout, the template document's properties, the change feed, the problems API, the base skill, the self-check tool, and the review step. The CHANGELOG lists each change.

## Out of scope

- Tools, checks, actions, or ledger views defined in the vault.
- A template-level switch that turns the review off.
- Moving the templates of code modules to documents.
- A review of promises that have a check.
- Subagents on Codex.
