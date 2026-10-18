# Consumer notes · duet-runtime

## Round 0 (library 0.9.1)

Built: Duet on `createYami` (`plugin/src/main.ts`), with profile agents from `ProfileAgents.entries()`. Mentions use `yami.hub`, with no prompts (read-only asks for nothing). The ledger observes `yami.hub`. The API goes through `yami.conversations`. `scripts/plugin.mjs` uses `pluginBuild` and `copyStyles`. `esbuild-options.mjs` is deleted. `plugin/src` has 1,934 lines (2,023 at the start).

Checks: typecheck, test (42), and plugin:build pass. test:obsidian is not run (the overseer runs it). It has a new settings test, "offers a new agent as a command and a mention tag with no reload", plus a status-bar wait in the first conversation test. The status-bar check guesses `.status-bar-item` with the text /claude/.

Workarounds to remove when the library delivers:
- F0.1 `ProfileAgents.sync` (agents.ts): mutates `yami.registered` and `yami.agents`, and adds its own `new-conversation-<tag>` commands.
- F0.3 `startSession` resume fallback (agents.ts).
- F0.4 the `stop-mention` command (main.ts).
- F0.5 the mock classes `SuggestModal` and `FuzzySuggestModal` in the two unit tests.

No workaround, but the README says so: F0.2 (folder, idle minutes, animate).

Command ids changed: new-chat → new-conversation-claude, end-chat → Yami's end-conversation, stop → stop-mention, new-conversation → forget-mentions. Duet's revert is removed (Yami's `revert`, same id, guessed to cover mentions).

Next round, check:
- Live agents and options in createYami (F0.1, F0.2). Then delete `sync`, and pass functions.
- A public resume-or-start (F0.3), and Yami's status bar and stop for host work (F0.4).
- A plain import of the text ops (F0.5). Then restore the mock to `{ Modal }`.
- The command docs (F0.6): verify the revert and stop guesses, and the README names.
- Rulings on F0.8 (turn off the wiki), F0.9 (note sessions), and F0.10 (the edit feed).
