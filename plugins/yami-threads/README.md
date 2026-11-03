# Yami Threads

Validated work on your repositories, from Obsidian. A thread is one note that carries an idea to a close: the idea in your words, a spec with checkable requirements, a plan, the work with a commit for each task, and a validation by a fresh agent that did none of the work.

Yami Threads is the threads plugin of [Yami](https://github.com/nathanaday/yami). It is not in the community directory: install it from a release, or build it yourself.

## What it does

- **Threads.** In a conversation (Duet, or this plugin's own session notes), `/threads:stub <your idea>` plants a thread in `threads/`. `/threads:run <thread>` takes it to closed: a spec, a review of the spec, a plan, the work, a validation round, and the close. The phase is derived from the note each time it is read, so the note and the status always agree.
- **The rules of a round.** Every requirement gets a result with evidence; a failing requirement needs a blocking finding; each finding gets an outcome in the next round or at the close; a thread may take three rounds unless its spec sets a budget. After a pass, a change to the plan or the spec needs your words.
- **Your own flows.** Add a kind of work with no code: **Threads: create flow** writes a starter flow under `internal/threads/flows/`, and the create commands write its agents, policies, promises, and skills. Their sessions go in `threads/` beside the threads.
- **The panel.** The threads module, its sessions, and one session with its status, its promises, its policies, its conversation, and its progress. Run, stop, and resume from there.

## Install

You need Obsidian 1.13 or later on the desktop, and [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (`claude`) or the [Codex CLI](https://github.com/openai/codex) (`codex`) installed and signed in.

Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/nathanaday/yami/releases?q=yami-threads), put them in `<your vault>/.obsidian/plugins/yami-threads/`, and turn on **Yami Threads** under **Settings → Community plugins**. [BRAT](https://github.com/TfTHacker/obsidian42-brat) can do this for you with a frozen version. Or build it: see Development.

Then run **Open the threads panel** from the command palette, or select the spool in the ribbon.

For a repository outside the vault, let the agent edit there and run its tests in your Claude Code settings (`additionalDirectories`) or Codex settings (`sandbox_workspace_write.writable_roots`), or answer each approval in the conversation.

## Use it

| Command | What it does |
| --- | --- |
| **Open the threads panel** | The panel in the right sidebar. |
| **Threads: create flow**, **create agent**, **create policy**, **create promise**, **create skill** | Writes a starter form under `internal/threads/` and opens it. |
| **Threads: create a flow session** | Picks one of your flows and creates its session in `threads/`. Each flow also gets its own command, **Threads: new <flow>**. |
| **Run this session with Claude**, **with Codex**, **Resume this session**, **Stop this session**, **Kill this session's agent** | With a session note open. |
| **New conversation with claude**, **with codex** | A conversation note with a message box, where `/threads:stub` and `/threads:run` work. When Duet is on, use its conversations instead, and turn these off: they do the same. |

The agents get the threads tools (`threads_stub`, `threads_spec`, `threads_plan`, `threads_round`, `threads_close`, `threads_status`) and the threads skills (`/threads:stub`, `/threads:spec`, `/threads:run`), and your own Claude Code and Codex setup applies.

## What it adds to your vault

- **Folders.** `threads/`, the threads and the sessions of your own flows. `internal/threads/` holds the module's document, its ledger with a board of the open threads, and its forms. `conversations/` holds the conversation note of each run.
- **Files.** `Yami.base` and `internal/yami/skills/run/SKILL.md`, as every Yami plugin writes. No wiki files: the wiki module is [Yami Wiki](../yami-wiki/)'s.
- **Folder colors**, a **status bar item** that says which agents work.

## With Duet and Yami Wiki

Each plugin runs on its own Yami, and all three can be on in one vault; each keeps its own conversation notes. A thread's agent searches the vault with the wiki tools only when Yami Wiki provides them in its own sessions; in a Yami Threads session the agent reads notes as files. The known costs of two Yami plugins in one vault are in the [library README](../../yami/README.md#two-yami-plugins-in-one-vault).

## Development

```sh
npm install                 # takes yami from ../../yami; build the library first (npm run build in yami/)
npm run dev                 # rebuilds main.js and styles.css on every change
npm run install:vault -- /path/to/vault   # builds, and copies the plugin into the vault
```

| Command | What it does |
| --- | --- |
| `npm run build` | Type-checks the plugin and its tests, and writes a minified `main.js` and `styles.css`. |
| `npm run lint` | Runs Obsidian's review rules with no warning allowed. |
| `npm test` | The unit tests: the version files agree. The threads module's own tests are in the library. |
| `npm run test:obsidian` | Starts a separate Obsidian with a temporary vault, installs the built plugin, and drives it with real agents: the install without the wiki, the panel, the create commands and a session of your own flow, and a conversation that calls a threads tool from both agents. Build the plugin first. |

Releases: see [docs/releasing.md](../../docs/releasing.md).

## License

[MIT](LICENSE)
