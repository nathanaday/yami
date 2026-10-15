# Yami

A hello world Obsidian plugin. It adds a ribbon icon and a "Say hello" command. Both show the greeting from `yami` in a notice.

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

The agents use your own setup for their harness: your `CLAUDE.md` and `AGENTS.md` files, skills, plugins, MCP servers, and permission rules. `window.yami` holds the agents and the conversation manager for the developer console.

## Try the hello module

The hello module is the smallest Yami module: one policy, one promise, and one skill. When the plugin loads, it writes the files of each module that are missing: `Yami.base`, `hello/sessions.base`, and the module's documents under `internal/hello/`. Files that exist stay as they are, so you can edit the bases and the documents. Two commands drive the module:

1. **Hello: new session** creates `hello/Session <time>.md` and opens it. Its properties link the policy, the promise, and the skill, and `greeting` is the module's own field, which you can change.
2. **Hello: run this session with Claude** or **with Codex**, with the session document open, runs the agent loop. The document shows the state, the deliverables, and the progress as the loop runs, and links the conversation note in `conversations/` that records the run. Open that note to watch the agent, answer its approvals, or continue the conversation.

## Tests

`npm run test:obsidian` starts a separate Obsidian with a temporary vault, installs the built plugin, and drives it with real agents: the module install, conversations with approvals and questions, an edit to an open note while the user types in it, a Codex conversation, the conversation API, and a hello session. Your own Obsidian and vaults are not touched. Build the plugin first.

## Build a release

```sh
npm run build
```

This command type-checks `src/` and writes a minified `main.js`. A release contains `main.js` and `manifest.json`.
