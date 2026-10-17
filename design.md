# Yami design policy

This document is the design policy of the repository. When code and this document disagree, the code is wrong, or this document needs a change that is agreed first. The package READMEs describe what each package does; this document says what every package must keep true.

### Base Concepts

Yami is a Typescript library designed to enable agents in Obsidian plugins. Yami ships its own concept of how agent work integrates with an Obsidian vault, and this concept is based on a session document and a few extra entities that link to that session document, such as policies, promises, and skills.

An agent reads the session document to know what to do, how, and how its work is checked. Everything else can be customized around it in the plugin: by importing and using the Yami library, you can create your own module that carries it's own set of MCP tools, skills, and front end UI surfaces. Yami exposes an API that makes it easy to work with these session entities, manage session state, and manage the agents as they run. Yami also has a built in set of wiki tools to enable an obsidian-based LLM wiki directly in the vault, so all custom modules and agent flows and use the vault as a knowledge source.

This repository holds the library, `yami/`, and a showcase plugin, `obsidian_plugin/`. The showcase shows what a plugin built on Yami can do. The library is the product; the showcase is an example of its use.

## Terms

| Term | Meaning |
| --- | --- |
| Vault | The Obsidian vault. The highest context, and the working directory of every agent. |
| Plugin | An Obsidian plugin built on Yami. It chooses the agents and the modules. `obsidian_plugin` is the showcase. |
| Host | The program that builds a Yami and runs its sessions: a plugin, or a test. |
| Yami | The runtime of one vault: its modules, its wiki, its agents, and the handles of its sessions. A plugin builds one with `createYami`. |
| Module | One agent workflow in the vault, as a subclass of `YamiModule`: its documents, templates, tools, checks, and actions. |
| Wiki | An LLM knowledge base built on obsidian links; The wiki is built into Yami; all modules have the ability to use this shared knowledge base for their workflows |
| Vault module | A module defined by markdown in the vault, with no code: a module document and template documents under `internal/<id>/`. Yami finds it and runs it like any module. |
| Template | One kind of session of a module: the documents that a new session links, and how a run goes (iterations, access, instructions). A code module makes one with `this.template`; a vault module has a template document. |
| Review | The step of a run in which a new read-only agent judges the session's policies, and its promises that have no check. |
| Session | One piece of work of a module. One markdown document that links its skills, policies, promises, and articles, and records its state. |
| Run | One pass of the agent loop over a session: from a start or a resume to `done`, `needs-attention`, `failed`, or `stopped`. |
| Action | An act of the person, such as publish or return, that a module defines and a host offers as a command. |
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
| Thread | One piece of validated work on repositories: the threads module's session. |
| Checkout | A reading list with copies of wiki documents: the librarian's session. |
| Volume | A folder of the user's own writing under `journals/`. An edition is one publish of it. |

## The library and the plugin

1. **The library holds every feature.** The session runtime, the loop, the checks, the wiki, the conversation notes, the shared documents, the commands for sessions, conversations, and the wiki, the folder colors, the build options, and the test kit are in `yami`. A plugin gets them from `createYami`.
2. **A plugin holds its choices, and may hold its own views.** It chooses its agents and its modules, and gives them to `createYami`. A module is a workflow: its documents, templates, tools, checks, and actions. A view, such as the showcase's panel, holds layout and look only: what it shows and what it does come from the public API, such as `yami.summaries`, `session.details`, `session.acts`, `module.acts`, `wiki.neighbors`, `wiki.tag`, `onSessionsChange`, and `onWikiChange`. A plugin writes no other code for Yami.
3. **A gap in a plugin is a gap in the library.** When a plugin needs setup, a helper, a command, or a constant that a second plugin would need too, the library gets it, with a test, and the plugin uses it. The plugin does not keep its own copy until later.
4. **A plugin uses the public API only.** It imports the package entries (`yami`, `yami/obsidian`, `yami/wiki`, `yami/document`, `yami/agent`, `yami/testing`, `yami/esbuild`), never a file of `yami/src`. The `yami` README documents each entry.
5. **Each showcase module shows a part of the API.** A new part of the API gets a use in the showcase, so the Obsidian tests run it in the real app.

The showcase also has two views. The wiki navigator, `obsidian_plugin/src/navigator/`, walks the wiki by its tags with `wiki.neighbors` and `wiki.tag`, and follows the open note. The panel, `obsidian_plugin/src/panel/`, shows the modules, the sessions of a module, and one session with its documents, its conversation, its progress, and its acts as buttons. Each view's needs became library features: the panel found the summaries, the details, the acts of a session and of a module, the change feed, the template's label, and the plugin stylesheet of `copyStyles`; the navigator found each note's own tags, the tag hierarchy, the wiki's change feed, and the rule of which notes the index holds.

## Entities

1. Every document that Yami writes has a `type` property: `module`, `template`, `session`, `policy`, `promise`, `skill`, `conversation`, `topic`, `source`, `snapshot`, or `change`. The schema of each type is in `yami/src/document/schema.ts`, and nowhere else.
2. Links are the identity of documents. Yami generates no IDs. A session refers to its policies, promises, skills, and articles as `[[links]]` in its properties.
3. A session is one document. It is the front page of the work: its properties hold the state, the links, the template, and the module's own fields; its body holds the deliverables checklist and the progress. There is no other record of a session's state. The exchange with the agent goes to a conversation note, linked from the document.
4. A module declares its session fields as a schema, in the same form as the core schemas. Core field names (`type`, `module`, `template`, `state`, `created`, `iteration`, `harness`, `conversation`, `articles`, `policies`, `promises`, `skills`, `met`, `unmet`, `review`, `followed`, `broken`) are reserved: `Yami` refuses a schema that declares one, and a new session whose fields set one.
5. A module installs its documents into the vault, and never overwrites a document that exists. Users read and edit them in Obsidian.
6. A template sets the links of a new session. A session can link to different documents, and the loop uses the session's links, not the template's.

## Layout

```
Yami.base                   vault ledger: every module, and every session grouped by module
conversations/              every conversation with an agent, one note each
wiki/                       the knowledge base: what the wiki module produces, for a person to read
  topics/                   the topics
  sources/                  the sources
<module>/                   user-facing: the session documents, one file each
internal/<module>/          what the module needs: module doc, ledger, policies, promises, articles, skills, agents
  sessions.base             module ledger
  templates/                a vault module's template documents
internal/yami/              Yami's own skill set: the base skill, skills/run/SKILL.md. The id `yami` is reserved.
internal/wiki/              the wiki module's own: its sessions and ledger, the changes, the versions, the originals, the cache
  sessions/                 the ingest sessions
  originals/                the frozen copies that sources embed, each named by its content hash
  sessions.base             module ledger: sessions, versions, changes
  changes/                  one document for each change, the plan and what happened to it
  snapshots/                one document and one archive for each version
  cache/                    what the wiki can rebuild: the embeddings
```

1. A module's folder holds what a person reads. For most modules that is the session documents. A module sets `sessionsIn`: `folder` (the default); `internal`, when the module's folder holds its output instead, as the wiki's does, so its sessions go under `internal/<module>/sessions/`; or `none`, when the module has no sessions, as journals, and gets no ledger. `ledgerIn` puts the module ledger in the internal folder (the default) or in the module's folder.
2. A session may keep the files it produces in a folder with its own name, beside its document: `librarian/<session>.md` and `librarian/<session>/`. Nothing else goes in a module's folder.
3. Everything else that a module needs goes under `internal/<module>/`.
4. The paths come from `YamiModule.layout` in `yami/src/module/module.ts`. No other code builds these paths. The wiki folders are constants in `yami/src/wiki/folders.ts`, which assume the module id `wiki`.
5. Each module has a color, so a person sees which folders belong together. The module's folder takes the color; its internal folder takes the color muted halfway toward gray, because a person reads it less; `internal/` is gray. A module sets its own `color`, or takes a basic color chosen by its id, so the color is the same on every start. The wiki is cyan. The colors are in `yami/src/module/colors.ts`; `yami/obsidian` shows them in the file explorer. Each module also has an icon, a name in the host's icon set, so a view can show the module at a glance. In Obsidian an icon that the app does not have shows as the default, `box`, and the console says so, because an icon name that a Lucide update removes must not stop the plugin from loading.

## Ledgers

1. A ledger is a base. It reads the properties of documents, so it is current when the properties are current.
2. Code writes a base once, from `yami/src/document/bases.ts`, and never updates it. A module adds its own tables to its ledger as data, `ledgerViews`; the wiki adds its versions and its changes.
3. Code never stores a count or a summary that a base can compute. A module with zero sessions appears in the vault ledger because the ledger lists module documents, not because code counts sessions.
4. The session document is its own ledger. A per-session base would need per-session records as files, and Yami does not create those.

## Layers

```
obsidian_plugin       the showcase plugin: createYami with its agents and its modules
  src/modules/*       the showcase modules: threads, librarian, journals
  test/fixtures/vault-modules/  hello, the showcase's vault module
  src/panel/          the showcase panel: a view over the read API and the acts
  src/navigator/      the wiki navigator: a view over the tag hierarchy
yami/obsidian         the Obsidian layer: createYami, the Vault adapter, shared documents, conversation notes, prompts, commands
yami/testing          a file system Vault, a scripted agent, and testYami, for tests without Obsidian
yami                  the SDK: YamiModule, templates, actions, Yami, Session, the loop, the checks, the wiki module
yami/wiki             the knowledge base: the index, the link graph, the query algorithms, match, lint
yami/conversation     the conversation note format and the turn transcript
yami/document         documents, schemas, links, bases, the Vault interface
yami/agent            the Agent and Session base classes, one adapter for each harness
yami/esbuild          the esbuild options of a plugin (a build tool, not in the bundle)
```

1. A layer imports only the layers below it.
2. `yami/obsidian` is the one module that uses the Obsidian API, CodeMirror, and the DOM. The modules below it are plain TypeScript, so a plugin's modules and their tests run in Node. The `Vault` interface is their whole file system contract; `yami/obsidian` implements it over the Obsidian API, and `yami/testing` over the file system. The build enforces this rule with `yami/tsconfig.core.json`.
3. `yami/agent` does not know about documents, modules, or the vault. Its types do not expose harness SDK types, so a host can hold an `Agent` or a `Session` without knowing the harness.
4. A skill set is a folder whose `skills/` holds one folder for each skill, and its name is its folder's name. Claude Code loads a set as a plugin of the session. Codex gets the set's skills as a list in its developer instructions, not as an extra skill root: from a root, Codex reads a skill it chose with a command that asks for approval under `ask`, and sometimes from a wrong path. For `/<set>:<skill>`, both put the skill's instructions in the turn: Claude Code itself, and the Codex adapter. A Codex command that only reads files in a skill set's folders is allowed without asking, as the Skill tool is for Claude Code; it is the one approval that does not go to the user, and its rule is `isSkillRead`.
5. `runTool` checks a tool's input against its schema for every harness, because Codex sends the model's arguments unchecked. A tool's code never repeats a check that its schema holds.
6. The `Agent` and `BaseSession` classes hold what the harnesses share: preferences, session tracking, the turn queue, event delivery, interrupt, and close. An adapter implements `startTurn`, `interruptTurn`, `close`, `models`, `commands`, and `configure`, and reports through `emit`, `askPermission`, `turn.finish`, and `markClosed`. The session contract came from Duet.
7. Each harness adapter is its own entry point (`yami/agent/claude`, `yami/agent/codex`), so a host bundles only the SDKs it imports.
8. Every Yami plugin uses `yami/obsidian`, so agents behave the same in all of them: one shared-document hub for the window, one conversation view, one set of prompts.
9. A plugin calls `createYami` with its agents and its modules, in `onload`. It writes no command for conversations, sessions, or the wiki: `createYami` adds them, and one command for each template and each action of a module. `createYami` sets the working directory, the tools, and the skills of the agents, builds the wiki, enables the modules, and stops every run when the plugin unloads.
10. Yami needs Obsidian, and the Obsidian layer is part of the library. It stays in one module so that a later build can leave it out. Put code that needs Obsidian in `yami/obsidian` and nowhere else. Some files in it do not need Obsidian, for example `collab/text-ops.ts`. A plain build can move them below.

## Modules

A module is a subclass of `YamiModule`. Its fields declare it: `id`, `name`, `description`, `schema` (the session fields), `sessionsIn`, `ledgerIn`, `ledgerViews`, `instructions`, `checks`, `color`, and `icon`. Builders in its field initializers make its parts, and each returns a handle that the other parts take:

- `this.skill(markdown, files)`, `this.policy(name, markdown)`, `this.promise(name, markdown)`, `this.article(name, markdown)`, and `this.agent(markdown)` make its documents. The markdown holds the properties as frontmatter: a skill's `name` and `description`, a promise's `check` and the properties the check reads, an agent's `name`, `description`, and `tools`. A plugin keeps them as `.md` files and imports them as text (`yami/esbuild` and `yami/testing` load `.md` that way). An agent is a Claude Code subagent with its own tool list; Codex has no subagents.
- `this.template({ id, name, description, skills, policies, promises, articles, maxIterations, access, instructions, fields, body, command })` makes a kind of session. `template.create({ name, fields, add })` writes a session document that links the template's documents. `access: "read-only"` makes a session's agent unable to change any file except through the tools, which is how a module makes its tools the only way to write.
- `this.action({ id, name, ... })` makes an act of the person: on the session open in the editor (`on: template`, `when`), on one of several things the person picks (`choose`), or with no input.
- `tools()` returns the module's tools, functions that the agent calls. `checks` holds the functions that the loop calls. Both run in the host, and reach the vault and the wiki through `this.vault` and `this.wiki` once the module is added to a Yami. A module's own checks come before the core checks of the same name. A tool that changes nothing, no file and no state of the host, sets `readOnly: true`, so a review can use it.

A module's documents, tools, checks, and actions are the only places it has code. That code is in the module's own folder, with the class in its `index.ts` and the documents as markdown files beside it. A module uses the wiki through `this.wiki` and `this.yami.ingest`; it imports no other module. `Yami` serves the tools of every module as one tool set named `yami`, with each tool named `<module id>_<tool name>` (a dash of the id becomes an underscore), beside its own tools, `yami_check` and `yami_review`, and gives the set to its agents, so every session and conversation in the vault has it.

A module's skills reach the agents the same way. `moduleSkills` names each module's internal folder as a skill set, and `Yami` gives the sets to its agents, so every session can invoke a skill as `/<module id>:<skill>`, and the model can load one when it needs it. A skill's other files, such as the briefs of its workers, sit in its folder beside `SKILL.md`, and a skill names them by path so that a worker reads them itself.

A new feature is a module when it can be expressed as these parts. Before adding a part to `YamiModule` or a function to the SDK, answer these questions:

1. Is it a document? Then it is a policy, promise, skill, article, or agent of the module.
2. Is it a rule the agent must follow? Then it is a policy.
3. Is it something the session must produce? Then it is a promise, with a check if Yami can verify it.
4. Is it a way to verify a deliverable? Then it is a check: a core check in `yami/src/module/checks.ts`, or one of the module's `checks`, and a promise names it.
5. Is it a kind of work that an agent does? Then it is a template, and each piece of that work is a session.
6. Is it state? Then it is a property of the session document, with a schema.
7. Is it a view? Then it is a base, or a section of the session document.
8. Is it an action the agent takes through the host? Then it is a tool in the module's `tools()`.
9. Is it an act of the user, such as publishing or returning? Then it is an action of the module, which the host offers as a command. No tool does it.

If none of these fit, the design needs a change to this document before the code.

### Vault modules

A person can define a module in the vault with no code. A vault module is the folder `internal/<id>/` with a module document and one or more template documents in `templates/`. Its policies, promises, skills, agents, and articles go in the same folders that a code module installs. Yami finds vault modules at start and as they change, and a host sees them through the same API as code modules. A broken document is a problem that the API reports, never a crash. A vault module has no tools, checks of its own, or actions. Its sessions use the tools that Yami serves and the core checks, and the review judges what code cannot check. A template's links resolve as a session's links do: by path or name, first in the module's own folders, then in the whole vault. A code module wins an id it shares with a vault module. The `New module` command writes a starter vault module.

## The wiki

The wiki is the knowledge base, and the reason the modules belong together. `Wiki` in `yami/wiki` is plain TypeScript over the `Vault` interface, with no agent in its API.

1. **One instance for the vault.** `Yami` builds it once as `yami.wiki`, with the conversation folder left out; in Obsidian, `createYami` also leaves out the Excluded files of the settings and marks the index stale on each change in the vault. Tools reach it as `this.wiki`, checks in `CheckContext`. A module never builds its own index or search.
2. **The whole vault is the knowledge base.** The index holds every note, as a node of the link graph, except conversation and session notes. Links resolve as Obsidian resolves them, by path or by name, so a link works from any folder. The typed notes, topics and sources, are what the wiki module maintains, and they live in `wiki/`.
3. **Code ranks, the agent answers.** Retrieval is deterministic code: a query returns ranked notes with a snippet and a reason. Synthesis is an agent in a conversation or a session, with the wiki tools. A host that wants an answer starts a conversation with the question.
4. **Algorithms are a registry**, `algorithms` in `yami/wiki`, like `checks`. Every algorithm takes the same query and returns scores in `[0, 1]`, so the benchmark compares them and a host can set the default. A new ranking is an entry, not a new API.
5. **Lint is code.** Properties that do not parse, dead links, duplicate names, missing descriptions, uncited sources, and orphans are findings with a fix each. A note whose properties do not parse stays in the index with its body and no properties, so one broken note never stops the index, the tools, or the checks of another session. The `lint` check turns a finding into an unmet promise, so any module's deliverable can be held to the wiki's health.
6. **Tags are a hierarchy by their names.** `ml/vision` is below `ml`. `wiki.neighbors(note)` gives a note's own tags, the tags above them, and the tags one level below them; `wiki.tag(tag)` gives a tag's tags above and below and the notes that hold it. The index builds the hierarchy at each refresh from the notes' own tags. No page stands for a tag, no property links a note up to another, and nothing is stored. A large wiki stays walkable by subject: a person with the navigator, an agent with `wiki_neighbors`.
7. **Refresh re-reads the vault.** The index has no state file and nothing to go stale. The embeddings are the one cache, keyed by the hash of each chunk, under `internal/wiki/cache/`, and the wiki rebuilds it when it is missing.
8. **The knowledge base changes only through a change plan.** An agent builds one plan of creates, modifies, and removes, and `wiki_change` validates it, applies every write in one step, and records it as a change document. An agent never writes `wiki/` itself: ingest sessions run read-only, so the tool is the only way. Plans from several agents apply one after another, so the knowledge base is never half-written, and a person sees each change land in seconds. No one approves a plan by hand: the promises and the versions are the review.
9. **Every change has a version before and after.** A snapshot is a document in `internal/wiki/snapshots/` and a gzip archive of every note of the knowledge base beside it. The knowledge base is captured when its content hash equals the latest snapshot's. A change snapshots first when the state is not captured, which keeps a person's hand edits, then applies, then snapshots again, and the version links the change. Versions are one line in time: a restore writes a version back and records the result as a new version. A write that fails puts the knowledge base back at the version before. The `Wiki` API is `captured()`, `snapshot()`, `versions()`, `restore()`, and `change()`.
10. **A source is a frozen copy.** Capture leaves the file where it is, copies it into `internal/wiki/originals/` under the start of its content hash, and writes `<name> (source).md`, which embeds the copy and links the file in `from`. The wiki reads and cites the copy, so a later edit of the file does not change what a source said. The source note never shares the file's name, so a link by name is never ambiguous. A file that has sources is compared with its latest one, so an edit back to an older text is a change; a file with no source of its own shares the source of any file with the same content. A hash is derived from the content, so it is not a generated ID.
11. **Ingest is a session** of the wiki module's `ingest` template, and a map-reduce. `yami.ingest({ files | folder, name, policies })` captures the files as sources and creates the session; a module adds its own policies to the wiki's, as journals does. The run: the lead chunks each source with `wiki_chunks`, sends one worker per chunk with the Extractor brief, matches every subject in code, sends one worker per slice with the Drafter brief, and assembles one plan. A long document or a folder of documents costs the same care as one. The `sources` and `changes` fields of the session, and its promises, hold the agent to it. The `Wiki` class has no ingest method.

## The showcase modules

The modules in `obsidian_plugin/src/modules/` are built on the public API, as any plugin's modules are, and they use the wiki. They keep the rules of this document. The rules below came from porting Almagest and obsidian-threads. Each one answers a failure of the original or a cut that review found.

### Threads

1. **A thread is one session document** in `threads/`: the idea and context of the stub, the spec, the plan, the validation rounds, and the outcome, as sections. The three documents of obsidian-threads become one, as Entities item 3 requires.
2. **Status is derived, never set.** Code derives the phase from the requirements, the plan, the rounds, and the outcome each time it reads the document. The `phase` property is a copy for the ledger, and no code trusts it: the module's `thread` check derives the phase again. A closed or dropped thread is met. A thread is for review when the user must decide: it used its budget of rounds, or it waits for a thread in its `after` that is not validated or ended. So the loop stops for the user instead of pushing on.
3. **The tools write the structured sections.** Requirements are `- **R1** text`; tasks are `- [ ] **T1** text · serves R1` with a `done:` or `dropped:` trail. A task's state comes from its trail, not its box, so a click in Obsidian changes nothing, and a box that disagrees with its trail is a problem. A tool refuses to rewrite a section that holds a line it cannot read, so it never loses the user's text. Each round keeps its data as JSON in one hidden comment on a line of its own, and code reads rounds only from that line; text that quotes such a comment is escaped. Rounds are append-only: the outcomes of a round's findings go into the next round, or into the outcome at the close, so no write ever changes a round that exists.
4. **The rules of obsidian-threads stay in code**: every requirement gets a result with evidence; a failing requirement needs a blocking finding; a `predates` finding never blocks; each finding of the last round gets an outcome before the next round or the close; a carried result is a pass whose requirement text did not change; a budget of rounds; after a pass, a change to the plan, requirements, or rules needs the user's words, and when the budget is used those words give the one more round that validates the change. A closed or dropped thread takes no more writes. Thread writes run one at a time.
5. **The reviewer and the validator are agents of the module** with tool lists that hold no edit tool. On Codex, which has no subagents, the run skill hands validation to a fresh conversation, `/threads:validate`; an agent never validates its own work.
6. **Work outside the vault uses the harness's own settings.** The folders an agent may edit and the commands it may run without asking are the user's Claude Code and Codex settings, which every session loads. The run skill reads each repository's instruction files.

### Librarian

1. **A checkout is a session**: the session document is the reading list, and the folder of its name holds a copy of each document. A person can create a checkout session, write the request in it, and run it; or a conversation can call `librarian_checkout`, which creates `librarian/<date> <name>.md`. The date keeps the reading list's name apart from a topic of the same subject, so a link by name still finds the topic. Only knowledge notes are checked out.
2. **A copy is not knowledge.** It carries `copy_of` and the hash of the original's body, and the index skips any note with `copy_of`. Its links still point at the wiki.
3. **Return is the user's act**, an action on a checkout that is out. A copy whose hash changed is an edit. When the original also changed since the checkout, the copy is skipped and stays; otherwise the edit returns as a `modify` with `base`, the hash, so a change that lands in between cannot be overwritten. A link to another copy points back at its original. Each edit is checked alone, so an edit the wiki refuses stays in its copy with the reason and holds back no other. One change, "Return <name>", applies the rest, and the copies that returned or had no edit are removed.

### Journals

1. **A volume is a folder** directly under `journals/`. Its notes are the user's, and no agent changes them.
2. **Publish is the user's act**, an action that asks which volume. It captures each note of the volume as a source, a frozen copy, and creates one wiki ingest session, an edition, with the sources that are new and the `Journal sources` policy. A note is published when its latest source holds its text, so an edit back to an older text publishes again, and a volume with no change has nothing to publish. The edition's name is made safe before anything is captured, so a volume of any name publishes.

## Conversations and shared documents

1. Every conversation with an agent is a conversation note in `conversations/`, whatever started it: a person, a module session, or another plugin. The note is the record.
2. While an agent works in the vault, every note that it changes is a shared document. The agent's changes merge with the user's typing, show the agent's cursor, and can be undone as one step for each turn. No agent writes a note that is open in an editor behind the user's back.
3. One Obsidian window has one hub. A plugin that bundles its own hub would double-bind every editor, so plugins share the hub through `installCollab`.

## The loop

There is one loop, `runSession` in `yami/src/module/run.ts`. Modules do not have their own. A host runs it through a session's handle: `yami.session(path)`, or the handle that `template.create()` returns.

1. **Context.** The first prompt invokes the base Yami skill, which says how every session runs, and holds what is particular to the session: the session document, the module's session fields, the instructions of the module and the template, and the content of every linked policy, promise, and article. A linked skill that the agent has as a skill set goes by its command, `/<module>:<skill>`; the first one loads at the start, and the others are listed to load when needed. A skill the agent does not have is inlined. Later prompts hold only the feedback, because the harness session keeps the conversation.
2. **Action.** One agent turn, with `accept-edits` approval, the template's access, and the vault as the working directory. The agent can run the code checks itself with the self-check tool before it ends the turn.
3. **Verification.** Yami runs the check of each promise that has one, and records the outcome in the session document. The exchange is a conversation note, linked from the document, so a person can watch a run in Obsidian, answer its approvals, and continue it.
4. **Review.** When those checks pass, and the session links a policy or a promise with no check, a new read-only conversation with the same agent judges each one and records a verdict through a tool. The reviewer gets only the tools that declare `readOnly`, and a `yami_review` bound to its own review, which no other agent has. The worker never judges its own work. The reviewer reads the worker's last message and the run's conversation note to see what the run changed. A broken policy or an unmet promise is feedback for the next iteration, the same as an unmet check. The review is best effort: an agent judges natural language, and the verdicts with their reasons are in the session document for a person to read.

The session ends `done` when every check passes and the review finds every policy followed and every promise met; `needs-attention` when the iterations run out, a check returns `review`, or the reviewer gives no verdict on an item; `failed` when the harness ends a turn with an error; `stopped` when the person stops the run or interrupts its turn. `needs-attention` is the state for a person to look at, and the ledgers show it. A later run continues the iteration count.

- `start()` runs the loop in a new conversation, with the full context.
- `resume()` checks the promises first, and ends `done` with no turn when they are met. Otherwise it continues the session's conversation note, so the agent keeps what it did, with the feedback as the prompt. When the harness no longer has the session, the conversation reports it, and the prompt holds the whole context before the feedback.
- `stop()` interrupts the turn; `kill()` closes the harness session at once. Both end the run `stopped`, and a resume continues it.
- `status()` is `working`, `checking`, or `reviewing` while a run is live in this Yami, and otherwise the state the document records. A document that says `running` with no live run reads as `stopped`: its run ended without recording its end, for example when the app quit. `session.on` and `yami.onSession` report each change.
- `acts(properties)` gives what a person can do with the session now: start it with each agent, resume it, stop or kill a live run, and the module's actions on it whose `when` holds. The commands and every view use it, so the rules of when an act applies are in one place. `STATUS_LABELS` gives the words for each status.

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
6. The Claude Agent SDK expects Node's timers, `AbortController`, and `import.meta`, and the MCP SDK compiles schemas with `new Function`. In Obsidian's renderer the globals are Chromium's, and Obsidian's review rejects generated code. `pluginBuild` in `yami/esbuild` fixes all four, for the SDKs' own files only.

## Testing

A change is done when these pass, and the report says which ran:

1. **Unit tests** (`npm test` in `yami/` and in `obsidian_plugin/`): the session queue, each adapter against a scripted harness (`test/fixtures/fake-codex.mjs`), the loop, the session handle, and the document logic with `yami/testing`, and the wiki with a fixture vault and a fake embedder: each algorithm, match, lint, and the checks. A library feature has its tests in `yami/`; the plugin's tests cover its modules the same way. No harness, no API key, deterministic. Every state of the loop has a case.
   **Benchmark** (`npm run bench` in `yami/`): every algorithm against a real vault and a gold file of questions, reporting recall, mean reciprocal rank, and time. It decides which algorithm is the default; opinions do not.
2. **Live tests** (`npm run test:live` in `yami/`): the same scenarios against the real CLIs, for both harnesses. Connect, a turn with a tool, approvals, interrupt, a command stopped on interrupt, queued messages, resume, and no process left behind. `YAMI_LIVE_THREAD=1 npm run test:live` in `obsidian_plugin/` takes one thread from stub to closed with a real Claude Code.
3. **Obsidian layer and plugin changes:** `npm run test:obsidian` in `obsidian_plugin/` starts a separate Obsidian with a temporary vault, installs the built plugin, and drives it with real agents through its debugging port. The tests are in the plugin because they need a built plugin, but most of what they test is the library's Obsidian layer: `createYami`, the commands, the conversation notes, the shared documents, and the runs. Plain Node cannot catch renderer bugs, and three of them have happened. `npm test` in `yami/` also covers the shared documents and the conversation manager over a fake Obsidian app.
4. A guard in the build fails when a dependency changes shape, instead of a silent no-op.

## Documentation

1. This document holds the policy. The `yami` README holds the APIs and the harness facts. The plugin README holds how to run the showcase, and what its modules do.
2. Code comments say what a reader cannot see in the code: a constraint, a harness quirk, a reason that is not obvious. They do not repeat the code.
3. Prose follows ASD-STE100: short sentences, one term for one thing, active verbs.

## Do not

1. Do not add a state file, a schema, or a ledger for one feature. Add a module.
2. Do not store what a base can compute.
3. Do not put a module's code outside its folder, or a workflow's code in a plugin outside its modules.
4. Do not call a harness SDK outside its adapter.
5. Do not use the Obsidian API, CodeMirror, or the DOM outside `yami/obsidian` and the plugins.
6. Do not generate IDs for documents.
7. Do not build a UI for a feature before the SDK function behind it exists and has a test.
8. Do not build a second index, search, or link graph over the vault. Use the wiki.
9. Do not write a note under `wiki/` from an agent or a tool except through a change plan.
10. Do not trust a stored status. Derive it from the record each time.
11. Do not write in a plugin what a second plugin would need. Build it in the library.
12. Do not import a file of `yami/src` from a plugin. Use the package entries.
