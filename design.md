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
| Wiki | The knowledge base of the vault: one index over every note, its link graph, the query algorithms, and lint. One instance for the vault, which every module uses. |
| Topic | A note that the wiki maintains about one subject, with its claims cited to sources. |
| Source | A note that stands for one original the wiki learned from: a file, a pasted text, a page. |
| Change | One plan of creates, modifies, and removes over the knowledge base, which code validates and applies as one step. The only way the knowledge base changes. |
| Snapshot | One version of the knowledge base: a document the ledger lists, and a compressed archive of every note beside it. |

## Entities

1. Every document that Yami writes has a `type` property: `module`, `session`, `policy`, `promise`, `skill`, `conversation`, `topic`, `source`, `snapshot`, or `change`. The schema of each type is in `yami/src/document/schema.ts`, and nowhere else.
2. Links are the identity of documents. Yami generates no IDs. A session refers to its policies, promises, skills, and articles as `[[links]]` in its properties.
3. A session is one document. It is the front page of the work: its properties hold the state, the links, and the module's own fields; its body holds the deliverables checklist and the progress. There is no other record of a session's state. The exchange with the agent goes to a conversation note, linked from the document.
4. A module declares its session fields as a schema, in the same form as the core schemas. Core field names (`type`, `module`, `state`, `created`, `iteration`, `harness`, `conversation`, `articles`, `policies`, `promises`, `skills`, `met`, `unmet`) are reserved.
5. A module installs its documents into the vault, and never overwrites a document that exists. Users read and edit them in Obsidian.
6. A module sets defaults for the links of a new session. A session can link to different documents, and the loop uses the session's links, not the module's defaults.

## Layout

```
Yami.base                   vault ledger: every module, and every session grouped by module
conversations/              every conversation with an agent, one note each
wiki/                       the knowledge base: what the wiki module produces, for a person to read
  topics/                   the topics
  sources/                  the sources
<module>/                   user-facing: the session documents, one file each
  sessions.base             module ledger
internal/<module>/          what the module needs: module doc, policies, promises, skills
internal/wiki/              the wiki module's own: its sessions and ledger, the changes, the versions, the originals, the cache
  sessions/                 the ingest sessions
  originals/                the frozen copies that sources embed, each named by its content hash
  sessions.base             module ledger: sessions, versions, changes
  changes/                  one document for each change, the plan and what happened to it
  snapshots/                one document and one archive for each version
  cache/                    what the wiki can rebuild: the embeddings
```

1. A module's folder holds what a person reads. For most modules that is the session documents and `sessions.base`, and nothing else. A module whose output is the thing to read, like the wiki, says `sessions: "internal"`, and its sessions and ledger go under `internal/<module>/` while its folder holds the output. No module mixes the two.
2. Everything else that a module needs goes under `internal/<module>/`.
3. The paths come from `layout()` in `yami/src/module/module.ts`. No other code builds these paths. The wiki folders are constants in `yami/src/wiki/folders.ts`, which assume the module id `wiki`.

## Ledgers

1. A ledger is a base. It reads the properties of documents, so it is current when the properties are current.
2. Code writes a base once, from `yami/src/document/bases.ts`, and never updates it. A module adds its own tables to its ledger as data, `ledgerViews`; the wiki adds its versions and its changes.
3. Code never stores a count or a summary that a base can compute. A module with zero sessions appears in the vault ledger because the ledger lists module documents, not because code counts sessions.
4. The session document is its own ledger. A per-session base would need per-session records as files, and Yami does not create those.

## Layers

```
obsidian_plugin   a plugin: commands and settings, nothing else
yami/obsidian     the Obsidian layer: the Vault adapter, shared documents, conversation notes, prompts
yami/modules/*    modules: data, no logic
yami/module       the Module type, enable, create, the loop, the checks
yami/wiki         the knowledge base: the index, the link graph, the query algorithms, match, lint
yami/conversation the conversation note format and the turn transcript
yami/document     documents, schemas, links, bases, the Vault interface
yami/agent        the Agent and Session base classes, one adapter for each harness
```

1. A layer imports only the layers below it.
2. `yami/obsidian` is the one module that uses the Obsidian API, CodeMirror, and the DOM. The modules below it are plain TypeScript. The `Vault` interface is their whole file system contract; `yami/obsidian` implements it over the Obsidian API, and tests implement it over the file system. The build enforces this rule with `yami/tsconfig.core.json`.
3. `yami/agent` does not know about documents, modules, or the vault. Its types do not expose harness SDK types, so a host can hold an `Agent` or a `Session` without knowing the harness.
4. A skill set is a folder whose `skills/` holds one folder for each skill, and its name is its folder's name. Claude Code loads a set as a plugin of the session. Codex gets the set's skills as a list in its developer instructions, not as an extra skill root: from a root, Codex reads a skill it chose with a command that asks for approval under `ask`, and sometimes from a wrong path. For `/<set>:<skill>`, both put the skill's instructions in the turn: Claude Code itself, and the Codex adapter. A Codex command that only reads files in a skill set's folders is allowed without asking, as the Skill tool is for Claude Code; it is the one approval that does not go to the user, and its rule is `isSkillRead`.
5. The `Agent` and `BaseSession` classes hold what the harnesses share: preferences, session tracking, the turn queue, event delivery, interrupt, and close. An adapter implements `startTurn`, `interruptTurn`, `close`, `models`, `commands`, and `configure`, and reports through `emit`, `askPermission`, `turn.finish`, and `markClosed`. The session contract came from Duet, and Duet uses it from here.
6. Each harness adapter is its own entry point (`yami/agent/claude`, `yami/agent/codex`), so a host bundles only the SDKs it imports.
7. Every Yami plugin, the test bed and Duet, uses `yami/obsidian`, so agents behave the same in all of them: one shared-document hub for the window, one conversation view, one set of prompts.
8. A plugin holds no agent logic. It registers its agents, installs the Obsidian layer, and registers commands. A command calls one SDK function.
9. Yami needs Obsidian, and the Obsidian layer is part of the library. It stays in one module so that a later build can leave it out: a plain TypeScript build of the modules below it, with no Obsidian. That build is future work. Until then, put code that needs Obsidian in `yami/obsidian` and nowhere else. Some files in it do not need Obsidian, for example `collab/text-ops.ts`. The plain build can move them below.

## Modules

A module is a plain object: `id`, `name`, `description`, `schema`, `documents`, `defaults`, `instructions`, `tools`, `sessions`, `access`, and `ledgerViews`. `access: "read-only"` makes a session's agent unable to change any file except through the module's tools, which is how a module makes its tools the only way to write. Its documents are data. Its tools are the one place a module has code: functions the agent calls, which run in the host with the vault and the wiki. `moduleTools` in `yami/module` serves the tools of every enabled module as one tool set named `yami`, with each tool named `<module id>_<tool name>`. The plugin gives that set to its agents, so every session in the vault has it.

A module's skills reach the agents the same way. `moduleSkills` names each module's internal folder as a skill set, and the plugin gives the sets to its agents, so every session can invoke a skill as `/<module id>:<skill>`, and the model can load one when it needs it. A skill's other files, such as the briefs of its workers, sit in its folder beside `SKILL.md`, and a skill names them by path so that a worker reads them itself.

A new feature is a module when it can be expressed as these parts. Before adding a part to the `Module` type or a function to `yami/module`, answer these questions:

1. Is it a document? Then it is a policy, promise, skill, or article in the module's `documents`.
2. Is it a rule the agent must follow? Then it is a policy.
3. Is it something the session must produce? Then it is a promise, with a check if Yami can verify it.
4. Is it a way to verify a deliverable? Then it is a check in `yami/src/module/checks.ts`, and a promise names it.
5. Is it state? Then it is a property of the session document, with a schema.
6. Is it a view? Then it is a base, or a section of the session document.
7. Is it an action the agent takes through the host? Then it is a tool in the module's `tools`.

If none of these fit, the design needs a change to this document before the code.

## The wiki

The wiki is the knowledge base, and the reason the modules belong together. `Wiki` in `yami/wiki` is plain TypeScript over the `Vault` interface, with no agent in its API.

1. **One instance for the vault.** The host builds it once and passes it to `moduleTools` and `runSession`. Tools get it in `ToolContext`, checks in `CheckContext`. A module never builds its own index or search.
2. **The whole vault is the knowledge base.** The index holds every note, as a node of the link graph, except conversation and session notes. Links resolve as Obsidian resolves them, by path or by name, so a link works from any folder. The typed notes, topics and sources, are what the wiki module maintains, and they live in `wiki/`.
3. **Code ranks, the agent answers.** Retrieval is deterministic code: a query returns ranked notes with a snippet and a reason. Synthesis is an agent in a conversation or a session, with the wiki tools. A host that wants an answer starts a conversation with the question.
4. **Algorithms are a registry**, `algorithms` in `yami/wiki`, like `checks`. Every algorithm takes the same query and returns scores in `[0, 1]`, so the benchmark compares them and a host can set the default. A new ranking is an entry, not a new API.
5. **Lint is code.** Dead links, duplicate names, missing descriptions, uncited sources, and orphans are findings with a fix each. The `lint` check turns a finding into an unmet promise, so any module's deliverable can be held to the wiki's health.
6. **Refresh re-reads the vault.** The index has no state file and nothing to go stale. The embeddings are the one cache, keyed by the hash of each chunk, under `internal/wiki/cache/`, and the wiki rebuilds it when it is missing.
7. **The knowledge base changes only through a change plan.** An agent builds one plan of creates, modifies, and removes, and `wiki_change` validates it, applies every write in one step, and records it as a change document. An agent never writes `wiki/` itself: ingest sessions run read-only, so the tool is the only way. Plans from several agents apply one after another, so the knowledge base is never half-written, and a person sees each change land in seconds. No one approves a plan by hand: the promises and the versions are the review.
8. **Every change has a version before and after.** A snapshot is a document in `internal/wiki/snapshots/` and a gzip archive of every note of the knowledge base beside it. The knowledge base is captured when its content hash equals the latest snapshot's. A change snapshots first when the state is not captured, which keeps a person's hand edits, then applies, then snapshots again, and the version links the change. Versions are one line in time: a restore writes a version back and records the result as a new version. A write that fails puts the knowledge base back at the version before. The `Wiki` API is `captured()`, `snapshot()`, `versions()`, `restore()`, and `change()`.
9. **A source is a frozen copy.** Capture leaves the file where it is, copies it into `internal/wiki/originals/` under the start of its content hash, and writes `<name> (source).md`, which embeds the copy and links the file in `from`. The wiki reads and cites the copy, so a later edit of the file does not change what a source said. The source note never shares the file's name, so a link by name is never ambiguous. The same content is captured once. A hash is derived from the content, so it is not a generated ID.
10. **Ingest is a session** of the wiki module, and a map-reduce: the lead chunks each source with `wiki_chunks`, sends one worker per chunk with the Extractor brief, matches every subject in code, sends one worker per slice with the Drafter brief, and assembles one plan. A long document or a folder of documents costs the same care as one. The `sources` and `changes` fields of the session, and its promises, hold the agent to it. The `Wiki` class has no ingest method.

## Conversations and shared documents

1. Every conversation with an agent is a conversation note in `conversations/`, whatever started it: a person, a module session, or another plugin. The note is the record.
2. While an agent works in the vault, every note that it changes is a shared document. The agent's changes merge with the user's typing, show the agent's cursor, and can be undone as one step for each turn. No agent writes a note that is open in an editor behind the user's back.
3. One Obsidian window has one hub. A plugin that bundles its own hub would double-bind every editor, so plugins share the hub through `installCollab`.

## The loop

There is one loop, `runSession` in `yami/src/module/run.ts`. Modules do not have their own.

1. **Context.** The first prompt holds the session document, the module's session fields, and the content of every linked policy, promise, and article. A linked skill that the agent has as a skill set goes by its command: the prompt starts with the first one, `/<module>:<skill>`, so the harness loads it, and lists the others to load when needed. A skill the agent does not have is inlined. Later prompts hold only the verification feedback, because the harness session keeps the conversation.
2. **Action.** One agent turn, with `accept-edits` approval and the vault as the working directory.
3. **Verification.** Yami runs the check of each promise and records the outcome in the session document. The exchange is a conversation note, linked from the document, so a person can watch a run in Obsidian, answer its approvals, and continue it.

The session ends `done` when every promise is met; `needs-attention` when the iterations run out or a promise has no check; `failed` when the harness ends a turn with an error. `needs-attention` is the state for a person to look at, and the ledgers show it. A later run continues the iteration count.

## Approval and permissions

1. `approval` sets what the agent does without asking: `ask`, `accept-edits`, `plan`, `auto`, or `sandbox`. Everything else is a permission request. `access: read-only` is a hard limit: no changes, no commands that change files, and no requests.
2. Each harness maps the setting in its own way, and the differences are in the `yami/agent` README. Code outside `yami/agent` does not depend on them.
3. A session without a permission handler denies every request. The host decides whether to prompt, and how.
4. Approvals go to the user, never to an automatic reviewer that a harness configuration selects. The one exception is a Codex command that only reads files of the session's skill sets, which the adapter allows, because loading a skill is part of using it (see Layers, item 4). An `allow-session` decision applies to the session only, never to the user's settings files.
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

1. **Unit tests** (`npm test` in `yami/`): the session queue, each adapter against a scripted harness (`test/fixtures/fake-codex.mjs`), the loop and document logic with a fake agent and a file system `Vault`, and the wiki with a fixture vault and a fake embedder: each algorithm, match, lint, and the checks. No harness, no API key, deterministic. Every state of the loop has a case.
   **Benchmark** (`npm run bench` in `yami/`): every algorithm against a real vault and a gold file of questions, reporting recall, mean reciprocal rank, and time. It decides which algorithm is the default; opinions do not.
2. **Live tests** (`npm run test:live`): the same scenarios against the real CLIs, for both harnesses. Connect, a turn with a tool, approvals, interrupt, a command stopped on interrupt, queued messages, resume, and no process left behind.
3. **Obsidian layer and plugin changes:** `npm run test:obsidian` in `obsidian_plugin/` starts a separate Obsidian with a temporary vault, installs the built plugin, and drives it with real agents through its debugging port. Plain Node cannot catch renderer bugs, and three of them have happened. `npm test` in `yami/` also covers the shared documents and the conversation manager over a fake Obsidian app.
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
5. Do not use the Obsidian API, CodeMirror, or the DOM outside `yami/obsidian` and the plugins.
6. Do not generate IDs for documents.
7. Do not build a UI for a feature before the SDK function behind it exists and has a test.
8. Do not build a second index, search, or link graph over the vault. Use the wiki.
9. Do not write a note under `wiki/` from an agent or a tool except through a change plan.
