# Consumer notes · duet-runtime

## Round 0 (library 0.9.1)

Built Duet on `createYami`, with workarounds for F0.1 (sync), F0.3 (resume), F0.4 (stop-mention), and F0.5 (mock classes). 1,934 lines.

## Round 1 (library 0.10.0)

Removed every round-0 workaround. `saveSettings` → `yami.setAgents(entries())`. The live options are functions. Mentions use `yami.noteSessions` (with `skills: []`). The ledger uses `hub.observe({ changed })`. The text ops come from `yami/document`, and the unit tests have no obsidian mock. Duet's ribbon icon is removed (Yami has one). ProfileAgents builds a new Agent when any profile field except name/color changes, and never closes agents itself. `plugin/src` has 1,808 lines.

Checks: typecheck, test (42), and plugin:build pass. test:obsidian: ids are now `duet:yami-*`, the status waits use `.yami-status.is-working`, and the Stop test waits for `claude working in Ideas`.

Own fix: the ledger now reconciles a loaded record to the text at share time, not to the latest text.

Open workarounds:
- F1.1 `liveSession` + `bind` in mentions.ts: the host's state for each session (tools bound to the replies).
- F1.2 ledger `changed`: `hub.get(path)` + its own text copy for `before`.
- F1.3 main.ts: the reduced-motion rule repeated for Duet's `Presence`.

Docs guesses (F1.4): noteSessions wires rename/delete by itself; the idle wait; concurrent `session()`; `save` ids. F1.5 nit: "Yami has no agents." on the ribbon.

## Round 2 (library 0.11.0)

Removed the F1.1, F1.2, and F1.3 workarounds. `MentionAgents(app, yami, { ids, save, profile })` makes its own `noteSessions` with `setup` (it gives a LiveSession as state; `started` subscribes). The WeakMap, `bind`, and `NoteTools.reset` are deleted. The ledger takes `before`/`note` from `changed`, and has no `hub` parameter. `new Presence(..., yami.animate)`. `plugin/src` has 1,792 lines. Checks: typecheck, test (42), plugin:build pass. No workaround is left.

The guard blocks reads of `.library-loop/sessions/...` through Bash. Use Read for the session files.

Open: F2.1 bug minor (`state?` in setup, but `NoteSession.state: State`), F2.2 nit (setup gives a path, and the hub takes a TFile).

Second pass of round 2 (the overseer's test:obsidian failed). Both causes were mine, not Yami's:
- The test helpers read `plugin.mentions.working`, which round 1 deleted. They now read `plugin.yami.works` and `plugin.yami.conversations.working`. Gap from Enter to `works`: 605 ms (new Claude), 86 ms (Codex).
- The Tag field lost typed keys when the window blurred, because the tab rendered again. `updateAfterTyping` now ignores a blur while the field stays `doc.activeElement`. The settings test sends that blur in the middle of the tag. Before the fix, the failure showed in 1 of 16 runs.
- I may run `npm run test:obsidian` myself (about 85 s a run).
- New: F2.3 nit (setAgents writes every composer again, 11 same-value mutations).

Next round, check:
- F2.1/F2.2/F2.3 answers. With a `file` in setup, drop `app` from MentionAgents.
- Run test:obsidian before the verdict. Grep the tests for each member that the round removes.
- Whether docs/design.md took the proposals.

## Round 3 (library 0.12.0)

F2.1 (probe now fails to compile, as wished), F2.2 (`setup({ file, agent })`, `app` dropped from MentionAgents), F2.3 (no call site) closed. No-agents: Duet needed no code. New Obsidian test (last in `settings`): Remove both profiles in the settings window, the active note shows `.yami-unavailable`, Enter sends nothing, Add agent → `agent2` continues the note's session. 22/22 pass.
- Own bug found: Obsidian keeps a group's `extraButtons` callbacks from the first render, so Remove by index removed nothing after an earlier removal. `removeAgent(profile)` now.
- Composer selectors must scope to `.workspace-leaf.mod-active`; earlier conversation notes stay open in tabs.
- `console.log` in Obsidian tests is not shown; write a probe's output to a file. No `git stash` (guard).
- `plugin/src` 1,792 lines. Open: F3.1 docs minor (composer classes undocumented).

Next round: F3.1 answer; whether docs/design.md took the proposals.
