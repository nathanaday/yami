# yami

The Yami library. The design policy is in [`design.md`](../design.md).

| Module | What it does |
| --- | --- |
| `yami` | The SDK: define modules, their session templates, tools, checks, and actions, find the modules defined in the vault, and run the agent loop and its review on session documents. |
| `yami/obsidian` | The Obsidian layer: `createYami`, the vault adapter, shared documents, conversation notes, the approval prompts, and the commands. |
| `yami/wiki` | The knowledge base: one index over every note, the link graph, the query algorithms, match, lint, changes, and versions. |
| `yami/agent` | Starts a harness, Claude Code or Codex, and runs conversations with it. |
| `yami/document` | Reads and writes the vault documents that Yami defines, and generates the ledgers. |
| `yami/conversation` | The conversation note format: properties, the user and agent blocks, and the turn transcript. |
| `yami/testing` | A vault on the file system, a scripted agent, and `testYami`, to test a module in Node. |
| `yami/esbuild` | The esbuild options of an Obsidian plugin built on Yami. |
| `yami/markdown` | The type of a `.md` file imported as text. |

`VERSION` from `yami` is the version of the package, such as `"0.5.0"`. A host can show it, for example in a bug report.

`yami/obsidian` is the one module that uses the Obsidian API, CodeMirror, and the DOM. The other modules are plain TypeScript, and the build checks that they stay so. A plugin's modules import `yami`, so they and their tests run in Node.

## Build a plugin

A plugin gives `createYami` its agents and its modules. `createYami` does the rest: the vault adapter, the wiki, the shared documents, the conversation notes, the commands, and the cleanup when the plugin unloads.

```ts
import { Plugin } from "obsidian";
import { ClaudeAgent } from "yami/agent/claude";
import { CodexAgent } from "yami/agent/codex";
import { createYami, type ObsidianYami } from "yami/obsidian";
import { Librarian } from "./modules/librarian";

export default class MyPlugin extends Plugin {
  yami!: ObsidianYami;

  onload() {
    this.yami = createYami(this, {
      agents: [new ClaudeAgent(), new CodexAgent()],
      modules: [new Librarian()],
    });
  }
}
```

A module is a class. Its skills, policies, and promises are markdown files beside it, imported as text:

```ts
import { defineTool, YamiModule, z, type AgentTool, type Schema } from "yami";
import checkoutSkill from "./skills/checkout/SKILL.md";
import madePromise from "./promises/Reading list made.md";

export class Librarian extends YamiModule {
  readonly id = "librarian";
  readonly name = "Librarian";
  readonly schema: Schema = { request: { type: "text" }, status: { type: "text", values: ["out", "returned"] } };
  readonly checks = { "checked-out": checkedOut };

  readonly checkoutSkill = this.skill(checkoutSkill);
  readonly made = this.promise("Reading list made", madePromise);
  readonly checkout = this.template({ id: "checkout", name: "Checkout", skills: [this.checkoutSkill], promises: [this.made], maxIterations: 2 });

  readonly returnAction = this.action({
    id: "return",
    name: "Return this checkout",
    on: this.checkout,
    when: (properties) => properties.status === "out",
    run: async (session) => (await this.returnCheckout(session.path)).summary,
  });

  tools(): AgentTool[] {
    return [defineTool({ name: "checkout", description: "…", input: { request: z.string() }, run: async (input) => "…" })];
  }
}
```

The plugin's build needs `pluginBuild` from `yami/esbuild`, which loads `.md` files as text, and its `tsconfig.json` needs `"types": ["yami/markdown"]`. With these, the plugin gets:

- **Commands** for each agent (New conversation with claude, Run this session with Claude), for the session open in the editor (Resume this session, Stop this session, Kill this session's agent), for each template (Librarian: new checkout), for each action (Librarian: return this checkout), for the wiki (search, lint, versions, ingest), and New module.
- **Every agent** works in the vault, with Yami's self-check tool (`yami_check`), the tools of every module (`librarian_checkout`, `wiki_search`, …), the base skill (`/yami:run`), and the skills of every module (`/librarian:checkout`). A reviewer gets only the tools that change nothing, and `yami_review`.
- **Every module** installs its documents into the vault when the workspace is ready, and never overwrites a file that exists.
- **Vault modules**: a person can define a module in the vault with markdown only. Yami finds it at start and as it changes, and the plugin gets its commands. See [Vault modules](#vault-modules).

## How Yami organizes work

- A **vault** is the Obsidian vault.
- A **module** is one agent workflow in the vault, for example the wiki or the librarian. A code module is a class of the plugin; a vault module is markdown in the vault.
- A **template** is one kind of session of a module: the skills, policies, promises, and articles that a new session links, and how a run goes.
- A **session** is one piece of work, and one markdown document. The document is the front page of the work: what the session must deliver, what it must follow, and how far it is. An agent reads it to know the work.
- A **run** is one pass of the agent loop over a session.
- A **review** is the step of a run in which a new read-only agent judges the session's policies, and its promises that have no check.

Every document that Yami writes has a `type` property, and links are the identity of documents. Yami writes a link with the full path and the document name as the alias, `[[internal/notes/policies/Cite sources|Cite sources]]`, so Obsidian resolves it whatever other documents are named.

| `type` | What it is |
| --- | --- |
| `module` | One note for each enabled module. A vault module's document also defines the module. |
| `template` | One kind of session of a vault module, in `internal/<id>/templates/`. |
| `session` | The session document. Core fields, plus the module's own fields. |
| `policy` | Rules that a session must follow. The body is the rule text. |
| `promise` | A deliverable: what, where, and how Yami checks it. |
| `skill` | A skill in the standard `SKILL.md` form. |
| `conversation` | A conversation with an agent: the messages, the replies, and the tool calls. |
| `topic` | A note the wiki maintains about one subject, with its claims cited to sources. In `wiki/topics/`. |
| `source` | A note that stands for one original the wiki learned from, and links or embeds it. In `wiki/sources/`. |
| `change` | One plan of creates, modifies, and removes over the knowledge base, and what happened to it. In `internal/wiki/changes/`. |
| `snapshot` | One version of the knowledge base, with a gzip archive of every note beside it. In `internal/wiki/snapshots/`. |
| article | Any note. Its content becomes context for the agent. |

A module's documents are installed into the vault, so users can read and edit them. The layout of a module with the id `notes`:

```
Yami.base                        vault ledger: every module, and every session grouped by module
notes/                           the sessions, one document each
  weekly.md
internal/notes/                  what the module needs, out of the way of the sessions
  notes.md                       type: module
  sessions.base                  module ledger: the sessions of this module
  templates/                     a vault module's template documents (a code module has none)
  policies/Cite sources.md
  promises/Summary written.md
  skills/summarize/SKILL.md
internal/yami/skills/run/SKILL.md   the base Yami skill, which every run invokes as /yami:run
conversations/
  notes weekly.md                the conversation note that records the runs of the session
  notes weekly review.md         the conversation note of a review
```

The ledgers are Obsidian bases: live views over the properties of the session documents. Yami writes each base once, and keeps the properties of the session documents current.

## `yami/document`

`Vault` is the host's access to the vault: `read`, `write`, `exists`, `list`, and the parsing and writing of properties. `ObsidianVault` in `yami/obsidian` implements it over the Obsidian API, and tests implement it over the file system.

`readDocument`, `writeDocument`, and `updateDocument` handle a document as `{ path, properties, body }`. Properties that do not parse throw a `PropertiesError`, which names the document and gives the parser's reason. `replaceSection` replaces one `## heading` section of a body. `link`, `linkTarget`, `linksOf`, and `resolveLink` handle `[[links]]` in properties.

The schemas of the built-in types are `MODULE`, `TEMPLATE`, `SESSION`, `POLICY`, and `PROMISE`. `validate` returns one message for each field that does not match, and `withDefaults` fills in defaults. A module adds its own session fields in the same `Schema` form. A field's type is `text`, `number`, `boolean`, `date`, `list`, `link`, `links`, or `map` (names with values).

`vaultLedger` and `moduleLedger` return the text of the two bases.

## `yami/conversation`

A conversation note has `type: conversation`, the `agent`, the `model`, `effort`, and `approval` in use, the harness `session` for resuming, a `status` of `active` or `ended`, and `module`, a link to the module session that the conversation runs, when it runs one. The body is Markdown:

- A user message is a `> [!user]` callout.
- The agent's thinking and tool calls between pieces of text go into one collapsed `> [!activity]-` callout, with a summary as its title, for example "Thought for 6s · Read 2 files".
- The agent's text is plain Markdown.

`newConversation` writes the properties, `userBlock` the user callout, and `renderTurn` a turn. `TurnTranscript` folds the events of an agent session into the view that `renderTurn` takes. While a turn runs, `renderTurn` only appends, so a host can type the text out. `nameFrom(message)` names a note after its first message.

## `yami`: modules and sessions

### A module

A module is a subclass of `YamiModule`. Its fields declare it, and builders in its field initializers make its parts:

| Field | What it sets |
| --- | --- |
| `id`, `name`, `description` | The module's folder name and tool prefix (lower-case letters, digits, and dashes), and what it is. |
| `schema` | The module's own session fields, as a `Schema`. Annotate it, `readonly schema: Schema = {…}`, so TypeScript checks the field types. |
| `sessionsIn` | Where the session documents go: `folder` (`<id>/`, the default), `internal` (`internal/<id>/sessions/`, when the module's folder holds its output, as the wiki's does), or `none` (no sessions, and no ledger). |
| `ledgerIn` | Where the module ledger goes: `internal` (the default) or `folder`. |
| `ledgerViews` | Tables that the module adds to its ledger. |
| `instructions` | Text added to the first prompt of each run. |
| `checks` | Checks that the module's promises can name, ahead of the core checks of the same name. A check gets the vault, the wiki, the session's `path`, and its properties. |
| `color` | The color of the module's folder, as a hex code such as `#3e63dd`. Without one, the module takes a color of `MODULE_COLORS` chosen by its id, the same on every start, and one that no other module has while one is free. `module.colors` gives the folder's color and the internal folder's, which is the color muted halfway toward the gray of `internal/` (`mute`). The wiki is cyan, `WIKI_COLOR`. |
| `icon` | The name of the module's icon in the host's icon set: in Obsidian, a Lucide icon such as `book-open`, or one that the plugin adds with `addIcon` before `createYami`. Default `MODULE_ICON`, `box`. The wiki is `book-open`. |

| Builder | Makes |
| --- | --- |
| `this.skill(markdown, files?)` | A skill in the standard `SKILL.md` form. The frontmatter holds its `name` and `description`. `files` go beside `SKILL.md`, such as the briefs of its workers. `this.skill({ name, description, body, files })` makes one from its parts. |
| `this.policy(name, markdown, properties?)` | A policy. |
| `this.promise(name, markdown, properties?)` | A promise. Its `check`, and the properties the check reads, go in the frontmatter or in `properties`. |
| `this.article(name, markdown, properties?)` | An article. |
| `this.agent(markdown)` | A Claude Code subagent of the module's skill set, invoked as `<module id>:<name>`, with its `name`, `description`, and `tools` in the frontmatter. Claude Code enforces its tool list, so an agent with no edit tool cannot change a file. Codex has no subagents. |
| `this.template(options)` | A kind of session: `id`, `name`, the `skills`, `policies`, `promises`, and `articles` that a new session links, `maxIterations` (default 3), `access` (`read-only`: the agent changes no file except through the tools), `instructions`, the `fields` and the `body` of a new session, and `command: false` when the host offers no command to create one. |
| `this.action(options)` | An act of the person that a host offers as a command named `<module name>: <action name>`: on the session open in the editor (`on`, a template, and `when`, a test of its properties), on one of several things the person picks (`choose`), or with no input. `run` returns a message, or `{ message, open }`. |

`module.hasSkills` says whether the module's internal folder holds skills, so that Yami gives it to the agents as a skill set.

`tools()` returns the module's tools, made with `defineTool({ name, description, input: { text: z.string() }, readOnly, title, run })`. The agent sees a tool as `<module id>_<tool name>`, with each dash of the id as an underscore: `code-review` and `post_comment` give `code_review_post_comment`. Set `readOnly: true` on a tool that changes nothing, no file and no state of the host, so that a reviewer gets it too; a tool without it is one that can change things, and a review does not get it. Once the module is added to a Yami, `this.yami`, `this.vault`, `this.wiki`, and `this.layout` are available to its tools, checks, and actions.

A module writes its files when the Yami enables it, and only the files that do not exist, so edits in the vault stay. The template's documents go under `internal/<id>/`: `policies/`, `promises/`, `articles/`, `skills/<name>/SKILL.md`, and `agents/`. A template's `skills`, `policies`, `promises`, and `articles` take any `DocumentRef`, `{ kind, name, path, link }`, of which `ModuleDocument` is one.

### Vault modules

A person can define a module in the vault with markdown only, and no code. A vault module is the folder `internal/<id>/`:

```
internal/code-review/
  code-review.md                 the module document: type: module
  templates/Review a change.md   a template document: type: template, one for each kind of session
  skills/review/SKILL.md         the documents that the templates link, in the folders a code module uses
  policies/Be kind.md
  promises/Report written.md
  articles/, agents/
  sessions.base                  the module ledger, which Yami writes
code-review/                     the sessions, as for a code module
```

The folder's name is the module's id: lower-case letters, digits, and dashes. `yami` is Yami's own id. A folder is a vault module when it has the module document and at least one document in `templates/`, and no code module has its id. A module document that a code module left behind, with no templates, is not a module.

The module document's properties, none required:

| Property | What it sets | Default |
| --- | --- | --- |
| `name` | The module's name. | the id |
| `description` | What the module is. | none |
| `icon` | The module's icon, as for a code module. | `box` |
| `color` | The color of the module's folder, as a hex code. | a basic color by the id |
| `instructions` | Text added to the first prompt of each run. | none |

The body of the module document is for a person. A template document holds every option of a code module's `this.template`:

| Property | What it sets | Default |
| --- | --- | --- |
| `type` | `template`. Required. | |
| `name` | The template's name. Its command says "New" and the name. | the file's name |
| `description` | What the template is for. | none |
| `skills`, `policies`, `promises`, `articles` | The documents that a new session links, as `[[links]]` or names. The first skill loads first. | none |
| `maxIterations` | Agent turns in one run: a whole number of 1 or more. | 3 |
| `access` | `edit`, or `read-only`: the agent changes no file except through the tools. | `edit` |
| `instructions` | Text added to the first prompt of a run, after the module's. | none |
| `fields` | The session fields of a new session, each with its default: `fields: { change: "", rounds: 1 }`. A field's type is the type of its default. | none |
| `command` | `false` when the host offers no command that creates a session. | `true` |

The body of the template document is the body of a new session, before its Deliverables and Progress: for example a section for the person to fill in.

- **The template's id** comes from its file name: lower case, with accents left out, and each run of other characters than letters and digits as one dash. `templates/Review a change.md` is `review-a-change`. `idFromName(name)` applies the rule. A session records the id in its `template` property, so a renamed template document leaves its sessions with no template, and they fail to run with a clear error.
- **A link** resolves as a session's links do: by its path, or by its name, first in the module's folder for its kind, then the module's internal folder, then the whole vault. A skill is found by its folder's name in the module's `skills/`. A link to a document of another module works.
- **The module's session fields** are the fields of all its templates. The first template, by file name, sets a field's type.

`yami.discover()` reads the vault modules, and `yami.enable()` calls it. `createYami` calls it a moment after a module document, a template document, or the base skill changes, or a file is created, renamed, or removed, so a person sees a change within a second, with no reload. A vault module is a `VaultModule`, a subclass of `YamiModule`, so a host uses it through the API of any module: the module list, its templates, its sessions and summaries, its acts, its colors, its icon, and its ledger. `module instanceof VaultModule` says that a module came from the vault, and `module.document` is its module document. A vault module has no tools, checks, or actions of its own: its sessions get every tool that Yami serves and the core checks, and the review judges what code cannot check.

| Call | What it does |
| --- | --- |
| `yami.discover()` | Writes the base skill when it is missing or holds a text that an earlier Yami shipped (see [The Yami](#the-yami)). Reads the vault modules again, and updates `yami.modules` and `yami.problems`. A module whose documents did not change keeps its object. A new module gets its ledger, and the agents get the skill sets as they are now. A live run keeps the module and the template it started with. Calls run one after another. |
| `yami.problems` | What a person must fix or know, from the last `discover`: each `ModuleProblem` has the `module` id, the `path` of its document or folder, the `document` with the problem when one holds it (a view can open it; none for a problem of the folder: its name, or a missing module document), and a `message` that says how to fix it. A problem of a vault module keeps out what it names. A problem of the module `yami`, at `BASE_SKILL`, says that the base skill holds a person's edits and not the text of this version. |
| `yami.onModulesChange(listener)` | Calls the listener when a `discover` finds a vault module or a template that is new, changed, or gone, or a problem that is new or fixed. Returns the function that stops it. |
| `yami.createModule(name)` | Writes a starter vault module, `internal/<idFromName(name)>/`: the module document `<id>.md`; the template `templates/Task.md`; the skill `skills/task/SKILL.md`; the policy `policies/Stay in scope.md`; and the promise `promises/Result note.md`, with the `exists` check on `<id>/{{session}}/Result.md`. Then it discovers, and returns the new module. A session from the starter runs to `done` when the agent writes its result note and the review finds the policy followed. It refuses a name that gives no id, `yami`, and an id that a module or a folder of `internal/` has. |

These problems never stop Yami, another module, or a valid template of the same module. Each is in `yami.problems`, and keeps out what it names:

| Problem | What stays out |
| --- | --- |
| A module document or a template document whose properties do not parse | the module, or the template |
| A module document that is missing, or has no `type: module` | the module |
| A folder name that is no valid id, `yami`, or the id of a code module | the module (the code module wins) |
| A template document with no `type: template`, a bad value (`access: readonly`, `maxIterations: 0`, a `name` that is no text), a field that is a core session field or has another type in another template, or a file name that gives no id or the id of another template | the template |
| A template's link to nothing | the template, until the document is there |
| A `color` that is no hex code, or a module property that is not text | only that value, which takes its default |
| A base skill that a person edited (module `yami`) | nothing: every run uses the edited skill |

```ts
await yami.enable();                          // installs the code modules and the base skill, then discovers
yami.onModulesChange(() => render(yami.modules, yami.problems));
const review = yami.module("code-review")!;   // a VaultModule
const session = await review.templates[0]!.create({ name: "PR 12", fields: { change: "PR 12" } });
```

### Sessions

`template.create({ name, exact, fields, add })` writes a session document and returns its `Session`. The document links the template's documents and those in `add`, such as a policy of another module, and holds the template's `fields` and `fields`. Its name defaults to the template's name and the time. A name that a file cannot take is made safe, and a name in use gets " (2)"; `exact: true` refuses either instead.

`yami.session(path)` gives the handle of any session document. The same path gives the same handle.

| `Session` | What it does |
| --- | --- |
| `start({ agent?, maxIterations? })` | Runs the agent loop in a new conversation. `agent` is an agent or a harness name; the default is the Yami's first agent. Resolves with a `RunResult`, `{ path, state, iterations, conversation, review, reason }`: `review` is the conversation note of the run's last review, when it had one, and `reason` says why a run ended `failed` or `needs-attention`, as the last Progress line without its time, such as `iteration 1: turn failed: boom`, `iteration 1: review failed: …`, `iteration 3: 0 met, 1 unmet`, `iteration 1: 0 met, 0 unmet, 1 for review: Approved — ask the user: the budget is used`, or `iteration 1: review: 0 followed, 0 broken; no verdict on Be kind`. A promise for review comes with its check's reason, so the reason says what the person must decide. A fault of Yami's own code gives the error's kind, its message, and where it was thrown: `failed: TypeError: … (at runSession (run.js:12:5))`. Other states have no `reason`. An act's message ends with it. |
| `resume(options?)` | Checks the promises. When they are met, it reviews the session if the session has something to review, and ends `done` with no worker turn when the review passes. Otherwise it continues the session's conversation, with the agent that the conversation names, so the agent keeps what it did, and sends the feedback. When the harness no longer has that session, the agent starts a new one in the same note and gets the whole context with the feedback. A session with no conversation starts. A resume refuses another agent than the conversation's. |
| `stop()` | Interrupts the turn, the worker's or the reviewer's. The run ends `stopped`. |
| `kill()` | Closes the harness session of the live turn at once, without waiting for the turn to stop. The run ends `stopped`. |
| `status()` | `working`, `checking`, or `reviewing` while a run is live in this Yami; otherwise the state the document records: `open`, `done`, `needs-attention`, `failed`, or `stopped`. A document that says `running` with no live run reads as `stopped`. |
| `check()` | Runs the checks of the session's promises now, and records nothing: `{ checks, judged }`, where each check has the `promise` path, its `name`, its `status`, and the `detail`, and `judged` lists the promises with no check, for the review. The self-check tool returns the same. |
| `on(listener)` | Calls the listener at each change of status. `yami.onSession(listener)` does the same for every session. |
| `read()`, `module()`, `template()` | The document, its module, and its template. |

`yami.running` lists the sessions with a live run, and `yami.sessions(module or template?)` the session documents of the vault.

### What a view reads

A view of the sessions, such as a panel, gets its data and its acts here, and holds no rules of its own:

| Call | Gives |
| --- | --- |
| `yami.summaries(module or template?)` | Each session at a glance, newest first by `created`, from one read of each document: `name`, `module`, `template`, `status`, `created`, `iteration`, `met` and `unmet` (counts at the last check), and the `properties`. A document whose template the module lacks shows with no template; one whose properties do not parse, as in the middle of an edit, is left out until they do. |
| `session.details()` | The summary, and `documents`: each linked promise, policy, skill, and article with the `path` it resolves to (none for a link that finds no note); for a promise whether the last check or review `met` it, and whether it is `judged` (it has no check, so the review judges it); for a policy whether the last review found it `followed`; and for both the `reason`, as the session document shows it (the check's detail, `review: <reason>`, or `the review judges it` for a promise; the reviewer's reason for a policy; undefined before any); the `conversation` note; the `review`, the conversation note of the last review; the `harness`; and the `progress` lines, each with its `time`. |
| `session.acts(properties)` | What a person can do with the session now, from its properties as read: `start` with each agent, `resume` when it has a conversation, `stop` and `kill` while a run is live (whatever the document says), and each module action on its template whose `when` holds. An act has a `label`, such as "Run with Claude", and `run()`, which resolves with what to tell the person, such as `PR 12: done after 1 iteration.`, or `PR 12: failed after 1 iteration: iteration 1: turn failed: boom` with the run's `reason`. The commands use it too. |
| `module.acts()` | What a person can do with a module itself: `new` from each template that offers a command (its `label` is the template's), then each `action` on no session. `runModuleAct(act)` in `yami/obsidian` does one. |
| `STATUS_LABELS` | The words for each status: "Not started", "Working", "Checking", "Reviewing", "Done", "Needs attention", "Failed", "Stopped". |
| `yami.modules`, `yami.problems`, `yami.onModulesChange(listener)` | The modules with the vault modules, what keeps a vault module or a template out, and a call when either changes. See [Vault modules](#vault-modules). |
| `yami.onSessionsChange(listener)` | In Obsidian, one feed for a view of the modules and the sessions: a call after a session document or a module's document changes, a run changes its status, or a discovery changes `modules` or `problems`. A view that subscribes to it needs no `onModulesChange`. |
| `template.label` | What a button or a command that creates a session says: "New checkout". |
| `LINKED_KINDS` | The fields that link documents, in the order a person reads them: promises, policies, skills, articles. |
| `yami.agentName(agent)` | The name of an agent in acts: its harness, with a number after the first agent of a harness; in Obsidian, the name it is registered under. |

### The agent loop

Each iteration is one agent turn, one verification, and a review when the checks pass.

1. **Context.** The first prompt invokes the base skill, `/yami:run`, which says how every session runs: read the session document, load its skills, follow every policy, deliver every promise, check the work with `yami_check` before the turn ends, and expect a review. The prompt holds only what is particular to the session: its name and path, the instructions of the module and the template, the session properties, the session document's body, and the content of every linked policy, promise, and article. A linked skill goes by its command when the agent has its module's skill set: the prompt lists the session's skills, and the base skill tells the agent to load the first one now and the others when needed. A skill the agent does not have is inlined, and so is the base skill for an agent that does not have Yami's skill set.
2. **Action.** One turn on a harness session with `accept-edits` approval, the template's access, and the vault as the working directory. The agent can call `yami_check` to run the checks itself before it ends the turn.
3. **Verification.** Yami reads the session document again, since the agent's tools can change its properties, and runs the `check` of each promise that has one. It updates `met`, `unmet`, the Deliverables checklist, and the Progress section of the session document. If a promise is unmet, the next prompt says which, and why.
4. **Review.** When every check is met, and the session links a policy or a promise with no `check`, Yami opens a new conversation with the same agent, read-only, and the status is `reviewing`. The reviewer gets the session document, the policies, the promises to judge, the names of those items as the only ones to judge, the worker's last message, and the run's conversation note, which records every tool call. It gives each policy the verdict `followed` or `broken`, and each promise `met` or `unmet`, each with a reason, and records them with `yami_review`. The reviewer changes nothing: its access is read-only, and its tools are only those whose `readOnly` is true, with its own `yami_review`, which no other agent has and which refuses once the review ends. A broken policy or an unmet promise goes back to the worker as the next prompt, the same as an unmet check. The session document records the verdicts: `followed` and `broken` list the policies, `met` and `unmet` include the judged promises, the Review section gives each verdict with its reason, and `review` links the review's conversation note.

The exchange goes to a conversation note in `conversations/`, linked from the session document as `conversation`, with the session document linked back as `module`. The note records the prompts, the agent's replies, and its tool calls, and a person can continue it after the run. Each review is a note of its own, `<module> <session> review`.

The session ends `done` when every check is met and the review finds every policy followed and every promise met, or when it has nothing to review. It ends `needs-attention` when the iterations run out, when a check returns `review` (for example an unknown check name; no review follows), or when the reviewer gives no verdict on an item. It ends `failed` when the harness ends a turn with an error, the worker's or the reviewer's, or when Yami's own code throws, also during the review; and `stopped` when the person stops the run or interrupts its turn, also during the review. A fault of the code is `failed`, not `needs-attention`: `needs-attention` means that the work waits for a person's judgment, and a fault says nothing about the work. Its `reason` names the place of the fault, for a bug report. A later run continues the iteration count. A session with no policy and no promise without a check runs with no review.

### The Yami

`new Yami({ vault, agents, modules, wiki, conversations, conversationFolder })` is the runtime of one vault. In Obsidian, `createYami` builds it. The wiki module is built in and comes first in `yami.modules`, then the plugin's modules, then the vault modules.

- It sets each agent's working directory to the vault, and gives it `yami.tools()`, one tool set named `yami` with Yami's own tools and the tools of every module, and `yami.skills()`, Yami's skill set `internal/yami` with the base skill, and each module's internal folder that holds skills.
- Yami's own tools: `yami_check({ session })`, which every agent gets, runs the checks of a session's promises and returns `session.check()`, with no record in the document. `yami_review({ verdicts })` is only in the tool set of one review's conversation, bound to that review: it records the reviewer's verdicts, and refuses a verdict of the wrong kind, an item of no review, and any call after the review ends. It returns `{ recorded, errors, remaining }`; called with no `verdicts`, `yami_review({})`, it shows what is left to judge.
- `yami.wiki` is the vault's one `Wiki`. The conversation folder stays out of its index.
- `yami.enable()` installs every code module and the base skill, then discovers the vault modules. A host calls it on every start. The base skill, `BASE_SKILL`, is `internal/yami/skills/run/SKILL.md`, so a person can read and edit it. At each `discover`, Yami writes `BASE_SKILL_TEXT` there when no file is at the path, or when the file holds a text that an earlier version of Yami shipped, since then the person never edited it. A file with any other text holds a person's edits: Yami keeps it, and `yami.problems` reports it with the module `yami`. To get the new text, delete the file; the next `discover` writes it again.
- `yami.discover()`, `yami.problems`, `yami.onModulesChange(listener)`, and `yami.createModule(name)`: the vault modules. See [Vault modules](#vault-modules).
- `yami.ingest({ files | folder, name?, policies? })` captures files as sources of the wiki and creates an ingest session that links them, with the policies on top of the wiki's own.
- `conversations` decides how the conversation notes of runs are kept. The default writes them straight to the vault and denies every approval; `createYami` gives notes with the message box, so a person can watch a run and answer its approvals. A `Conversations` of a host's own must start the agent's sessions with `OpenConversation.tools` when the run gives them, in place of the agent's tools: the review relies on it.
- `yami.close()` kills every live run and closes every agent session.

### Promises and checks

A promise names a `check` and gives it properties. `{{session}}` in a value is the session name, and `{{field}}` is a session property.

| `check` | Properties | Met when |
| --- | --- | --- |
| `exists` | `path` | The file exists. |
| `contains` | `path`, `text` | The file exists and contains the text. |
| `property` | `field`, `name`, `value`, `atLeast` | Every note linked in the session's `field` has the property `name` equal to `value`, and the field links at least `atLeast` notes (default 0). It reads the notes from the vault, so a note the index leaves out, such as a change, counts too. |
| `lint` | `path`, or `folder`, or `field` | The wiki's lint finds no error in the note, the folder, or the notes linked in the session's `field` and every note that links them. |
| none | | Never by Yami. The review judges the promise after the checks pass. |

A check that returns `review`, such as an unknown check name, ends the session `needs-attention` for a person to decide. A module adds checks in its `checks`. The wiki reads the vault again before the checks run, so they see what the agent wrote. A check that throws, for example on a linked note whose properties do not parse, leaves its promise unmet with the reason, and the agent hears it in the next prompt.

## `yami/wiki`

The knowledge base. One `Wiki` for the vault, `yami.wiki`, which every module's tools and the checks use. It is plain TypeScript over the `Vault` interface: no agent, no Obsidian.

```ts
import { Wiki, VoyageEmbedder } from "yami/wiki";

const wiki = new Wiki(vault, { exclude: ["conversations"], embedder: new VoyageEmbedder({ apiKey }) });
await wiki.refresh();                                                              // reads every note
await wiki.rebuild();                                                              // reads every note: { notes, links, communities, ms }
await wiki.search("how does codex interrupt a turn", { algorithm: "ppr", limit: 10, types: ["topic"], tags: ["yami"] });
await wiki.search("", { seeds: ["agent/codex.md"], algorithm: "ppr" });            // related notes, no text
await wiki.match(["Self-supervised learning", "SSL"]);                              // hit | near | new, each with neighbors
await wiki.lint({ folder: "wiki/topics" });                                         // findings with a fix each
wiki.note("wiki/topics/Interrupt.md");                                              // links, backlinks, tags, chunks
wiki.graph;                                                                         // the graphology Graph
await wiki.change({ title, notes, session, writes: [{ op: "create", path, properties, body, why }] });
await wiki.captured();                                                              // is the knowledge base at its latest version?
await wiki.snapshot();                                                              // the next version
await wiki.versions();                                                              // every version, oldest first
await wiki.restore(3);                                                              // version 3 back, as a new version
```

- **The index holds every note** of the vault, except the folders in `exclude`, the types in `skipTypes` (conversation, session, module, change, and snapshot by default), and the files of module skills. Links resolve as Obsidian resolves them, over every note, indexed or not: by path, or by name, and a name that several notes share goes to the shortest path. `locate(target)` gives that note; `resolve(target)` gives it only when the index holds it. A link to a note the index leaves out, such as a session, is not dead, and it is not an edge of the graph. A note holds a tag and every tag above it, so `tags: ["school"]` finds a note tagged `school/cs513`.
- **`refresh()` reads the vault again.** About 500 notes take a quarter of a second. The tools and the checks call it, so they see the agent's writes. The embeddings are the one cache, keyed by the hash of each chunk, in `internal/wiki/cache/embeddings.json`; a refresh embeds only new chunks.
- **A hit** has the `path`, a `score` in `[0, 1]` with the best at 1, a `snippet`, and `why`: "title match", "linked from Codex harness", "in the community of Claude harness", or the chunk that matched.
- **The tag hierarchy** is by the tags' names: `ml/vision` is below `ml`. `wiki.neighbors(note)` gives the note's own tags, the tags above them (the top first), and the tags one level below them, each with the count of notes that hold it or a tag below it. `wiki.tag(tag)` gives the tags above a tag, the tags one level below it, and the notes that hold it themselves, by name; `wiki.tag()` gives the top, each tag with no `/`. Both are async, and read the vault again first when the index is stale. `wiki.tags()` lists every tag with its count. `wiki.holds(path, properties)` says whether the index holds a note: the rule of its refresh, which a change feed can use. A note's `ownTags` are the tags its `tags` property holds, and `tags` adds every tag above them. Tags are lower case, without `#` or empty parts, so `#ML//Vision/` is `ml/vision`. The index builds the hierarchy at each refresh, and stores nothing.
- **`match`** compares names with the names, aliases, and descriptions of the typed notes: `hit` when a note holds the name or an alias, `near` when one scores above the threshold, `new` otherwise, each with its neighbors. The ingest skill calls it before it writes a topic.
- **`lint`** reports `bad-properties`, `dead-link`, and `no-description` as errors, and `duplicate-name`, `no-sources`, `uncited`, and `orphan` as warnings. An error fails the `lint` check. A note whose properties do not parse, such as a value with `: ` and no quotes, stays in the index with its body and no properties, and `bad-properties` names it with the parser's reason.
- **`captureSource(vault, file)`** captures a file as a source. The file stays where it is. Yami copies it into `internal/wiki/originals/`, named by the first 16 hex characters of its SHA-256, and writes `wiki/sources/<name> (source).md` with `type: source`, `status: pending`, `file` (the copy, which the note embeds), `from` (the file), and `sha256`. The wiki reads and cites the copy, so a later edit of the file does not change what the source said, and the source note never shares a name with the file. A file whose latest source holds its content returns that source; a changed file gets a new one, `<name> (source 2).md`, also when it changed back to an older text. A file with no source of its own shares the source of any file with the same content. `readSources(vault)` reads the sources once for many captures, and `sourceOf(sources, file, sha256)` says which source holds a file's content, if any. **`captureSources(vault, folder)`** does it for every file in a folder, and skips the wiki's own files. **`sourceChunks(vault, wiki, source)`** takes a source note, or the file a source was captured from, and splits the frozen copy for the workers of an ingest: a text file into runs of at most 800 lines cut at a heading or a blank line, a PDF into 20 pages at a time, any other file whole.

### Changes and versions

The knowledge base, `wiki/topics/` and `wiki/sources/`, changes only through a change plan, and every change has a version before and after it.

```ts
const result = await wiki.change({
  title: "Ingest the DINOv2 paper",
  notes: "What the change does, the coverage, and each skipped subject.",
  session: "internal/wiki/sessions/Ingest DINOv2 2026-10-15.md",
  writes: [
    { op: "create", path: "wiki/topics/Self-supervised learning.md", properties: { description: "…", tags: ["ml"], sources: ["[[wiki/sources/DINOv2|DINOv2]]"] }, body: "## Definition\n…", why: "the paper's method; no topic explains it" },
    { op: "modify", path: "wiki/sources/DINOv2.md", properties: { status: "absorbed", tags: null }, body: "…", why: "absorbed" },
    { op: "remove", path: "wiki/topics/Old idea.md", why: "merged into Self-supervised learning" },
  ],
});
// { path: "internal/wiki/changes/2026-10-15 1432 Ingest the DINOv2 paper.md", before: 3, after: 4, creates: 1, modifies: 1, removes: 1, warnings: [] }
```

`change()` runs as one step, and changes from several agents run one after another:

1. It reads the vault again and validates the plan: every path under the knowledge folders, a title, at most 100 writes, no path twice; a create at a free path with a description and a body, its properties valid for the folder's type; a modify of a note that exists, valid after the merge, where `null` removes a property and a body replaces the body; a remove of a note that exists. An invalid plan throws `InvalidPlan` with one line per problem, and nothing changes. A link in new content that resolves to no note is a warning, not a refusal.
2. It snapshots the knowledge base when its state is not captured, so a person's hand edits are in a version before the change touches them.
3. It writes the change document, `status: applying`, with a Summary (one line per write with its `why`), the Notes, and every write in full.
4. It applies the writes. A write that fails puts every note back from the version before, marks the change `failed` with the error, and throws.
5. It snapshots again; the new version links the change. The change document gets `status: applied`, `before`, and `after`, and the session document's `changes` field gets the link.

A **snapshot** is `internal/wiki/snapshots/v<N>.md`, which the module ledger lists, and `v<N>.json.gz` beside it: every note of the knowledge base by path, gzipped. The document holds `version`, `created`, `hash`, `notes`, `archive`, `change`, and `restored`, and its body names the notes added, changed, and removed since the version before. `captured()` compares the hash of the knowledge base now with the latest snapshot's. `restore(n)` snapshots the current state when it is not captured, writes version n back (notes the version lacks are removed), and records the result as a new version with `restored: n`, so the versions stay one line in time.

### The algorithms

Every algorithm is one function in `algorithms`, with the same query and scores in `[0, 1]`. A query names one with `algorithm`; `defaultAlgorithm` in the options sets the default, `bm25` until the benchmark says otherwise.

| Algorithm | How it ranks |
| --- | --- |
| `bm25` | BM25F over the title, aliases, tags, description, and body. The baseline, and the seed step of the next three. |
| `ppr` | Personalized PageRank over the link graph, restarting at the best lexical hits and the query's `seeds`. Power iteration by default; `params: { walks: 20000 }` runs Monte Carlo walks instead. |
| `hop2` | Two hops from the twelve best seeds, the score cut by 0.6 each hop, with four signals: the note's own score, the inherited score, the tags it shares with the seeds, and its backlinks. |
| `louvain` | Louvain communities over the graph, computed at refresh. The seeds weight their communities, and every member ranks half by its own score and half by its community. |
| `hybrid` | BM25 over chunks and cosine over chunk embeddings, fused with reciprocal rank fusion, rolled up to notes by their best chunk. Without an embedder, the lexical half alone. |

`VoyageEmbedder` embeds with Voyage AI over `fetch`; Anthropic has no embeddings endpoint. Any `Embedder` with `id` and `embed(texts, kind)` works, and the tests use a fake one.

### The benchmark

`npm run bench` ranks the queries of a gold file with every algorithm against a real vault and prints recall at 5 and 10, mean reciprocal rank, misses, and the time for each query:

```sh
YAMI_BENCH_VAULT=~/Vaults/Notes YAMI_BENCH_GOLD=bench/gold.json npm run bench
YAMI_BENCH_VAULT=~/Vaults/Notes VOYAGE_API_KEY=… npm run bench            # hybrid with embeddings
```

The gold file is a list of `{ "query", "expected": ["path or [[name]]"] }`; `bench/gold.example.json` shows the form. Without one, the benchmark asks for sampled notes by their description, which favors the lexical algorithms and only shows that each one runs. `YAMI_BENCH_EXCLUDE` names folders to skip, `conversations` by default.

## The wiki module

The one module built into Yami. Its folder, `wiki/`, holds the knowledge base, `wiki/topics/` and `wiki/sources/`, for a person to read. Its sessions, ledger, changes, versions, and cache are under `internal/wiki/`.

- Its `ingest` template makes a session whose `sources` field links the source notes to absorb, and whose `changes` field links the changes it applied. `yami.ingest` captures the files and creates the session; the commands **Wiki: ingest this file** and **Wiki: ingest a folder** call it.
- Ingest sessions run with `access: "read-only"`: the agent reads anything and changes nothing except through `wiki_change`. Its policies: cite every claim, change the wiki through one plan, one subject one topic. Its promises: `Change applied` (at least one applied change), `Sources absorbed` (each source has `status: absorbed`), and `Clean topics` (`lint` over the sources and the topics that cite them).
- Its skill, `/wiki:ingest`, is a map-reduce: `wiki_chunks` for each source, one worker per chunk that reads `extractor.md` (an Item Map of subjects and cited claims), `wiki_match` for every subject at once, one worker per slice that reads `drafter.md` (the writes), then one plan for `wiki_change`. `page-forms.md` gives the topic and source forms. The three files sit in the skill's folder, and the lead gives each worker a path, not the text. A long document or a folder of documents costs the same care as one.
- Its tools, for every agent in the vault: `wiki_search`, `wiki_match`, `wiki_lint`, `wiki_tags`, `wiki_neighbors` (a note's or a tag's place in the tag hierarchy, so an agent can walk a large wiki by subject), `wiki_chunks`, and `wiki_change`. Each but `wiki_change` is `readOnly`, so a reviewer has it. The search tool's description carries the citation procedure, so a plain conversation answers from the wiki without a skill. "Ask the wiki" needs no wiki code: start a conversation with the question.
- Its ledger, `internal/wiki/sessions.base`, has the session tables and two more: `Versions`, each with its link to the change, and `Changes`.

## `yami/agent`

The agent module starts a harness, Claude Code or Codex, and runs a conversation with it. The session contract and the adapters came from [Duet](https://github.com/nathanaday/obsidian-duet). A harness session is not a Yami session: it is one conversation with the harness, and a run of a Yami session uses one.

```ts
import { ClaudeAgent } from "yami/agent/claude";
import { CodexAgent } from "yami/agent/codex";

const agent = new ClaudeAgent({ preferences: { cwd: "/path/to/vault", approval: "accept-edits" } });
// or: new CodexAgent({ preferences: { cwd: "/path/to/vault" } })

await agent.connect();
// { harness: "claude", version: "2.1.299", account: { login, email, organization, subscription } }

const session = await agent.startSession({
  resume: savedId,                                   // continue an earlier session
  onPermission: async (request) => "allow",          // or "allow-session", or "deny"
  onQuestion: async ({ questions }) => answers,      // Claude Code's AskUserQuestion
  beforeFileChange: async (paths) => {},             // runs before the agent changes files
});
session.on((event) => console.log(event));
const result = await session.send("Which notes mention rice?");
// { status: "completed", text: "...", usage: { durationMs, inputTokens, outputTokens, costUsd } }
await session.configure({ model: "opus", effort: "high", approval: "auto" });
const models = await session.models();
const commands = await session.commands();           // slash commands and skills
```

Each harness has its own entry point, so a host bundles only the harness SDKs that it imports. `yami/agent` contains the base classes and the shared types.

### Parts

| Part | What it does |
| --- | --- |
| `Agent` | Base class. Holds the preferences of one harness. `startSession()` starts a harness process, and `closeAll()` stops each session that the agent started. |
| `AgentSession` | One conversation: `send`, `interrupt`, `close`, `on`, `models`, `commands`, `configure`, and `id` for `resume`. |
| `BaseSession` | The shared turn queue and event delivery. An adapter implements `startTurn`, `interruptTurn`, `close`, `models`, `commands`, and `configure`. |
| `ClaudeAgent`, `CodexAgent` | The harness adapters. |
| `AgentPreferences` | `cwd`, `model`, `effort`, `instructions`, `approval`, and `access`. |
| `AgentEvent` | `turn-start`, `text-delta`, `message`, `thinking-delta`, `thinking`, `tool-start`, `tool-end`, `turn-end`, and `closed`. |

Each adapter takes two kinds of settings:

| | Shared | Claude only | Codex only |
| --- | --- | --- | --- |
| Constructor options, fixed for the agent | `executable`, `env`, `preferences` | `settingSources`, `sdkOptions` | `config` |
| Preferences, can change for each session | `cwd`, `model`, `effort`, `instructions`, `approval`, `access` | `maxBudgetUsd` | `webSearch`, `networkAccess` |
| Session options | `resume`, `onPermission`, `onQuestion`, `tools`, `skills`, `beforeFileChange` | | |

### Turns

`send` queues the message, and the turn starts when the current turn ends. Each `send` resolves with one `TurnResult`, with status `completed`, `interrupted`, or `failed`. `interrupt()` stops the current turn, also right after `send`. `send` rejects only after `close()`, or when the harness process has stopped.

`usage.costUsd` is set only by Claude. Codex reports tokens but not cost.

### What a UI receives

The adapters normalize what they show, so a UI gets the same thing from both harnesses:

- `tool-start` has a `title`, a `detail` (a command, or a diff whose lines start with ` `, `-`, or `+`), and the `paths` that the tool reads or changes, relative to `cwd`.
- A permission request has the same `title` and `detail`, plus a `kind`: `read`, `edit`, `command`, `network`, `mcp`, or `other`.
- `thinking-delta` and `thinking` carry the model's reasoning summary.
- `models()` lists the models with their effort levels, and `commands()` lists slash commands and skills. For Codex, `send("/name request")` invokes the skill `name`.

### Approval and access

`approval` sets what the agent does without asking. Everything else goes to `onPermission`; without a handler, the session denies it.

| `approval` | Claude Code | Codex |
| --- | --- | --- |
| `ask` (default) | Asks before edits and commands. | Asks before every command. |
| `accept-edits` | Edits files without asking. Asks before commands. | Edits and runs commands inside its sandbox without asking. Asks for more, for example network access. |
| `plan` | Reads and plans. Changes nothing. | As `ask`. |
| `auto` | Claude Code decides which actions are safe. | As `ask`. |
| `sandbox` | As `ask`. | Works freely inside its sandbox: writes in `cwd`, no network. Asks for more. |

`access: "read-only"` is a hard limit: the agent can read files and search, cannot change files or run commands that change them, and never asks. It can still change things through `tools`.

- **`allow-session`** approves similar requests for the rest of the session. Claude applies the rule that Claude Code suggests, for this session only, never to the settings files. Codex remembers the approval for the same command or files.
- **Withdrawn requests.** When a turn ends or the session closes, the request's `signal` aborts, and the request counts as denied.
- Approvals go to the user, never to an automatic reviewer that a harness configuration can select.

### Skill sets

`skills` is a list of skill-set folders, as absolute paths. A skill set is a folder whose `skills/` holds one folder for each skill, with a `SKILL.md`; the set's name is its folder's name. Every skill is available to the agent, `commands()` lists each as `<set>:<skill>`, and a message that starts with `/<set>:<skill>` invokes one, with the rest of the message, also many lines, as its input.

```ts
const agent = new ClaudeAgent({ preferences: { cwd: vault, skills: ["/path/to/vault/internal/wiki"] } });
await session.send("/wiki:ingest Absorb the sources of this session.");
```

| | Claude Code | Codex |
| --- | --- | --- |
| How a set loads | A plugin of the session (`plugins`, without its MCP servers), named by the folder. | A list in the developer instructions: each skill's command, description, and `SKILL.md` path. |
| `/<set>:<skill>` | Claude Code puts the skill's instructions in the turn. | The adapter puts the skill's instructions and folder in the turn. |
| The model chooses a skill | The Skill tool. | The model reads the skill's files with a command. The adapter allows a command that only reads files in the skill folders (`cat`, `sed -n 'Np'`, `head`, `tail`, `nl`, `ls`, plainly quoted, no pipe or redirect) without asking. Any other command asks as usual. |
| Read-only sessions | The Skill tool and the Agent tool stay on. A subagent inherits the read-only tools, so it cannot write either. | The read-only sandbox applies. |

Codex also offers extra skill roots, but from one it reads a skill it chose with a command that asks for approval under `ask`, and it sometimes builds the path wrong; so the adapter lists the skills itself.

`setSkills(roots)` lists the skills of skill sets, `slashCommand(text)` splits a `/command`, `skillTurn(skill, message)` is the text that the Codex adapter sends for a skill, `skillList(skills)` its instructions, and `isSkillRead(command, folders, cwd)` its read rule.

### App tools

`tools` is a set of functions that run inside the app. The agent calls them like its own tools, without approval. Claude Code gets them as an in-process MCP server; Codex gets them as dynamic tools. Define one with `defineTool({ name, description, input: { text: z.string() }, title, run })`. `runTool` checks the input against `input` before `run`, for both harnesses: an invalid input returns an error result that names each problem, and a field set to `null` counts as left out. So `run` receives typed, valid input, and repeats none of the schema's checks. `title(input)` names a call in the `tool-start` event, and it also gets only a valid input: a harness reports a call before it checks the input, so `toolTitle(tool, input)`, which both adapters use, gives the tool's `name` for an input that the schema refuses and for a `title` that throws. An adapter of a host's own calls `runTool` and `toolTitle` the same way. `readOnly: true` says that a tool changes nothing, no file and no state of the host (a cache that the host can rebuild does not count), so a host can give a conversation only such tools. A session's own `tools` replace the agent's.

### Environment

GUI apps such as Obsidian start with a short `PATH`, so the hooks and MCP servers of your setup would not find commands such as `node`, `npx`, or `uvx`. Each harness process gets the `PATH` of your login shell first, then the `PATH` of the host process, then the standard install folders. The adapter reads the login shell `PATH` once for each process, with `$SHELL -ilc`, and waits up to 10 s. A `PATH` in the `env` option comes before all of these.

### Claude harness

The adapter uses the [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview), through its `core` entry.

- **One process for each session.** The session keeps one Claude Code process open and sends each prompt to it. `id` is known at once, and `resume` continues a session after a restart.
- **Interrupt.** Claude Code ignores an interrupt that arrives before it reads the message, so the adapter waits for the turn to start, then interrupts.
- **A new approval mode applies at once,** also to a request that waits for the user: the adapter sends that request back, and Claude Code checks the call again under the new mode.
- **A message that the adapter cannot read** is a fault of Yami, not of Claude Code. The turn ends `failed`, the session closes, and the error starts `Yami could not read a message of Claude Code:`, with the error's kind, its message, and where it was thrown.
- **Stall watchdog.** If a reply stops in the middle of a content block for 60 s, the session interrupts the turn, and the turn ends `failed`. If the CLI does not respond within 10 s more, the session closes with the error.
- **Your Claude Code setup applies.** By default the adapter loads the `user`, `project`, and `local` settings: `~/.claude`, and `.claude/` and `CLAUDE.md` in `cwd`. To load fewer, set `settingSources`. Without `user`, the session loads no MCP servers.
- **Sign-in.** The CLI uses your Claude Code sign-in. To use a different account, set `env: { CLAUDE_CONFIG_DIR: "/Users/you/.claude-work" }`, or set `ANTHROPIC_API_KEY`.
- **Executable.** The adapter runs the first `claude` CLI that it finds on `PATH`, in `~/.local/bin`, in `~/.claude/local`, in `/opt/homebrew/bin`, or in `/usr/local/bin`. If it finds no CLI, it uses the binary in the SDK package. That binary is not available in a bundled host such as the Obsidian plugin.
- **Bundling for an Electron renderer.** A host such as Obsidian needs four changes in its bundler. `pluginBuild` in `yami/esbuild` has all four.
  1. Define `import.meta.url`. The SDK calls `createRequire(import.meta.url)` on load, and a CJS bundle has no `import.meta`.
  2. Give the SDK a version of `events.setMaxListeners` that skips Chromium `AbortSignal` objects. In a renderer, the global `AbortController` is Chromium's, and Node rejects its signals.
  3. Give the SDK Node's timers. In a renderer, `setTimeout` is Chromium's and returns a number, and the SDK calls `.unref()` on the result when it stops a CLI process.
  4. Point the MCP SDK's validator at its interpreting validator. The default, ajv, compiles schemas with `new Function`, which Obsidian's review rejects.

### Codex harness

The adapter runs `codex app-server --stdio` and speaks its JSON-RPC protocol. `src/agent/codex-protocol.ts` has the parts that it uses, from Codex CLI 0.160.0. The protocol is experimental.

- **One thread for each session.** The session sends each prompt as a turn on the same thread. `id` is the thread id, and `resume` continues it.
- **Interrupt.** `turn/interrupt` ends a turn, but the commands of the turn keep running until their server stops. So `interrupt()` interrupts the turn, stops the server and its commands, and resumes the thread on a new server. A server first gets 2 s to exit after its stdin closes, then SIGINT, and then SIGKILL after 2 s more.
- **Approvals.** Command, file change, and permission requests go to `onPermission`, with the file diffs as the detail. Approvals go to the user, not to an automatic reviewer that a Codex configuration can select. An MCP confirmation without form fields also goes to the handler; forms and URL requests are declined. Codex has no questions like Claude's.
- **Your Codex setup applies.** The server loads `~/.codex/config.toml`, its MCP servers, plugins, and rules. `app-server` has no flag to ignore them. To change a setting, add a raw TOML entry to `config`, for example `config: ['web_search="live"']`.
- **Stalls.** Codex has its own stream idle timeout and retries, so the adapter has no watchdog.
- **Output.** The adapter removes terminal control sequences from each output line before it parses the line as JSON.
- **Sign-in.** The CLI uses your Codex sign-in. `connect()` reads the account through `account/read` and throws an error if you are not signed in. To use a different account, set `env: { CODEX_HOME: "/Users/you/.codex-work" }`.
- **Executable.** The adapter searches for `codex` in the same folders as the Claude adapter. The npm package installs a launcher script that needs Node on `PATH`, and Obsidian does not have Node on `PATH`. So for an npm install, the adapter runs the native binary in the package. To set the path, use `executable`.

## `yami/obsidian`

The Obsidian layer. It holds what needs the Obsidian API: `createYami`, the vault adapter, shared documents, conversation notes, the approval prompts, and the commands. Every Yami plugin uses it, so agents behave the same in all of them.

### `createYami`

`createYami(plugin, options)` builds an `ObsidianYami`, a `Yami` over the Obsidian API. Call it once, in `onload`.

| Option | Default | What it sets |
| --- | --- | --- |
| `agents` | | The plugin's agents, the first being the default. An entry `{ agent, name, color }` names an agent in the vault; the name defaults to the harness, and the color to `HARNESS_COLORS`. |
| `modules` | none | The plugin's modules. The wiki module is built in. |
| `wiki` | | Options of the wiki, such as an `embedder` or the `defaultAlgorithm`. The conversation folder and Obsidian's Excluded files always stay out of its index. |
| `conversationFolder` | `conversations` | The folder of conversation notes. |
| `idleMinutes` | 15 | Minutes after which an agent process with no open message box closes. |
| `commands` | every group | `{ conversations, sessions, wiki, modules }`: the groups of commands to add. `modules` is the New module command. The commands of the modules' templates and actions are always added. |
| `statusBar` | `true` | A status bar item that says which agents work. |
| `folderColors` | `true` | Each module's folder in the module's color in the file explorer, its internal folder muted, and `internal/` gray (`INTERNAL_COLOR`). `folderColorRules(yami)` gives the CSS. |

It gives each module's commands the module's icon, and warns in the console of a module whose icon Obsidian does not have. It discovers the vault modules a moment after a module document, a template document, or the base skill changes, or a file is created, renamed, or removed (`watchModules`), and then adds and removes each template's command as the template appears and goes, and updates the folder colors. Removing a command needs Obsidian 1.7.2 or later. New module asks for a name in a prompt with one text field: Enter creates the module with `yami.createModule` and opens its module document, and Escape cancels. It enables the modules when the workspace is ready, shows a notice when one fails, marks the wiki's index stale on each change in the vault, and, when the plugin unloads, kills the live runs, closes the conversations, and removes the shared-document hub.

The commands and their ids. Obsidian adds the plugin's id before each, as `<plugin id>:new-module`, so a test runs one with `app.commands.executeCommandById`:

| Group | Id | Name |
| --- | --- | --- |
| `conversations` | `new-conversation-<agent name>`, `end-conversation`, `stop`, `focus-composer`, `revert` | New conversation with claude, End this conversation, … |
| `sessions` | `run-session-<agent name>`, `resume-session`, `stop-session`, `kill-session` | Run this session with Claude, Resume this session, … |
| `wiki` | `wiki-search`, `wiki-related`, `wiki-compare`, `wiki-match`, `wiki-lint-note`, `wiki-lint-vault`, `wiki-snapshot`, `wiki-versions`, `wiki-restore`, `wiki-refresh`, `wiki-ingest-file`, `wiki-ingest-folder` | Wiki: search, … |
| `modules` | `new-module` | New module |
| always | `<module id>-new-<template id>` | `<module name>: new <template name>`, for each template that offers a command |
| always | `<module id>-<action id>` | `<module name>: <action name>`, for each action |

`watchModules(app, component, yami)` is the discovery trigger, for a host that builds its own `Yami`: it discovers again 300 ms after the last of close changes (a module document, a template document, or the base skill changed, or any file created, renamed, or removed), and stops when the component unloads.

`ObsidianYami` adds what a plugin's own commands and views need:

- `activeSession(module or template?)`, the session open in the editor; `activeFile()` and `activeSelection()`; `properties(path)`, a note's properties from Obsidian's cache.
- `onSessionsChange(listener)`: a call when the sessions or the modules may look different, after a session document or a module's document changes, a run changes its status, or a discovery changes `modules` or `problems`. A view of both needs this feed only. Close calls become one. `onWikiChange(listener)`: a call when a note that the wiki holds, or would hold, changes, for a view of the wiki. A change to a note the index leaves out, such as a conversation, makes no call.
- `newSession(template)`: creates a session, opens it, and says so. `runAction(action, session?)`: does a module's action, and first lets the person pick when it has choices. `runModuleAct(act)`: does an act of `module.acts()`.
- `open(path, mode)`; `pick(items, label, placeholder)`, a list to pick one from; and `notify(work)`, which shows the message of a promise, opens the note it names, shows an error in a notice, and resolves when it has.
- `moduleIcon(module)`, the name of the module's icon, or `MODULE_ICON` when Obsidian does not have it, for `setIcon`.
- `agentName(agent)`, the name the agent is registered under; `hub` and `conversations`, the shared documents and the conversation notes, for other plugins.

The plugin must ship `yami/obsidian/styles.css` as the `styles.css` next to its `main.js`; `copyStyles` in `yami/esbuild` copies it.

### The parts

A host that does not use `createYami` can install the parts itself:

```ts
import { ConversationManager, installCollab, ObsidianVault, PermissionPrompts, uninstallCollab, vaultRoot } from "yami/obsidian";

// In Plugin.onload:
const vault = new ObsidianVault(this.app, vaultRoot(this.app));
const hub = installCollab(this.app, this);
const conversations = new ConversationManager(this.app, hub, new PermissionPrompts(this.app), {
  agents: () => [{ name: "claude", color: "#d97757", agent: claudeAgent }],
  folder: () => "conversations",
  animate: () => true,
  idleMinutes: () => 15,
  onActivity: () => {},
});
conversations.install(this);

// In Plugin.onunload:
await conversations.destroy();
uninstallCollab(hub);
```

### Shared documents (`obsidian/collab/`)

While an agent works with a note, the note is a shared document: a Yjs `Y.Doc` with one `Y.Text`. The user and each agent are peers of this document. They exchange Yjs updates in memory; there is no network, and the markdown file stays the only thing on disk.

- `CollabHub` owns the shared notes. `acquire(file, holder)` shares a note until `release`. While an agent writes files with its own tools (`addWriter`), every note open in an editor is shared, so a change on disk merges with unsaved typing instead of replacing it. The hub patches `MarkdownView.setViewData` and `Vault.modify` while it is installed, so one Obsidian window has one hub: `installCollab` makes it, and a second plugin gets the same one.
- `SharedNote` remembers the document state that matches the file on disk. When another program changes the file, the note forks the document at that state, replays the change on the fork, and merges the fork. Text that the user typed after the last save stays, also inside a range that the agent rewrote.
- `EditorBinding` keeps a CodeMirror editor and a shared note in sync. Changes from the note reach the editor with `addToHistory: false`, so Cmd+Z undoes only the user's own typing.
- `AgentPeer` is one agent in one note. Its edits carry the peer as the Yjs origin, so editors highlight them and `agentUndo` can revert one turn. It publishes a cursor and a status through the Yjs awareness protocol, and types its edits when the note is visible.
- `LiveRegion` is a range that an agent writes as its own output, such as a reply. Appended text is typed a few characters at a time.
- `presenceExtensions` draw the agent's caret, name flag, selection, fresh-text highlight, and the edge pill that scrolls to the agent.

### Conversation notes (`obsidian/conversation/`)

A conversation note is a document with `type: conversation`; the format is in `yami/conversation`. `ConversationManager` gives each open conversation note a `Composer`, the message box at the bottom of the note, and creates new conversations in the `folder`. `ConversationController` runs one note: its agent session, the transcript in the note, queued messages, approval requests, and the agent's questions.

- `create(agent)` makes a note with a placeholder name and opens it. The first message names the note.
- `start({ message, agent?, title?, folder?, open?, module? })` creates a note and sends the first message, for a module or another plugin. `status(path)` and `onTurnEnd(path, listener)` follow it.
- The composer shows approval requests and questions above the message box, with `Y`, `A`, and `N` keys. With no composer open, `PermissionPrompts` shows a dialog.
- `/model`, `/effort`, `/mode`, `/new`, and `/end` are local commands. Other `/` commands come from the harness. `[[` suggests notes.
- The agent process closes after `idleMinutes` without a composer; the next message resumes the session from the `session` property.

### The wiki in Obsidian (`obsidian/wiki/`)

The views that let a person use the vault's `Wiki` directly. They call the wiki's own methods and hold no ranking of their own. `createYami` adds a command for each; a host that builds its own `Wiki` uses them directly:

```ts
const wiki = new Wiki(vault, { exclude: () => ["conversations", ...ignoredPaths(this.app)] });
watchWiki(this.app, this, wiki);                                   // a change in the vault marks the index stale
new WikiSearchModal(this.app, wiki).open();                        // live search; Tab moves to the next algorithm
new WikiSearchModal(this.app, wiki, { seeds: [path], algorithm: "ppr" }).open();   // related notes
new WikiCompareModal(this.app, wiki, "a query").open();            // every algorithm side by side
new NoteListModal(this.app, findingRows(wiki, await wiki.lint()), "Findings").open();
new NoteListModal(this.app, matchRows(wiki, await wiki.match([name])), "Match").open();
```

- `ignoredPaths(app)` reads Obsidian's Excluded files setting: the entries that name a folder or a file. An entry written as a `/regular expression/` is not read.
- In every list, Enter opens the note, Cmd+Enter opens it in a new tab, and Alt+Enter inserts a link to it at the cursor of the active editor (`openNote`).
- Many queries that arrive while the index is stale share one refresh, and a change during a refresh makes the next query read again.

## `yami/testing`

Test a module in Node, without Obsidian or a harness.

```ts
import { testYami } from "yami/testing";

const librarian = new Librarian();
const t = await testYami({ modules: [librarian] });         // a Yami over a fresh vault in a temporary folder, every module enabled
const v = await testYami({ files: { "internal/notes": "test/fixtures/notes" } });   // with files copied in first, so enable finds a vault module
const session = await librarian.checkout.create({ name: "RL" });
t.agent.queue(async (prompt, session) => { /* the agent's first turn: write files, call session.tool(name, input) */ }, review());
expect(await session.start()).toMatchObject({ state: "done" });
await t.dispose();                                          // stops every run and removes the vault
```

- `testYami({ modules, turns, wiki, files })`: `files` maps a vault path to a file or a folder on disk, which `testYami` copies into the vault before it enables the modules. A relative disk path starts at the working directory of the test run. A file it cannot copy throws, with the path.
- `FsVault` is a `Vault` over a folder of the file system.
- `ScriptedAgent` runs the next function of its script for each turn of each of its sessions, and completes a turn with no function left. The script is shared by the agent's sessions, so a review takes the turn after the worker's. A turn gets the message and the `ScriptedSession`, whose `tool(name, input)` calls a tool as the harness would. A turn that never resolves runs until `stop` or `kill`, as a harness's does. `agent.started` holds every session in order; `agent.last.prompts` holds the messages of its last session, and `agent.last.options` the tools, skills, and access it got.
- `review(verdicts?)` is a turn that plays the reviewer: it records a verdict with `yami_review` for each item of the review, the one that `verdicts` names (by the item's name or path, as a verdict or `[verdict, reason]`), and otherwise `followed` or `met`. A reviewer that gives no verdict is a turn that does nothing. It throws in a session that is no review's.

```ts
// The worker meets the check; the reviewer finds the policy broken; the worker fixes it; the next review passes.
t.agent.queue(writeTheNote, review({ "Cite sources": ["broken", "The second claim has no source."] }), fixTheNote, review());
expect(await session.start()).toMatchObject({ state: "done", iterations: 2 });
```
- `markdownText()` is a Vite plugin for `vitest.config`, which imports a `.md` file as its text, as the plugin's build does.

## `yami/esbuild`

```js
import esbuild from "esbuild";
import { copyStyles, pluginBuild } from "yami/esbuild";

const context = await esbuild.context({ ...pluginBuild({ production }), entryPoints: ["src/main.ts"], outfile: "main.js" });
await copyStyles("styles.css");
```

`pluginBuild` gives a CommonJS bundle with Obsidian, Electron, CodeMirror, and Node's modules left out, `.md` files loaded as text, and the four fixes the agent SDKs need in Obsidian's renderer (see the Claude harness). `copyStyles(to, own)` writes the Obsidian layer's stylesheet, then the plugin's own stylesheets in `own`, in order.

## Build and tests

- `npm run build` first type-checks every module except `yami/obsidian` with `tsconfig.core.json`. That check has no DOM types, and it maps `obsidian` and `@codemirror/*` to an empty module, so a core file that uses them, or imports a file of `yami/obsidian`, fails the build. Then `tsc` builds the whole library.
- `npm test` runs the unit tests: the session queue, the Codex adapter against a scripted `app-server` (`test/fixtures/fake-codex.mjs`), the RPC connection, the diff, the modules, the vault modules, the loop, the review, and the session handle with `yami/testing`, the wiki (each algorithm, match, lint, the checks, and the module's tools) over a fixture vault with a fake embedder, and in `test/unit/obsidian/` the shared documents, the conversation manager, the modules' commands, and the discovery trigger over a fake Obsidian app.
- `npm run bench` runs the retrieval benchmark against the vault in `YAMI_BENCH_VAULT`; see [The benchmark](#the-benchmark).
- `npm run test:live` runs the agent scenarios against the real CLIs, for both harnesses: streaming, approvals, `beforeFileChange`, interrupt, a command stopped on interrupt, queued messages, instructions, and resume.
- The plugin's `npm run test:obsidian` drives the real Obsidian app with `yami/obsidian`.
