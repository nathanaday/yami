# Task: the showcase on the built-in modules

The library now holds the threads module and the checkout (a flow of the wiki module) itself, and the journals module is gone from the design. Bring the showcase plugin, `obsidian_plugin/`, onto that library, and show its new parts in the real app.

Read `design.md` first: "The library and the plugin", "Vault flows in a code module", "The wiki" items 12 to 14, and "The built-in modules".

## What to build

1. **No module of the plugin's own.** Remove `src/modules/threads`, `src/modules/librarian`, and `src/modules/journals`, with their unit tests and the live thread test. `src/main.ts` gives `createYami` the agents, and no module. Threads and the wiki come from the library. Keep the Hello fixture and its test.
2. **The views.** The panel and the wiki navigator work with the modules as the library gives them now: the wiki, threads, and any vault module. They show the new commands' results, such as a session of the person's own flow, with no special case.
3. **The Obsidian tests** (`test/obsidian/`). Change them to match, and add these:
   - The module install writes `internal/wiki/wiki.md` and `internal/threads/threads.md`, and no `librarian/`, `journals/`, or `internal/journals/`.
   - Each of `Threads: create agent`, `create flow`, `create policy`, `create promise`, and `create skill`, run from the command palette with a name typed, writes the form under `internal/threads/<agents|flows|policies|promises|skills>/<name>/` and opens it, and `yami.problems` stays empty.
   - After `Threads: create flow`, `Threads: create a flow session` offers that flow, creates its session in `threads/`, and opens it; the panel lists the session under Threads.
   - A checkout made with `wiki_checkout`, a copy edited by the user, and `Wiki: return this checkout` bring the edit into the wiki, with the reading list in `internal/wiki/sessions/`.
   - A conversation still works in a note: an agent edit merges with the user's typing, as the current tests show.
   - Remove the journal publish and every expectation about the librarian and journals.
4. **The README** of the plugin says what the showcase shows now: the built-in wiki and threads, the commands of item 3, the checkout, the vault module Hello, and the views. Nothing about journals or the librarian.

The plugin writes no code for Yami beyond `main.ts` and its views (`design.md`, The library and the plugin, item 2). When the plugin needs something the library does not give, that is feedback.

## Acceptance

1. `npm run build` and `npm test` pass in `obsidian_plugin/`.
2. `npm run test:obsidian` passes in `obsidian_plugin/` (build first).
3. `grep -rniE "journal|librarian" obsidian_plugin/src obsidian_plugin/test obsidian_plugin/README.md` finds nothing.
4. `obsidian_plugin/src/modules/` does not exist, and `src/main.ts` passes no module to `createYami`.
5. No file of the plugin imports from `yami/src`.
