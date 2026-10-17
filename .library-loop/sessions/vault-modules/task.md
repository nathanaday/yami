# Task: Hello as a vault module

The plugin has a module written in code, `src/modules/hello/`. Replace it with a module defined in the vault, so that the plugin shows that a module can be markdown only. The library now finds modules in the vault and runs them; its docs tell you how.

## Build

1. **Remove the code module.** Delete `src/modules/hello/` and remove it from `createYami` in `src/main.ts`.
2. **Hello in markdown.** Write Hello as a vault module in `test/fixtures/vault-modules/hello/`, in the layout of the vault, so a test can copy it into a vault. Keep what Hello does now:
   - the module's name, description, and icon (`hand`);
   - one template, "Greeting", with the session field `greeting` (default `Hello`);
   - the policy "Always say hello", the promise "Greeting note" with its `exists` check, and the skill `greeting`, all with their current text.

   The `greet_user` tool has no place in a vault module, so it goes.
3. **The panel.** The panel shows a vault module the same way it shows any module. It shows a module when the module appears, and removes it when the module goes, with no reload. It shows a module's problems, so that a person can fix a broken template. It shows a session's review phase and the review's verdicts. Use the library's API for each of these things. Write no logic that a second plugin would need.
4. **Tests.**
   - A unit test copies the Hello fixture into a vault made with `yami/testing`. It checks that the module is found, creates a Greeting session, and runs it with a scripted agent through the review to `done`.
   - A second unit test breaks the template and checks that the problem is reported and that the other modules still work.
   - Update the Obsidian tests in `test/obsidian/plugin.test.ts` that use the code Hello module:
     - Create the module with the library's new module command, then write the Hello fixture over it.
     - Check that the module shows in the panel with no reload.
     - Run a Greeting session with Claude through the review to `done`.
     - Delete the module's folder, and check that the module and its command go away.
     - Point the test that calls a module tool from both agents at another module's tool.
5. **README.** Explain how a person defines a module in the vault, with Hello as the example.

## Acceptance

1. `npm run build` and `npm test` pass in `obsidian_plugin/`.
2. `src/modules/hello/` does not exist. Only tests, fixtures, and the README name the Hello module.
3. The plugin has no branch on whether a module came from the vault, except to show it.
4. The unit test runs the Hello fixture to `done` with review verdicts in the session document.
5. `npm run test:obsidian` passes. It needs a real Claude and Codex; the overseer runs it at the end.
6. In Obsidian, the Hello module shows in the panel after its files are written. It goes away from the panel and the command palette after its folder is deleted. Neither step needs a reload.
