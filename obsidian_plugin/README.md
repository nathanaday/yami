# Yami

The Yami showcase plugin, and the test bed of the `yami` library. It runs conversations with Claude Code and Codex in your notes, the library's two built-in modules, the wiki and threads, and any module that you define in the vault, such as Hello. It adds two views over the library: the panel and the wiki navigator. `src/main.ts` gives `createYami` the agents and no module of its own; `yami/obsidian` does the rest.

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

The plugin has no module of its own. Every Yami has the two built-in modules of the library, and finds the modules that you define in the vault:

| Module | Icon | Folder | Flows | Actions |
| --- | --- | --- | --- | --- |
| Wiki | `book-open` | `wiki/`, its sessions in `internal/wiki/sessions/` | `ingest`, `checkout` | Return this checkout |
| Threads | `spool` | `threads/` | `thread` (planted by `/threads:stub`), and your own flows | |
| Hello (in the vault) | `hand` | `hello/` | `greeting` | |

When the plugin loads, each built-in module writes the files that are missing under `internal/<module>/`: `internal/wiki/wiki.md` and `internal/threads/threads.md`, their ledgers, and their forms. Files that exist stay as they are, so you can edit them in the vault.

In the file explorer, each module's folder has the module's color, its folder under `internal/` the same color muted, and `internal/` is gray. The wiki is cyan. The panel shows each module's icon, and the module's commands carry it.

To add a module in code, write it in the library's form and add an instance to `modules` in `createYami`; see the `yami` README. To add a module with no code, define it in the vault: see [Define a module in the vault](#define-a-module-in-the-vault). To add a kind of work to threads with no code, see [Your own flows in threads](#your-own-flows-in-threads).

## Define a module in the vault

A module can be markdown only. Yami finds it when its files appear, and drops it when they go, with no reload. Hello is the example: its files are in `test/fixtures/vault-modules/hello/`, and they go in `internal/hello/` of your vault.

```
internal/hello/
  hello.md                                the module document
  flows/greeting/FLOW.md                  one flow for each kind of session
  skills/greeting/SKILL.md                the forms that the flow names
  agents/proofreader/AGENT.md
  policies/always-say-hello/POLICY.md
  promises/greeting-note/PROMISE.md
hello/                                    the sessions, one document each, as for any module
```

### The five forms

Each form is a folder named by the document's name, with one file in it. The file starts with `name`, the folder's name in lower-case letters, digits, and dashes, and `description`, one sentence that says what the document is. It has no `type` and no `module`: the folder and the file name give both. The folder can hold other files, which the document names by path.

| Form | Hello's | Its other properties | Its body |
| --- | --- | --- | --- |
| Flow | `flows/greeting/FLOW.md` | the keys below | none |
| Skill | `skills/greeting/SKILL.md` | none | how to greet |
| Agent | `agents/proofreader/AGENT.md` | `access`: `read-only` (the default) or `edit` | the brief of a worker that runs in a fresh context |
| Policy | `policies/always-say-hello/POLICY.md` | none | the rule: begin every reply with the greeting |
| Promise | `promises/greeting-note/PROMISE.md` | `check: exists`, `path: greetings/{{session}}.md` | the deliverable |

```markdown
---
name: always-say-hello
description: Every reply begins with the session's greeting.
---
Begin every reply with the session's greeting, exactly as the `greeting` session property gives it.
```

### A flow reads as a signature

A flow says what a kind of session takes, how it works, what it must follow, and what it must deliver, as `agent(input, policies) -> promises`. Hello's flow:

```yaml
---
name: greeting
description: Greets the session by name, and writes the greeting to a note.
skills: [greeting]
agents: [proofreader]
policies: [always-say-hello]
promises: [greeting-note]
fields:
  greeting: Hello
---
```

| Part | Keys | Hello's |
| --- | --- | --- |
| Input | `fields`, `articles`, and the session's Request section | the field `greeting`, default `Hello`, and what the person writes under **Request** |
| Method | `instructions`, `skills`, `agents` | the skill `greeting`, and the agent `proofreader`, which a session calls with `yami_agent` |
| Constraints | `policies`, `access` | the policy `always-say-hello`, which the review judges |
| Output | `promises` | the promise `greeting-note`, which the `exists` check decides |

A flow names its forms by their bare names, or `<module>:<name>` for a form of another module, such as `wiki:cite-every-claim`. Articles are `[[links]]`. The flow can also set `maxIterations`, `access` (`edit` or `read-only`), `instructions`, and `command: false`. A `FLOW.md` has no body: every new session gets the same sections, `## Request`, `## Deliverables`, and `## Progress`. Its command is **Hello world: new greeting**.

### Make one

1. Run **New module** and give a name, such as `Hello`. Yami writes a starter module in `internal/hello/` in the five forms, with one flow, `task`, and opens its module document. The folder's name is the module's id.
2. Edit the module document, `hello.md`. Its properties set the module: `type: module`, and the optional `name` (`Hello world`), `description`, `icon` (`hand`, a Lucide name), `color`, and `instructions` for every run.
3. Write a flow in `flows/<name>/FLOW.md` for each kind of session, and the forms that it names.

A vault module has no tools, checks, or actions of its own. Its sessions get every tool that Yami serves, the core checks, the agent tool, and the review. Remove the folder to remove the module.

When a document is wrong, for example `access: readonly` in a flow, or a flat `policies/always-say-hello.md`, the panel lists the problem with the file and how to fix it. The flow stays out until you fix it, and every other module and flow works as before.

## The panel

**Open the Yami panel**, from the ribbon or the command palette, shows a panel in the right sidebar:

- **Modules**: at the top, **Waiting for approval** lists each change plan of the wiki that waits for you: its title, its counts (`2 new · 1 changed · 1 removed`), how old it is, and the module of the session that proposed it; when none waits, it says so. Then each module with its icon in its color, and a line that counts its sessions by status. A badge counts what waits for you: the sessions that need attention, and on Wiki its proposals. Sessions that work now are above the modules. Under the modules, **Problems** lists each module document or form that Yami cannot use, with what to fix, and the base skill (`internal/yami/skills/run/SKILL.md`) when you edited it and a Yami update has a new text; click one to open the document.
- **A module**: its description, a button for each of its flows, such as **New greeting** or **New daily review**, its actions, and its sessions, newest first, with the flow of each when the module has more than one. The Wiki module lists its proposals above its sessions. A module defined in the vault shows its problems under its description. A session's mark shows its status: a hollow circle before its first run, a turning arc while the agent works, a half-filled circle while Yami checks the promises, a dot in a circle while a reviewer judges the work, a filled circle when done, a diamond when it needs attention, a cross when it failed, and a square when stopped. A row's button runs or stops the session.
- **A session**: its status and its flow, its acts as buttons (**Run with Claude**, **Resume**, **Stop**, **Return this checkout** on a checkout that is out), its promises with whether the last check or review met them, its policies with whether the last review found them followed, each with the reason or, before any, its description, its skills, agents, and articles, its conversation, the conversation of each agent run with its status, the conversation of its last review, and its progress. Click a document to open it; Cmd-click opens it in a new tab.
- **A change**: a proposal's row opens it, a level below Wiki. The page shows its title (click opens the change document), its status with a mark, when it was proposed and by which session (click goes to the session), its notes, and each write in a group by op: **Creates**, **Changes**, and **Removes**. A write shows its path (click opens the note, or for a create the change document until the change applies), why the plan makes it, and a diff: a created note's text, a removed note's text, or for a change the lines before and after with the changed pieces marked and unchanged lines folded. A note that changed since the proposal gets a warning line, since an approval overwrites that edit (the version before keeps it). **Approve** and **Reject** are there while the change waits; they come from the library's acts, as the commands **Wiki: approve this change** and **Wiki: reject this change** do. Approve shows **Applying**, then the result on the page (`Applied · v3 → v4 · 2 new · 1 changed`, each write marked done) and in a notice; a plan that no longer fits, or a write that fails, shows the reasons on the page in red and the change stays as it was. Reject asks for a reason, which can be empty, then shows **Rejecting** while it writes, and the page then shows **Rejected** with the reason; Escape in the prompt changes nothing. After either, the row leaves the waiting list and the badge drops.

Backspace goes up a level; Tab reaches each row and button, and Enter activates it. The panel follows the vault: a session that an agent creates, a run that starts, a promise that is met, and a plan that an agent proposes show at once. The panel is the plugin's own code, `src/panel/`, over the library's read API; the diff is `src/panel/diff.ts` over `diffOps` of `yami/document`.

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

Every module skill is a command in every conversation: type `/wiki:ingest`, `/wiki:checkout`, or `/threads:stub`, with what the skill should work on after it. The message box suggests them after `/`. The agent can also load a module skill on its own when a request needs it, without asking you: reading a module skill's files is the one thing Codex does without an approval under **ask**.

The agents use your own setup for their harness: your `CLAUDE.md` and `AGENTS.md` files, skills, plugins, MCP servers, and permission rules. `window.yami` holds the plugin's Yami for the developer console: its `agents`, `modules`, `wiki`, `conversations`, and `running` sessions.

## Sessions

A session is one document in its module's folder. Its properties link its skills, agents, policies, and promises; its Request section says the work, and the rest of its body shows the deliverables and the progress. A session's agent can call an agent of any module with `yami_agent`: the agent runs in a fresh context, in a conversation note of its own, and returns its final message. With a session document open:

- **Run this session with Claude** or **with Codex** runs the agent loop: a turn, then a check of every promise, then a review of the policies and of the promises with no check, until each one passes or the iterations run out. The review is a new read-only conversation that records a verdict and a reason for each item in the session document. The document links the conversation note that records the run; open it to watch the agent, answer its approvals, or write to it.
- **Stop this session** interrupts the agent's turn. **Kill this session's agent** closes the agent at once, for an agent that does not respond. Both leave the session `stopped`.
- **Resume this session** checks the promises, and ends the session `done` when they are met. Otherwise it continues the same conversation, so the agent keeps what it did.

The ledger of each module, `internal/<module>/sessions.base`, lists its sessions and their state. `Yami.base` lists every session of the vault.

## Try the hello module

Copy `test/fixtures/vault-modules/hello/` to `internal/hello/` in your vault. It is the smallest module: one flow, one skill, one agent, one policy, and one promise.

1. **Hello world: new greeting** creates `hello/Greeting <time>.md` and opens it. Its properties link the skill, the agent, the policy, and the promise, and `greeting` is the module's own field, which you can change. Write who to greet in its Request section.
2. **Run this session with Claude** or **with Codex** runs the agent loop. The document shows the state, the deliverables, the review, and the progress as the loop runs.

## Threads

A thread is one piece of work on one or more repositories, from idea to closed. It is one session document in `threads/`: the user's idea in its Request section, the research's context, the spec (goal, requirements, rules, decisions), the plan, the validation rounds, and the outcome.

- In a conversation, `/threads:stub <your idea>` plants a thread, and `/threads:run <thread>` takes it to closed: a spec, a review, a plan, the work with a commit per task, a validation by a read-only agent, and the close. A thread is also a session: open its document and run **Run this session with Claude**.
- **Skills**: `/threads:stub`, `/threads:spec` (writes the spec, has it reviewed, and plans), and `/threads:run`. **Agents**: `threads:reviewer` reviews a spec and `threads:validator` validates the work. Both are read-only: they run the commands that only read or check, such as `git log` and the tests, and change no file. The skills call them with `yami_agent`, so each runs in a fresh context on Claude Code and on Codex. The agent that did the work never validates it. A suite that writes a build cache or a temporary file, such as `go test` or `npm test`, runs: the commands of a read-only agent write only a scratch folder of their own. A write to a repository or to the vault fails, and so does a command that needs the network, such as `git push` or a suite that fetches its dependencies. Fetch the dependencies before the validator runs.
- **Tools**: `threads_stub`, `threads_spec`, `threads_plan` (add, done, drop), `threads_round`, `threads_close` (closed or dropped), and `threads_status`, which only reads, so a reviewer has it too. Each write returns the thread's `phase`, its `next` step, and its problems.
- **The phase** is derived from the document at each read: stub, specified, planned, in progress, unvalidated, failed, validated, closed, or dropped. The next step is spec, plan, wait, execute, validate, resolve, ask, close, or none. The `thread` check is met when the thread is closed or dropped, and is for review when the user decides: the budget of rounds is used, or the thread waits for one in its `after`.
- **The rules of a round**: each requirement gets one result with evidence; a failing requirement needs a blocking finding; a finding with `predates` never blocks; each finding of the last round needs an outcome (fixed, spec, stub, declined, or knowledge) in the next round or at the close, where only stub, declined, or knowledge are taken; a carried result must be a pass of the last round whose requirement text did not change; a thread may take 3 rounds unless the spec sets `budget`. After a pass, a change to the plan or the spec needs `user_asked`, the user's words, which the decisions keep.
- **The document's formats**: `- **R1** text`; `- [ ] **T1** text · serves R1, R2` with a `· done: <trail>` or `· dropped: <reason>`, and details indented below; each round as `### Round N`, with its data in a hidden comment on its last line.

For a repository outside the vault, let the agent edit there and run its tests in your Claude Code settings (`additionalDirectories`) or Codex settings (`sandbox_workspace_write.writable_roots`), or answer each approval in the conversation.

### Your own flows in threads

Threads takes flows and forms from the vault, so you can add your own kinds of work to it with no code. Their sessions go in `threads/` beside the threads, and the panel lists them under Threads. They are not threads: they get no thread field, such as `repositories` or `after`, and the board and the thread tools leave them out.

1. Run **Threads: create flow** and give a name, such as `Daily review`. Yami writes a starter flow at `internal/threads/flows/daily-review/FLOW.md`, valid as written, and opens it. Its comments say what each key takes.
2. Write the forms that the flow names with **Threads: create agent**, **create policy**, **create promise**, and **create skill**. Each writes a starter in `internal/threads/<agents|policies|promises|skills>/<name>/` and opens it. A name that a form of that kind has already shows the reason in a notice.
3. Run **Threads: create a flow session**, and pick the flow. Yami creates its session in `threads/` and opens it. The flow's own command, **Threads: new daily review**, does the same.

## The wiki

The library gives every agent the wiki tools, such as `wiki_search`, `wiki_match`, `wiki_lint`, and `wiki_checkout`, so any conversation can answer from your notes with citations. The wiki module keeps topics in `wiki/topics/` and sources in `wiki/sources/`.

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
2. **Run this session with Claude** or **with Codex**, with the session open, runs the ingest. The agent reads the originals in chunks, with one worker per chunk, matches the subjects against the wiki, drafts the topics, and proposes them as one change plan with `wiki_change`. It cannot write the wiki any other way: the session is read-only, and nothing under `wiki/` changes until you approve the plan. The loop checks the `change-applied`, `sources-absorbed`, and `clean-topics` promises after each turn, and the run ends when the plan is proposed.
3. Approve or reject the plan in the panel's **Waiting for approval** list (see [The panel](#the-panel)), or with the change document open, **Wiki: approve this change** or **Wiki: reject this change**; **Wiki: approve a change** and **Wiki: reject a change** pick one from the proposals that wait. The change document, in `internal/wiki/changes/`, is the record of the plan: what it writes in full, and whether it waits, was applied, failed, or was rejected with your reason. A rejected plan sends the reason back to the session: resume it, and the agent proposes a new plan.

### Checkouts

A checkout is a reading list of the wiki's material on a subject, and a copy of each document for you to read and mark up.

- **Wiki: new checkout** creates a checkout session in `internal/wiki/sessions/`. Write your request in its Request section, and run it. Or, in a conversation, `/wiki:checkout <subject>`: the agent calls `wiki_checkout`, which writes `internal/wiki/sessions/<date> <name>.md`.
- The copies go in the folder of the reading list's name, `<Title> (checkout).md`. A copy holds the original's body, `copy_of`, and `sha256`, the hash of that body. The wiki's search skips copies. Only topics and sources are checked out, at most 60.
- Mark up the copies, then open the reading list and run **Wiki: return this checkout**. Each copy whose body changed returns its edits as a `modify` with `base`, in one change, "Return <name>"; a copy whose original changed too, is gone, or whose edit the wiki refuses stays, with the reason. Copies that returned or had no edit are removed. The reading list's Return section says what happened.

### Versions

Every change has a version before and after it. **Wiki: take a snapshot** saves the current state as a version when it is not one already. **Wiki: versions** lists them, newest first, each with its change; Enter opens the version's document, which names what changed. **Wiki: restore a version** writes a version back, as a new version, so nothing is lost. The module ledger, `internal/wiki/sessions.base`, has the versions and the changes as tables.

## Tests

- `npm test` runs the unit tests in Node, with `testYami`: no Obsidian, no harness. `test/unit/hello.test.ts` copies the Hello fixture into a vault, runs a session through the review to done, and breaks its flow. `test/unit/diff.test.ts` runs the panel's diff over `diffOps`. The tests of the wiki and threads are in the library.
- `npm run test:obsidian` starts a separate Obsidian with a temporary vault, installs the built plugin, and drives it with real agents: the install of the built-in modules, the wiki commands, a checkout made with `wiki_checkout` and returned with your edit, the wiki's proposals in the panel (one approved, one rejected with a reason, one refused because it no longer fits) and the approve and reject commands, the **Threads: create** commands and a session of your own flow, with no thread field, in the panel, Hello made with **New module** and removed with its folder, the commands, conversations with approvals and questions, an edit to an open note while the user types in it, a Codex conversation, the conversation API, a hello session through its review, a hello session that calls its agent through `yami_agent`, and a session stopped in the middle of a turn and resumed. Your own Obsidian and vaults are not touched. Build the plugin first.

## Build a release

```sh
npm run build
```

This command type-checks `src/` and writes a minified `main.js`. A release contains `main.js`, `manifest.json`, and `styles.css`.
