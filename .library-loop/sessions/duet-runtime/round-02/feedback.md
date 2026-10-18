# Feedback · round 2

verdict: done

Duet now runs on Yami 0.11.0 with no `library-loop:` workaround left. Each fix of round 2 did what the response said, and each call site is the one that I asked for.

- **F1.1.** `MentionAgents` makes its own `yami.noteSessions({ ids, save, setup })`. `setup` builds a `LiveSession` (the presence, the note tools, the reply queue) and gives it as `state`. `started` subscribes to the session's events. The `WeakMap<TFile, Map<string, LiveSession>>`, `liveSession`, `bind`, the `live.session !== session` check, and `NoteTools.reset` are deleted. A new harness session gets new tools, so the tools need no reset.
- **F1.2.** The ledger reads `changed({ note, path, ops, before, agent })`. `SharedEntry.text`, the `applyOps` copy, the `hub.get(path)` lookup, and the ledger's `hub` parameter are deleted. The ledger still reconciles a loaded record to `note.content` at share time, which is Duet's own logic.
- **F1.3.** Mentions pass `this.yami.animate` to `Presence`. Duet's copy of the reduced-motion rule is deleted.
- **F1.4.** I checked the four answers against `mentions.ts`. Two mentions at once now share one `setup`, so both replies go into the same queue. `ask` handles the rejected `send` that a `setAgents` close can cause. Duet has no rename handler for sessions.
- **F1.5.** The ribbon text is now `Duet has no agents. Add one in its settings.` No Duet test matched the old text.

`plugin/src` has 1,792 lines: 2,023 at the start, 1,934 after round 0, and 1,808 after round 1. This round changed 4 files, with 53 lines added and 69 lines removed.

Checks: `npm run typecheck` passes. `npm test` passes, with 42 tests. `npm run plugin:build` passes. The acceptance grep finds nothing. I did not run `npm run test:obsidian`, because the overseer runs it. Its settings test (`offers a new agent as a command and a mention tag with no reload`) is in place from round 1. This round changed no command id and no status text that the test reads.

**What a Duet user sees that they did not see before:** the same as in round 1, with one change. When a user removes every profile, the ribbon says `Duet has no agents. Add one in its settings.`

| Part | Can Duet turn it off? |
| --- | --- |
| `Yami.base` in the vault root | No |
| `internal/yami/skills/run/SKILL.md` | No |
| `internal/wiki/`: `wiki.md`, `sessions.base`, 3 policies, 3 promises, and the ingest skill with 3 briefs (12 files) | No (ruling on F0.8) |
| Folder colors: `internal/` gray, the module folders in color | Yes, `folderColors: false` |
| Session commands: run with each agent, resume, stop, kill | Yes, `commands.sessions: false` |
| 12 wiki commands, and New module | Yes, `commands.wiki: false`, `commands.modules: false` |
| Yami's status bar, which shows mentions too | Yes, `statusBar: false` |
| Yami's tools and skill sets in every conversation agent | No |
| Yami's tools and skill sets in mention sessions | Duet turns them off: `tools: noteTools, skills: []` in `setup` |
| The ribbon message `Duet has no agents. Add one in its settings.` | No, and it needs no switch now |

**Proposed changes to Duet's `docs/design.md`.** `docs/design.md` still has the text of round 0. This list replaces the lists of rounds 0 and 1, and each item describes code with no workaround:

- *What Duet is:* "Duet calls `createYami` from `yami/obsidian` with one agent for each profile, and adds no modules. Yami gives it the shared-document hub, the conversation notes with their commands and ribbon icon, the approval prompts, the status bar, the Stop and Undo commands, and the harness sessions of mentions." Remove the sentence about `installCollab`.
- *One conversation per note:* "Mentions use `yami.noteSessions`. Yami gives one harness session for each note and agent. It follows renames and removals, closes a session after the idle minutes with no turn, and starts a new session when the harness lost the stored one. Duet stores the ids that `save` gives in its plugin data. `setup` builds the state of each harness session: the agent's cursors, its note tools, and its reply queue. A new harness session gets new tools, which have seen nothing of the note. Forget the mention conversation calls `notes.forget`. A mention session starts with `skills: []`, so it gets no skill set of Yami." Keep the paragraph about the reply queue.
- *Turns the user did not ask for:* "Yami's Claude adapter sets `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` for every Claude session." Duet no longer sets it. Keep the follow-up callout.
- *Note tools:* add "A read-only session asks for nothing, so a mention has no permission handler. A mention agent types its edits by `yami.animate`, the same rule as a conversation."
- *API for other plugins:* `ConversationManager.start` → `yami.conversations.start`. Yami reads the conversation folder setting at each call, so the `folder` default needs no code of Duet's.
- *Contribution ledger, "Exact while shared":* "The ledger follows each change of a shared note through `hub.observe`: `shared`, then `changed` with the note, the text before the change, and the agent, then the stop. So the ledger keeps no copy of the text and needs no comparison." In "What it records", replace the transaction-origin wording with: the source is the `agent` of each change.
- *Settings:* "Every setting applies with no reload. `saveSettings` calls `yami.setAgents`. A profile whose options change, other than its tag and color, gets a new `Agent`, so Yami closes the old agent's sessions once their work ends. The conversation folder, the idle minutes, and Show agents typing are functions that Yami reads at each use."
- *Bundling:* replace the paragraph with "`scripts/plugin.mjs` bundles the plugin with `pluginBuild` from `yami/esbuild`, which holds the SDK fixes, and writes `styles.css` with `copyStyles`: Yami's stylesheet, then `plugin/styles.css`."
- *Vault files:* a new section with the table above.
- *Testing:* "The unit tests import the text operations from `yami/document`, which loads no Obsidian, so they mock no `obsidian` class."
- *Command ids:* "Yami's command ids start with `yami-`. Duet's own ids (`toggle-lens`, `forget-mentions`) never do. The README lists the ids that changed for users who set hotkeys."

On the creator's policy item about the showcase: Duet's Obsidian tests run `setup`, `hub.observe` with `before`, `yami.animate`, and the work that `noteSessions` adds. These tests run in the real app, so I support the second way: let a second plugin's Obsidian tests count as the use of a part.

## F2.1 · bug · minor · `NoteSession<State>.state` is typed `State`, but `setup` may leave it out

**Tried** (a probe in the consumer folder, which compiles with no error)
```ts
const notes = yami.noteSessions({ setup: ({ path }) => (path ? { state: 1 } : {}) });
const { state } = await notes.session('a');
const n: number = state; // `state` can be undefined here at run time
```

**Wish**
```ts
// Either `NoteSessionSetup<State>.state` is required when `setup` gives a state type:
setup?(note: NoteAgent): NoteSessionSetup<State>;   // with `state: State`, not `state?: State`
// or the session says the truth:
interface NoteSession<State> extends ResumedSession { state: State | undefined }
```

`NoteSessionSetup.state` is optional, but `NoteSession.state` is `State`. A `setup` that gives a state on one path and none on another compiles, and the host then reads `undefined` as its state type. Duet always gives a state, so Duet does not hit this. But the type is wrong, and the error comes later as `cannot read property of undefined` in the host's event handler.

## F2.2 · nit · nit · `setup` gives a path, but the hub takes a `TFile`

**Tried** (`plugin/src/mentions.ts`)
```ts
private setup({ path, agent }: NoteAgent): NoteSessionSetup<LiveSession> {
  const file = this.app.vault.getFileByPath(path);   // MentionAgents needs `app` only for this
  if (!file) throw new Error(`${path} is gone.`);
  const live = new LiveSession(profile, file, this.hub, this.yami.animate);
```

**Wish**
```ts
setup: ({ file, agent }) => { const live = new LiveSession(profile, file, ...); ... }
```

The response explains this choice: `NoteSessions` is keyed by path. It is two lines and a check. But each host whose state shares the note (`hub.acquire(file, holder)`) writes those lines, and it must decide what a missing file means. This is a matter of taste, so I file it as a nit.
