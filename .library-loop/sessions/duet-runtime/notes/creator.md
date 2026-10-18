# Creator notes · duet-runtime

## Round 1 (0.10.0)
Decided:
- F0.1: `setAgents` in core `Yami` (private `#setAgents` from the constructor, so a subclass override never runs early) and in `ObsidianYami` (names, colors, command sync, `agentsChanged`). Removed agents go to a retired list: live runs keep them, `close()` closes them, and run conversations pin their agent (`controller.pinned`), cleared at the run's `close()`.
- F0.2: live options = `conversationFolder`, `idleMinutes`, `animate` (ANDed with prefers-reduced-motion), and the wiki's `exclude` (index now goes stale when the list changes) and `defaultAlgorithm` (`wiki.defaultAlgorithm`). `modules`, `commands`, `statusBar`, and `folderColors` stay fixed: they choose parts, and a function gives no change signal.
- F0.3: `agent.resumeOrStart` returns `{ session, continued }`. It always retries once, because the adapters cannot tell a lost session from other failures.
- F0.4: `addWork` / `works`. The status bar counts conversations + works, and else runs. Click opens the note, or a Menu when there are several. `yami-stop` also calls work.stop in the note.
- F0.5: text-ops moved to `src/document/text-ops.ts`. `yami/obsidian` still re-exports them.
- F0.9: `SessionSlot` in `src/obsidian/note-sessions.ts`, shared by `ConversationController` and `NoteSessions`. The call that starts a session gives its options. A stale agent's session closes after its turn (deferred with setTimeout 0, so the controller sees turn-end first).
- F0.10: `HubObserver.changed({ path, ops, agent })`. All members are optional now.
- R4: every command id has the `yami-` prefix (`COMMAND_PREFIX`), and the `commandGroup` helper syncs dynamic groups. This BREAKS the showcase's test:obsidian (36 refs). I flagged it under Policy and did not edit it.
- Declined F0.12 (input vs resolved type) and F0.8, per the ruling (only the replace-semantics docs).

Watch next round:
- Did the overseer update the showcase obsidian tests for the prefix? Did the consumer migrate its hotkeys and tests?
- The consumer may contest the F0.2 line (statusBar and folderColors fixed).
- Retired agents are never pruned (small leak). Fix it if anyone notices.
- NoteSessions `renamed` / `removed` / `agentsChanged` are public on the type but internal in intent.
- The design.md policy proposals wait for the user.

## Round 2 (0.11.0)
Decided (all five accepted, per the ruling):
- F1.1: `setup(note) => { options?, state?, started? }` in `NoteSessionsOptions<State>`, once per harness session (SessionSlot reads `options()` inside `#start`). `session(path, agent?)` gives `{ session, continued, state }`, and the state is kept in a WeakMap by session. BREAK: no third `options` arg. Chose `setup` over the consumer's `start`, because it starts nothing.
- F1.2: `NoteChange.note` and `.before` (the hub tracks the text, which costs one `toJSON` per change). The order contract: observe() replays `shared` for notes that are shared; unsubscribe runs their stops; no `changed` after dispose.
- F1.3: `yami.animate` is a bound arrow field. No `presence()` factory.
- F1.4: the README table. Bug fixed: the SessionSlot fast path cleared the idle timer and never re-armed it. `renamed`/`removed`/`agentsChanged` are private now, through `NoteSessionsHost.follow(events)` (BREAK).
- F1.5: `<manifest.name> has no agents. Add one in its settings.` only in commands.ts. API errors keep "Yami has no agents."
- Audit: the CHANGELOG headings say "runtime agents and options", not the slug.

Watch next round:
- Not verified: the composer's `render` reads `controller.registered`, which throws when no agents are left. An open conversation note after `setAgents([])` may break. Write a test with a real composer before you fix it.
- The consumer may want `TFile` in `setup`. I gave a path on purpose.
- Retired agents still never prune. The showcase has no use of noteSessions or animate (Policy item).
