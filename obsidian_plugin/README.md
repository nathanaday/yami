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

Install the harness that you want to use, and sign in to it first.

Open the developer console with **View → Toggle Developer Tools**. Then type:

```js
const agent = yami.claude;              // or yami.codex
await agent.connect();                  // shows the harness version and account
agent.setPreferences({ effort: "low" });
const session = agent.startSession();
session.subscribe((event) => console.log(event));
await session.send("Which notes are in this vault?");
```

The agents can read the vault and cannot change it. To let an agent change notes, start a session with `agent.startSession({ access: "edit" })`. To make an agent with other options, use `new yami.ClaudeAgent({ ... })` or `new yami.CodexAgent({ ... })`. For the full agent API, see [`yami/README.md`](../yami/README.md).

The agents start processes, so the plugin works only on desktop.

## Build a release

```sh
npm run build
```

This command type-checks `src/` and writes a minified `main.js`. A release contains `main.js` and `manifest.json`.
