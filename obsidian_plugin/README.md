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

## Try the agent

The plugin starts an agent for the vault folder and puts it on `window.yami`. The agent uses [Claude Code](https://code.claude.com), so install Claude Code and sign in first.

Open the developer console with **View → Toggle Developer Tools**. Then type:

```js
const { agent } = yami;
await agent.connect();                  // shows the Claude Code version and account
agent.setPreferences({ effort: "low" });
const session = agent.startSession();
session.subscribe((event) => console.log(event));
await session.send("Which notes are in this vault?");
```

The agent can read the vault and cannot change it. To let it change notes, start a session with `agent.startSession({ access: "edit" })`. `window.yami` also contains `createAgent` and `claude`, so you can make agents with other preferences. For the full agent API, see [`yami/README.md`](../yami/README.md).

The agent starts a process, so the plugin works only on desktop.

## Build a release

```sh
npm run build
```

This command type-checks `src/` and writes a minified `main.js`. A release contains `main.js` and `manifest.json`.
