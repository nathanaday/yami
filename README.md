# Yami

A hello world Obsidian plugin. It adds a ribbon icon and a "Say hello" command. Both show a "Hello, world!" notice.

## Develop

1. Install the dependencies:

   ```sh
   npm install
   ```

2. Link this repository into the plugins folder of a test vault:

   ```sh
   ln -s "$PWD" /path/to/vault/.obsidian/plugins/yami
   ```

3. Start the watch build. esbuild writes `main.js` again each time you change a file in `src/`:

   ```sh
   npm run dev
   ```

4. In Obsidian, open **Settings → Community plugins** and turn on **Yami**. To load your changes, turn the plugin off and on again, or run the command **Reload app without saving**.

## Build a release

```sh
npm run build
```

This command type-checks `src/` and writes a minified `main.js`. A release contains `main.js` and `manifest.json`.
