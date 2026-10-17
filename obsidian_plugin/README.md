# Yami

The Yami Obsidian plugin, and the test bed of the `yami` library. It runs conversations with Claude Code and Codex in your notes, and the sessions of its modules: threads, the librarian, and journals, and of any module that you define in the vault, such as hello. `src/main.ts` gives `createYami` the agents and the modules; `yami/obsidian` does the rest.

## Develop

1. Install the dependencies. This step also builds `../yami` and links it into `node_modules`:

   ```sh
   npm install
   ```

   When you change `yami`, rebuild it with `npm run build` in that folder, or run `npm run dev` there to rebuild on each change.

2. Link this repository into the plugins folder of a test vault:

   ```sh
   ln -s "$PWD" /path/to/vault/.obsidian/plugins/yami
   ```

3. Start the watch build. esbuild writes `main.js` again each time you change a file in `src/`:

   ```sh
   npm run dev
   ```

4. In Obsidian, open **Settings → Community plugins** and turn on **Yami**. To load your changes, turn the plugin off and on again, or run the command **Reload app without saving**.

## The modules

Each module is a folder in `src/modules/`: the class in `index.ts`, and its skills, policies, promises, and agents as markdown files beside it, which the build imports as text. When the plugin loads, each module writes the files that are missing under `internal/<module>/`. Files that exist stay as they are, so you can edit them in the vault.

In the file explorer, each module's folder has the module's color, its folder under `internal/` the same color muted, and `internal/` is gray. The wiki is cyan. The librarian sets its color, `#a0522d`, with `readonly color`; the other modules take a basic color by their id. Each module sets its icon, a Lucide name, with `readonly icon`: the panel shows it, and the module's commands carry it.

| Module | Icon | Folder | Templates | Actions |
| --- | --- | --- | --- | --- |
| Threads | `spool` | `threads/` | Thread (planted by `/threads:stub`) | |
| Librarian | `library` | `librarian/` | Checkout | Return this checkout |
| Journals | `notebook-pen` | none | | Publish a volume |

To add a module in code, write its folder and add an instance to `modules` in `src/main.ts`. Its commands appear on the next load: one for each template, **<Module>: new <template>**, and one for each action. Its tools and skills reach every agent. Test it in `test/unit/` with `testYami` from `yami/testing`. To add a module with no code, define it in the vault: see [Define a module in the vault](#define-a-module-in-the-vault).

## Define a module in the vault

A module can be markdown only. Yami finds it when its files appear, and drops it when they go, with no reload. Hello is the example: its files are in `test/fixtures/vault-modules/hello/`, and they go in `internal/hello/` of your vault.

```
internal/hello/
  hello.md                         the module document
  templates/Greeting.md            one template document for each kind of session
  policies/Always say hello.md     the documents that the templates link
  promises/Greeting note.md
  skills/greeting/SKILL.md
hello/                             the sessions, one document each, as for any module
```

1. Run **New module** and give a name, such as `Hello`. Yami writes a starter module in `internal/hello/`, with one template, `Task`, and opens its module document. The folder's name is the module's id.
2. Edit the module document, `hello.md`. Its properties set the module: `type: module`, and the optional `name` (`Hello world`), `description`, `icon` (`hand`, a Lucide name), `color`, and `instructions` for every run.
3. Write a template document in `templates/` for each kind of session. Its file name gives the template's id, so `Greeting.md` is `greeting`, and its command is **Hello world: new greeting**. Its properties:

   ```yaml
   type: template
   name: Greeting
   skills:
     - greeting
   policies:
     - "[[Always say hello]]"
   promises:
     - "[[Greeting note]]"
   fields:
     greeting: Hello
   ```

   `fields` are the session fields of a new session, each with its default. A link finds a document by its path, or by its name: first in the module's own folders, then in the whole vault. A skill is found by its folder's name in `skills/`. The template can also set `maxIterations`, `access` (`edit` or `read-only`), `instructions`, and `command: false`. The body of the template document is the body of a new session.
4. Write the documents that the template links. A promise names a core check, such as `exists` with a `path`; Hello's `Greeting note` is met when `greetings/<session>.md` exists. A policy, and a promise with no check, is judged by the review: after the checks pass, a new read-only agent reads the run and records a verdict for each.

A vault module has no tools, checks, or actions of its own. Its sessions get every tool that Yami serves, the core checks, and the review. Remove the folder to remove the module.

When a document is wrong, for example `access: readonly` in a template, the panel lists the problem with the file and how to fix it. The template stays out until you fix it, and every other module and template works as before.

## The panel

**Open the Yami panel**, from the ribbon or the command palette, shows a panel in the right sidebar:

- **Modules**: each module with its icon in its color, and a line that counts its sessions by status. A badge counts the sessions that need attention. Sessions that work now are at the top. Under the modules, **Problems** lists each module document or template document that Yami cannot use, with what to fix, and the base skill (`internal/yami/skills/run/SKILL.md`) when you edited it and a Yami update has a new text; click one to open the document.
- **A module**: its description, a button for each of its templates, such as **New greeting**, its actions, such as **Publish a volume**, and its sessions, newest first. A module defined in the vault shows its problems under its description. A session's mark shows its status: a hollow circle before its first run, a turning arc while the agent works, a half-filled circle while Yami checks the promises, a dot in a circle while a reviewer judges the work, a filled circle when done, a diamond when it needs attention, a cross when it failed, and a square when stopped. A row's button runs or stops the session.
- **A session**: its status, its acts as buttons (**Run with Claude**, **Resume**, **Stop**, **Return this checkout**), its promises with whether the last check or review met them, its policies with whether the last review found them followed, each with the reason, its skills and articles, its conversation and the conversation of its last review, and its progress. Click a document to open it; Cmd-click opens it in a new tab.

Backspace goes up a level. The panel follows the vault: a session that an agent creates, a run that starts, and a promise that is met show at once. The panel is the plugin's own code, `src/panel/`, over the library's read API.

## The wiki navigator

**Open the wiki navigator**, from the ribbon or the command palette, walks the wiki by its tags, where `ml/vision` is below `ml`. It follows the note open in the editor:

- **A note**: the tags above its own (**Above**), its own tags (**Tags**), and the tags one level below them (**Below**), each with its count of notes.
- **A tag**: the tags above it, the tags one level below it, and the notes that hold it. The note open in the editor is marked.
- **Wiki**: the top tags.

Click a tag to go to it, and a note to open it; the navigator follows. Back, or Backspace, returns to the place before. A note with no tags, or one the wiki leaves out, says so. Tags come from each note's `tags` property only: no tag pages and no links between notes.

## Conversations

Run **New conversation** from the ribbon, or **New conversation with claude** or **with codex** from the command palette. You get a note in `conversations/` with a message box at the bottom. Press Enter to send. The note records the conversation: your messages, the agent's replies, and its tool calls in collapsed sections. The note gets its name from your first message.

Before the agent changes a file or runs a command, the request shows above the message box. Press `Y` to allow it once, `A` to allow it for the rest of the conversation, or `N` to deny it. The buttons under the message box change the model, the effort, and when the agent asks first. When the agent changes a note that is open, you see its cursor there, and its changes merge with what you type.

Commands: **End this conversation**, **Stop the agent in this conversation**, **Focus the message box**, and **Undo the agent's last changes in this note**.

Every module skill is a command in every conversation: type `/wiki:ingest` or `/librarian:checkout`, with what the skill should work on after it. The message box suggests them after `/`. The agent can also load a module skill on its own when a request needs it, without asking you: reading a module skill's files is the one thing Codex does without an approval under **ask**.

The agents use your own setup for their harness: your `CLAUDE.md` and `AGENTS.md` files, skills, plugins, MCP servers, and permission rules. `window.yami` holds the plugin's Yami for the developer console: its `agents`, `modules`, `wiki`, `conversations`, and `running` sessions.

## Sessions

A session is one document in its module's folder. Its properties link its skills, policies, and promises; its body says the work, and shows the deliverables and the progress. With a session document open:

- **Run this session with Claude** or **with Codex** runs the agent loop: a turn, then a check of every promise, then a review of the policies and of the promises with no check, until each one passes or the iterations run out. The review is a new read-only conversation that records a verdict and a reason for each item in the session document. The document links the conversation note that records the run; open it to watch the agent, answer its approvals, or write to it.
- **Stop this session** interrupts the agent's turn. **Kill this session's agent** closes the agent at once, for an agent that does not respond. Both leave the session `stopped`.
- **Resume this session** checks the promises, and ends the session `done` when they are met. Otherwise it continues the same conversation, so the agent keeps what it did.

The ledger of each module, `internal/<module>/sessions.base`, lists its sessions and their state. `Yami.base` lists every session of the vault.

## Try the hello module

Copy `test/fixtures/vault-modules/hello/` to `internal/hello/` in your vault. It is the smallest module: one policy, one promise, one skill, and one template.

1. **Hello world: new greeting** creates `hello/Greeting <time>.md` and opens it. Its properties link the policy, the promise, and the skill, and `greeting` is the module's own field, which you can change.
2. **Run this session with Claude** or **with Codex** runs the agent loop. The document shows the state, the deliverables, the review, and the progress as the loop runs.

## Threads

A thread is one piece of work on one or more repositories, from idea to closed. It is one session document in `threads/`: the user's idea and the research's context, the spec (goal, requirements, rules, decisions), the plan, the validation rounds, and the outcome.

- In a conversation, `/threads:stub <your idea>` plants a thread, and `/threads:run <thread>` takes it to closed: a spec, a review, a plan, the work with a commit per task, a validation by a read-only agent, and the close. A thread is also a session: open its document and run **Run this session with Claude**.
- **Skills**: `/threads:stub`, `/threads:spec` (writes the spec, has it reviewed, and plans), `/threads:run`, and `/threads:validate`, which validates in a fresh conversation, for Codex. **Agents**: `threads:reviewer` reviews a spec and `threads:validator` validates the work, both with no edit tool.
- **Tools**: `threads_stub`, `threads_spec`, `threads_plan` (add, done, drop), `threads_round`, `threads_close` (closed or dropped), and `threads_status`, which only reads, so a reviewer has it too. Each write returns the thread's `phase`, its `next` step, and its problems. The input of each is declared once, in `stubShape`, `specShape`, `planShape`, `roundShape`, and `closeShape`.
- **The phase** is derived from the document at each read: stub, specified, planned, in progress, unvalidated, failed, validated, closed, or dropped. The next step is spec, plan, wait, execute, validate, resolve, ask, close, or none. The `thread` check is met when the thread is closed or dropped, and is for review when the user decides: the budget of rounds is used, or the thread waits for one in its `after`.
- **The rules of a round**: each requirement gets one result with evidence; a failing requirement needs a blocking finding; a finding with `predates` never blocks; each finding of the last round needs an outcome (fixed, spec, stub, declined, or knowledge) in the next round or at the close, where only stub, declined, or knowledge are taken; a carried result must be a pass of the last round whose requirement text did not change; a thread may take 3 rounds unless the spec sets `budget`. After a pass, a change to the plan or the spec needs `user_asked`, the user's words, which the decisions keep.
- **The document's formats**: `- **R1** text`; `- [ ] **T1** text · serves R1, R2` with a `· done: <trail>` or `· dropped: <reason>`, and details indented below; each round as `### Round N`, with its data in a hidden comment on its last line.

For a repository outside the vault, let the agent edit there and run its tests in your Claude Code settings (`additionalDirectories`) or Codex settings (`sandbox_workspace_write.writable_roots`), or answer each approval in the conversation.

## The librarian

A checkout is a reading list of the wiki's material on a subject, and a copy of each document for you to read and mark up.

- **Librarian: new checkout** creates a checkout session. Write your request in its Request section, and run it. Or, in a conversation, `/librarian:checkout <subject>`.
- The checkout skill searches with `wiki_search` and the `hop2` algorithm, keeps what serves the request, orders it foundations first with a reason each, and calls `librarian_checkout`. The tool writes the reading list into the session document, and the copies in the folder of its name, `<Title> (checkout).md`. A copy holds the original's body, `copy_of`, and `sha256`, the hash of that body. Only topics and sources are checked out, at most 60.
- Mark up the copies, then open the reading list and run **Librarian: return this checkout**. Each copy whose hash changed returns its edits as a `modify` with `base`, in one change, "Return <name>"; a copy whose original changed too, is gone, or whose edit the wiki refuses stays, with the reason. Copies that returned or had no edit are removed. The reading list's Return section says what happened.

## Journals

Your own writing: each folder directly under `journals/` is a volume. No agent changes a journal.

**Journals: publish a volume** lists the volumes with how many notes wait to be published. It captures each note whose latest source does not hold its text, and opens the edition, a wiki ingest session `<Volume Name> edition <date>`, with those sources and the `Journal sources` policy (primary authority, exact quotes, no claim the note does not make). Run the edition to absorb them. It refuses a volume with no note, and one with no change since its last publish.

## The wiki

The plugin gives every agent the wiki tools, `wiki_search`, `wiki_match`, and `wiki_lint`, so any conversation can answer from your notes with citations. The wiki module keeps topics in `wiki/topics/` and sources in `wiki/sources/`.

The wiki indexes every note except `conversations/` and the folders and files in Obsidian's **Settings → Files and links → Excluded files**. A change in the vault marks the index stale, and the next query reads the vault again.

Commands to try the wiki yourself. In each list, Enter opens the note, Cmd+Enter opens it in a new tab, and Alt+Enter inserts a link to it at the cursor.

| Command | What it does |
| --- | --- |
| **Wiki: search** | Searches as you type. Each hit shows its score, why it ranks, and a snippet. Tab moves to the next algorithm and runs the query again. |
| **Wiki: notes related to this note** | Starts from the open note with personalized PageRank and lists the notes near it in the link graph. Type to narrow. |
| **Wiki: compare the algorithms** | Runs one query with every algorithm and shows the top ten of each side by side, with the time of each. Hover a note to mark it in every column. The selection is the first query. |
| **Wiki: match the selection** | Shows whether a topic or source holds the selected name, or which notes are near it. |
| **Wiki: lint this note**, **Wiki: lint the vault** | Lists the findings, errors first, each with its fix. Type to filter. |
| **Wiki: rebuild the index** | Reads the vault again and reports the notes, links, communities, and time. |

`window.yami.wiki` holds the wiki for the developer console, for example `await yami.wiki.search("interrupt", { algorithm: "hop2" })`.

1. **Wiki: ingest this file**, with a note or an attachment open, captures it as a source. Your file stays where it is. Yami keeps a frozen copy in `internal/wiki/originals/`, writes `wiki/sources/<name> (source).md`, which embeds the copy, and creates `internal/wiki/sessions/Ingest <name> <date>.md`, a session that links it. **Wiki: ingest a folder** does the same for every file in a folder you pick.
2. **Run this session with Claude** or **with Codex**, with the session open, runs the ingest. The agent reads the originals in chunks, with one worker per chunk when its harness has subagents, matches the subjects against the wiki, drafts the topics, and applies them as one change plan with `wiki_change`. It cannot write the wiki any other way: the session is read-only. The loop checks the `Change applied`, `Sources absorbed`, and `Clean topics` promises after each turn.

Every change has a version before and after it. **Wiki: take a snapshot** saves the current state as a version when it is not one already. **Wiki: versions** lists them, newest first, each with its change; Enter opens the version's document, which names what changed. **Wiki: restore a version** writes a version back, as a new version, so nothing is lost. The module ledger, `internal/wiki/sessions.base`, has the versions and the changes as tables.

## Tests

- `npm test` runs the unit tests of the modules in Node, with `testYami`: no Obsidian, no harness. `test/unit/hello.test.ts` copies the Hello fixture into a vault, runs a session through the review to done, and breaks its template.
- `YAMI_LIVE_THREAD=1 npm run test:live` takes one thread from stub to closed with a real Claude Code, on a scratch repository: the skills, the tools, the reviewer and validator agents, and the loop. It takes some minutes.
- `npm run test:obsidian` starts a separate Obsidian with a temporary vault, installs the built plugin, and drives it with real agents: the module install, Hello made with **New module** and removed with its folder, the commands, the wiki commands, a journal publish and a checkout return, conversations with approvals and questions, an edit to an open note while the user types in it, a Codex conversation, the conversation API, a hello session through its review, and a session stopped in the middle of a turn and resumed. Your own Obsidian and vaults are not touched. Build the plugin first.

## Build a release

```sh
npm run build
```

This command type-checks `src/` and writes a minified `main.js`. A release contains `main.js`, `manifest.json`, and `styles.css`.
