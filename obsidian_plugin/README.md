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

## Try the agents

The plugin makes two agents for the vault folder, and puts them on `window.yami`:

- `yami.claude` uses [Claude Code](https://code.claude.com).
- `yami.codex` uses [Codex](https://developers.openai.com/codex).

Install the harness that you want to use, and sign in to it first. The agents use your own setup for that harness: your `CLAUDE.md` and `AGENTS.md` files, skills, plugins, MCP servers, and permission rules. They also use the setup in the vault, for example skills in `.claude/skills` and `.agents/skills`.

Open the developer console with **View → Toggle Developer Tools**. Then type:

```js
const agent = yami.claude;              // or yami.codex
await agent.connect();                  // shows the harness version and account
const session = await agent.startSession({ onPermission: async (request) => "allow" });
session.on((event) => console.log(event));
await session.send("Which notes are in this vault?");
```

Without `onPermission`, the agent's requests to change files or run commands are denied. For the full agent API, see [`yami/README.md`](../yami/README.md).

The agents start processes, so the plugin works only on desktop.

## Try the hello module

The hello module is the smallest Yami module: one policy, one promise, and one skill. When the plugin loads, it writes the files of each module that are missing: `Yami.base`, `hello/sessions.base`, and the module's documents under `internal/hello/`. Files that exist stay as they are, so you can edit the bases and the documents. Two commands drive the module:

1. **Hello: new session** creates `hello/Session <time>.md` and opens it. Its properties link the policy, the promise, and the skill, and `greeting` is the module's own field, which you can change.
2. **Hello: run this session with Claude** or **with Codex**, with the session document open, runs the agent loop. The document shows the state, the deliverables, and the progress as the loop runs, and `internal/hello/logs/` has the full exchange.

A run does not ask for permissions. Requests that `edit` access does not allow are denied.

## Build a release

```sh
npm run build
```

This command type-checks `src/` and writes a minified `main.js`. A release contains `main.js` and `manifest.json`.
