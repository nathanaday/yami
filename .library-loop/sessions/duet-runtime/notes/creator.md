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

## Round 3 (0.12.0)
Decided (all three accepted, per the ruling, and the overseer's no-agents item):
- F2.1: `NoteSessionSetup<State>` is a type: `state` required when `undefined extends State` is false. Inference still works (probed with tsgo). `npm test` now runs `tsc -p tsconfig.test.json` first, so `@ts-expect-error` cases are real tests. Fixed 6 old type errors in tests (reads, wiki, manager).
- F2.2: `NoteAgent.file: TFile`, looked up in `options()` before the start; `There is no note at <path>.` rejects otherwise (BREAK). Host gets `file(path)`.
- F2.3: composer `draw(part, value, write)` writes a part only when its value changes. Test: `test/unit/obsidian/composer.test.ts` over happy-dom (new devDependency), set up by hand in a node env, with Obsidian's DOM helpers polyfilled.
- No agents: `controller.registered` is `| undefined` (BREAK), `harness` too. While a session is open, `registered` is the session's agent (by `SessionSlot.agent`), else `#chosen()`. `unavailable` gives `noAgents` text (`noAgentsMessage(manifest.name)`, also the ribbon's). Composer shows `.yami-unavailable`, keeps the draft, disables Send.

Watch next round:
- The new CSS for `.yami-unavailable` and the no-agents flow are not run in real Obsidian by me. The consumer's test:obsidian may show it.
- Retired agents still never prune. The showcase has no use of noteSessions or animate (Policy item, for the user at the end).

## Round 4 (0.13.0)
Decided (F3.1 accepted, per the ruling):
- README table "The message box" under Conversation notes: the root and its states, input, chips, status, Send (`is-stop`, aria-label, disabled rule = `!stop && (!text || unavailable)`), the unavailable and ended texts, `.yami-approval`, suggestions. All other classes in `.yami-composer` are internal.
- Added `data-setting` (`model|effort|approval`, typed) on chips and `data-decision` (a `PermissionDecision`) on approval buttons. Chose attributes over modifier classes: they name a value, and `yami-approval` was already the request panel.
- Contract test in `composer.test.ts` walks every row. Nothing breaks.
- Policy proposal: names that the README gives a host are public API (Documentation item 4).

Watch next round:
- The consumer should move to the documented selectors and test Send disabled with no agents. A row that is wrong in real Obsidian is a bug in the table.
- Retired agents still never prune.

## Round 5 (0.14.0, last round)
Decided (F4.1 and F4.2 accepted, per the ruling):
- F4.1: README tables "The agent's questions" (after the message box) and "The agent's presence" (Shared documents). Added `data-action="back|skip"` on the question form's buttons; Next/Answer stays `button[type="submit"]`. The PermissionPrompts dialog stays internal. Kept `is-near-top`, `is-near-right`, `has-status`, `.yami-presence` internal.
- Tests: `test/unit/obsidian/dom.ts` (`installDom`, shared by composer and presence tests). `presence.test.ts` runs a real EditorView over happy-dom with stubbed rects (no layout in happy-dom; `Window` must be a global for CodeMirror's measure).
- F4.2: README `start` bullet lists the guarantees; doc comments in manager.ts. Tests in `manager.test.ts` "the guarantees of start, status, and onTurnEnd".
- Known wart, documented, not fixed: a `title` in the placeholder form `New conversation <YYYY-MM-DD HHmm>` is renamed by its first message (`isUnnamed` checks the name only). No second program wants such a title.

Open after the session:
- Retired agents still never prune.
- Policy items for the user: the Duet design.md sentence (F4.2), and the earlier showcase items.
