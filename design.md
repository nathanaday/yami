# Yami design

This document is the design policy of the repository. When code and this document disagree, the code is wrong, or this document needs a change that is agreed first. The package READMEs describe what each package does; this document says what every package must keep true.

Yami replaces Almagest. Almagest implemented each feature (ingest, changes, checkouts, journals, navigation) with its own state file, its own frontmatter schema, and its own ledger. Yami has one set of entities, one loop, and one place for each kind of code, so a new feature is a module and nothing else.

## Terms

| Term | Meaning |
| --- | --- |
| Vault | The Obsidian vault. The highest context, and the working directory of every agent. |
| Module | One agent workflow in the vault: the wiki, the journal, the librarian. A module is a plain object in `yami/modules/`. |
| Session | One run of a module. One markdown document in the module's folder. |
| Harness | An agent runtime: Claude Code or Codex. `yami/agent` has one adapter for each. |
| Agent | A harness plus preferences. It starts harness sessions. |
| Document | A markdown file with properties (frontmatter) and a body. |
| Policy | A document with rules that a session must follow. |
| Promise | A document that names a deliverable, where it goes, and how Yami checks it. |
| Skill | A `SKILL.md` folder in the standard form. |
| Article | Any note. Its content becomes context for the agent. |
| Check | A function that decides whether a promise is met. |
| Ledger | An Obsidian base: a live view over the properties of documents. |

## Entities

1. Every document that Yami writes has a `type` property: `module`, `session`, `policy`, `promise`, `skill`, or `conversation`. The schema of each type is in `yami/src/document/schema.ts`, and nowhere else.
2. Links are the identity of documents. Yami generates no IDs. A session refers to its policies, promises, skills, and articles as `[[links]]` in its properties.
3. A session is one document. It is the front page of the work: its properties hold the state, the links, and the module's own fields; its body holds the deliverables checklist and the progress. There is no other record of a session's state. The exchange with the agent goes to a conversation note, linked from the document.
4. A module declares its session fields as a schema, in the same form as the core schemas. Core field names (`type`, `module`, `state`, `created`, `iteration`, `harness`, `conversation`, `articles`, `policies`, `promises`, `skills`, `met`, `unmet`) are reserved.
5. A module installs its documents into the vault, and never overwrites a document that exists. Users read and edit them in Obsidian.
6. A module sets defaults for the links of a new session. A session can link to different documents, and the loop uses the session's links, not the module's defaults.

## Layout

```
Yami.base                   vault ledger: every module, and every session grouped by module
conversations/              every conversation with an agent, one note each
<module>/                   user-facing: the session documents, one file each
  sessions.base             module ledger
internal/<module>/          what the module needs: module doc, policies, promises, skills
```

1. The module folder holds session documents and `sessions.base`, and nothing else.
2. Everything else that a module needs goes under `internal/<module>/`.
3. The paths come from `layout()` in `yami/src/module/module.ts`. No other code builds these paths.

## Ledgers

1. A ledger is a base. It reads the properties of documents, so it is current when the properties are current.
2. Code writes a base once, from `yami/src/document/bases.ts`, and never updates it.
3. Code never stores a count or a summary that a base can compute. A module with zero sessions appears in the vault ledger because the ledger lists module documents, not because code counts sessions.
4. The session document is its own ledger. A per-session base would need per-session records as files, and Yami does not create those.

## Layers

```
obsidian_plugin   a plugin: commands and settings, nothing else
yami-obsidian     the Obsidian layer: the Vault adapter, shared documents, conversation notes, prompts
yami/modules/*    modules: data, no logic
yami/module       the Module type, enable, create, the loop, the checks
yami/conversation the conversation note format and the turn transcript
yami/document     documents, schemas, links, bases, the Vault interface
yami/agent        the Agent and Session base classes, one adapter for each harness
```

1. A layer imports only the layers below it.
2. `yami` does not import the Obsidian API. The `Vault` interface is the whole file system contract; `yami-obsidian` implements it over the Obsidian API, and tests implement it over the file system.
3. `yami/agent` does not know about documents, modules, or the vault. Its types do not expose harness SDK types, so a host can hold an `Agent` or a `Session` without knowing the harness.
4. The `Agent` and `BaseSession` classes hold what the harnesses share: preferences, session tracking, the turn queue, event delivery, interrupt, and close. An adapter implements `startTurn`, `interruptTurn`, `close`, `models`, `commands`, and `configure`, and reports through `emit`, `askPermission`, `turn.finish`, and `markClosed`. The session contract came from Duet, and Duet uses it from here.
5. Each harness adapter is its own entry point (`yami/agent/claude`, `yami/agent/codex`), so a host bundles only the SDKs it imports.
6. `yami-obsidian` is the one place that uses the Obsidian API. Every Yami plugin, the test bed and Duet, uses it, so agents behave the same in all of them: one shared-document hub for the window, one conversation view, one set of prompts.
7. A plugin holds no agent logic. It registers its agents, installs the Obsidian layer, and registers commands. A command calls one SDK function.

## Modules

A module is a plain object: `id`, `name`, `description`, `schema`, `documents`, `defaults`, and `instructions`. A module has no code of its own.

A new feature is a module when it can be expressed as these parts. Before adding a part to the `Module` type or a function to `yami/module`, answer these questions:

1. Is it a document? Then it is a policy, promise, skill, or article in the module's `documents`.
2. Is it a rule the agent must follow? Then it is a policy.
3. Is it something the session must produce? Then it is a promise, with a check if Yami can verify it.
4. Is it a way to verify a deliverable? Then it is a check in `yami/src/module/checks.ts`, and a promise names it.
5. Is it state? Then it is a property of the session document, with a schema.
6. Is it a view? Then it is a base, or a section of the session document.

If none of these fit, the design needs a change to this document before the code.

## Conversations and shared documents

1. Every conversation with an agent is a conversation note in `conversations/`, whatever started it: a person, a module session, or another plugin. The note is the record.
2. While an agent works in the vault, every note that it changes is a shared document. The agent's changes merge with the user's typing, show the agent's cursor, and can be undone as one step for each turn. No agent writes a note that is open in an editor behind the user's back.
3. One Obsidian window has one hub. A plugin that bundles its own hub would double-bind every editor, so plugins share the hub through `installCollab`.

## The loop

There is one loop, `runSession` in `yami/src/module/run.ts`. Modules do not have their own.

1. **Context.** The first prompt holds the session document, the module's session fields, and the content of every linked policy, promise, skill, and article. Later prompts hold only the verification feedback, because the harness session keeps the conversation.
2. **Action.** One agent turn, with `accept-edits` approval and the vault as the working directory.
3. **Verification.** Yami runs the check of each promise and records the outcome in the session document. The exchange is a conversation note, linked from the document, so a person can watch a run in Obsidian, answer its approvals, and continue it.

The session ends `done` when every promise is met; `needs-attention` when the iterations run out or a promise has no check; `failed` when the harness ends a turn with an error. `needs-attention` is the state for a person to look at, and the ledgers show it. A later run continues the iteration count.

## Approval and permissions

1. `approval` sets what the agent does without asking: `ask`, `accept-edits`, `plan`, `auto`, or `sandbox`. Everything else is a permission request. `access: read-only` is a hard limit: no changes, no commands that change files, and no requests.
2. Each harness maps the setting in its own way, and the differences are in the `yami/agent` README. Code outside `yami/agent` does not depend on them.
3. A session without a permission handler denies every request. The host decides whether to prompt, and how.
4. Approvals go to the user, never to an automatic reviewer that a harness configuration selects. An `allow-session` decision applies to the session only, never to the user's settings files.
5. The user's own harness setup applies: settings, `CLAUDE.md` and `AGENTS.md`, skills, plugins, MCP servers, and permission rules. Isolation is an option (`settingSources` for Claude), not the default.
6. A UI gets the same data from both harnesses: tool titles, diffs as details, relative paths, streaming deltas, and reasoning summaries. An adapter normalizes; a UI never special-cases a harness.

## Harness adapters

These facts cost days to learn. Keep them true, and read the `yami/agent` README before changing an adapter.

1. Claude keeps one CLI process for each session. Codex keeps one `app-server` process and one thread for each session, and runs `codex exec` nowhere.
2. A harness process gets the `PATH` of the user's login shell first. Obsidian starts with a short `PATH`.
3. Claude has a stall watchdog. Codex has its own stream timeout.
4. Codex stops its commands only when its server stops. An interrupt stops the server and resumes the thread on a new one.
5. Both harnesses ignore an interrupt that arrives before the turn starts on their side. The adapters wait for the start, then interrupt.
6. The Claude Agent SDK expects Node's timers, `AbortController`, and `import.meta`, and the MCP SDK compiles schemas with `new Function`. In Obsidian's renderer the globals are Chromium's, and Obsidian's review rejects generated code. The plugin's `esbuild.config.mjs` fixes all four, for the SDKs' own files only.

## Testing

A change is done when these pass, and the report says which ran:

1. **Unit tests** (`npm test` in `yami/`): the session queue, each adapter against a scripted harness (`test/fixtures/fake-codex.mjs`), and the loop and document logic with a fake agent and a file system `Vault`. No harness, no API key, deterministic. Every state of the loop has a case.
2. **Live tests** (`npm run test:live`): the same scenarios against the real CLIs, for both harnesses. Connect, a turn with a tool, approvals, interrupt, a command stopped on interrupt, queued messages, resume, and no process left behind.
3. **Obsidian layer and plugin changes:** `npm run test:obsidian` in `obsidian_plugin/` starts a separate Obsidian with a temporary vault, installs the built plugin, and drives it with real agents through its debugging port. Plain Node cannot catch renderer bugs, and three of them have happened. `npm test` in `yami-obsidian/` covers the shared-document logic without Obsidian.
4. A guard in the build fails when a dependency changes shape, instead of a silent no-op.

## Documentation

1. This document holds the policy. The `yami` README holds the APIs and the harness facts. The plugin README holds how to run it.
2. Code comments say what a reader cannot see in the code: a constraint, a harness quirk, a reason that is not obvious. They do not repeat the code.
3. Prose follows ASD-STE100: short sentences, one term for one thing, active verbs.

## Do not

1. Do not add a state file, a schema, or a ledger for one feature. Add a module.
2. Do not store what a base can compute.
3. Do not put logic in a module object.
4. Do not call a harness SDK outside its adapter.
5. Do not use the Obsidian API outside `obsidian_plugin`.
6. Do not generate IDs for documents.
7. Do not build a UI for a feature before the SDK function behind it exists and has a test.
