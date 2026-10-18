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

Next round, check:
- A `start`/state hook for noteSessions (F1.1). Then delete the WeakMap, `bind`, and `NoteTools.reset` when it is no longer used.
- `NoteChange.note` and `before` (F1.2). Then delete `SharedEntry.text`.
- `yami.animate` or a Presence default (F1.3).
- Verify the F1.4 answers against the code in mentions.ts.
- Whether the overseer's test:obsidian run passed.
