# Yami

The Yami Obsidian plugin, and the test bed of the `yami` library. It runs conversations with Claude Code and Codex in your notes, and the sessions of Yami modules. The Obsidian layer, `yami/obsidian`, does the work; the plugin registers the agents and the commands.

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

## Conversations

Run **New conversation** from the ribbon, or **New conversation with claude** or **with codex** from the command palette. You get a note in `conversations/` with a message box at the bottom. Press Enter to send. The note records the conversation: your messages, the agent's replies, and its tool calls in collapsed sections. The note gets its name from your first message.

Before the agent changes a file or runs a command, the request shows above the message box. Press `Y` to allow it once, `A` to allow it for the rest of the conversation, or `N` to deny it. The buttons under the message box change the model, the effort, and when the agent asks first. When the agent changes a note that is open, you see its cursor there, and its changes merge with what you type.

Commands: **End this conversation**, **Stop the agent in this conversation**, **Focus the message box**, and **Undo the agent's last changes in this note**.

Every module skill is a command in every conversation: type `/wiki:ingest` or `/hello:greeting`, with what the skill should work on after it. The message box suggests them after `/`. The agent can also load a module skill on its own when a request needs it, without asking you: reading a module skill's files is the one thing Codex does without an approval under **ask**.

The agents use your own setup for their harness: your `CLAUDE.md` and `AGENTS.md` files, skills, plugins, MCP servers, and permission rules. `window.yami` holds the agents and the conversation manager for the developer console.

## Try the hello module

The hello module is the smallest Yami module: one policy, one promise, and one skill. When the plugin loads, it writes the files of each module that are missing: `Yami.base`, `hello/sessions.base`, and the module's documents under `internal/hello/`. Files that exist stay as they are, so you can edit the bases and the documents. Two commands drive the module:

1. **Hello: new session** creates `hello/Session <time>.md` and opens it. Its properties link the policy, the promise, and the skill, and `greeting` is the module's own field, which you can change.
2. **Hello: run this session with Claude** or **with Codex**, with the session document open, runs the agent loop. The document shows the state, the deliverables, and the progress as the loop runs, and links the conversation note in `conversations/` that records the run. Open that note to watch the agent, answer its approvals, or continue the conversation.

## The wiki

The plugin builds one `Wiki` over the vault and gives every agent the wiki tools, `wiki_search`, `wiki_match`, and `wiki_lint`, so any conversation can answer from your notes with citations. The wiki module keeps topics in `wiki/topics/` and sources in `wiki/sources/`.

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
2. **Wiki: run this session with Claude** or **with Codex**, with the session open, runs the ingest. The agent reads the originals in chunks, with one worker per chunk when its harness has subagents, matches the subjects against the wiki, drafts the topics, and applies them as one change plan with `wiki_change`. It cannot write the wiki any other way: the session is read-only. The loop checks the `Change applied`, `Sources absorbed`, and `Clean topics` promises after each turn.

Every change has a version before and after it. **Wiki: take a snapshot** saves the current state as a version when it is not one already. **Wiki: versions** lists them, newest first, each with its change; Enter opens the version's document, which names what changed. **Wiki: restore a version** writes a version back, as a new version, so nothing is lost. The module ledger, `internal/wiki/sessions.base`, has the versions and the changes as tables.

## Tests

`npm run test:obsidian` starts a separate Obsidian with a temporary vault, installs the built plugin, and drives it with real agents: the module install, the wiki commands, conversations with approvals and questions, an edit to an open note while the user types in it, a Codex conversation, the conversation API, and a hello session. Your own Obsidian and vaults are not touched. Build the plugin first.

## Build a release

```sh
npm run build
```

This command type-checks `src/` and writes a minified `main.js`. A release contains `main.js` and `manifest.json`.
