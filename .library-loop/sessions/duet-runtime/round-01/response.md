# Response · round 1

verdict: ready

Yami 0.10.0. A plugin changes its agents with `yami.setAgents`, and `conversationFolder`, `idleMinutes`, and the new `animate` take a function that Yami reads at each use. `yami.addWork` puts a host's own agent work in the status bar and under `yami-stop`. `yami.noteSessions` gives one harness session for each note and agent. `hub.observe({ changed })` is a feed of the changes to shared notes. The text operations import from `yami/document`. Every command id of the library now starts with `yami-`. That is a break: see the CHANGELOG for the mapping.

## F0.1 · accepted · The agents of `createYami` cannot change after `onload`
`yami.setAgents(entries)` takes the entries of the `agents` option. It throws before it changes anything when two entries have one name. It sets the working directory, the tools, and the skills of each new agent. It adds and removes `yami-new-conversation-<name>` and `yami-run-session-<name>`, and updates the composers, the status bar, the sessions' acts, and `onSessionsChange`. `yami.agents` and `yami.registered` are now read-only lists, so a host does not change them by hand.

```ts
this.yami = createYami(this, { agents: this.agents.entries() });
// after a settings change:
this.yami.setAgents(this.agents.entries());
```

The answers to your three guesses:
- The conversation manager reads the agents at each use. A conversation with a new agent finds it by name. A note whose agent no agent has any more goes on with the first agent, as before. The README says so.
- A command of an agent finds the agent by its name when it runs, so an edited profile starts with its new program.
- `createYami` with zero agents is allowed. It adds no agent commands, and the ribbon icon shows `Yami has no agents.` Before, that click threw a TypeError.

A conversation's turn, a run, and a turn of `noteSessions` keep their agent until they end. After that, the agent session of an agent that is gone or replaced closes. The next message starts the agent of that name now, and continues the note's harness session when it can. An idle conversation closes such a session at once. `yami.close()` also closes the sessions of the removed agents. Delete `ProfileAgents.sync`'s splices, its commands, and its own closing of agents. Keep only the call to `setAgents`.

## F0.2 · accepted · The conversation folder and the idle minutes are fixed at `onload`, and conversations have no `animate`
These options take a value or a function: `conversationFolder`, `idleMinutes`, and the new `animate`. Yami reads the function at each use. The next conversation note goes in the new folder. The wiki leaves the new folder out at its next query: a changed `exclude` list now makes the index read the vault again. The next idle wait takes the new minutes. `animate` (default `true`) controls whether an agent's edits play as typing, in conversations and in every shared note. While the system asks for reduced motion, edits never play as typing, whatever `animate` gives. The wiki's `defaultAlgorithm` takes a function too.

```ts
createYami(this, {
  agents: this.agents.entries(),
  conversationFolder: () => this.settings.conversationFolder,
  idleMinutes: () => this.settings.idleMinutes,
  animate: () => this.settings.animate,
});
```

`modules`, `commands`, `statusBar`, and `folderColors` stay fixed at `createYami`, because they choose the parts of the plugin, not a value that a person tunes. The README says which options are live and which are fixed. Remove the README line that says these settings apply after a restart.

## F0.3 · accepted · No public way to resume a harness session, or to start a new one when the harness has lost it
`agent.resumeOrStart(options)` continues `options.resume` when the harness still has it. Otherwise it starts a new session with the same options. It resolves with `{ session, continued }`. If the new start also fails, it rejects once, with the error of the new start. The docs of `startSession` now say what a lost id does: `startSession({ resume })` rejects. Claude Code exits at its start, and Codex answers `no rollout found for thread id …`. The conversation notes and `noteSessions` use `resumeOrStart`.

```ts
const { session, continued } = await agent.resumeOrStart({ resume: saved, instructions, access: "read-only", tools });
```

The adapters cannot reliably tell a lost session from another failure, so a failed resume always tries one new start. A read-only refusal fails before any process starts, so the second try costs nothing, and the caller sees the error once. If you move to `noteSessions` (F0.9), you need neither call.

## F0.4 · accepted · A host's own agent work is not in Yami's status bar or its Stop command
`yami.addWork({ name, path?, stop? })` shows the work in the status bar until the function that it returns ends it. With a `path` and a `stop`, `yami-stop` in that note calls `stop`. The command is now named "Stop the agent in this note". A click on the status bar item opens the note where the agent works. With several agents working, a menu lists them. A turn of `noteSessions` adds its work by itself.

```ts
const end = this.yami.addWork({ name: profile.name, path: file.path, stop: () => session.interrupt() });
try { await session.send(prompt); } finally { end(); }
```

Remove `stop-mention`.

## F0.5 · accepted · The text ops cannot be imported without the Obsidian classes
`applyOps`, `deltaOps`, `diffOps`, `normalizeNewlines`, `shiftOps`, and `TextOp` now come from `yami/document`, which never loads `obsidian`. A library test proves it: its `obsidian` mock throws on any import. `yami/obsidian` still gives the same functions.

```ts
import { applyOps, deltaOps, diffOps } from "yami/document";
```

Drop the `SuggestModal` and `FuzzySuggestModal` mock classes. A test still needs them if the code under test imports `yami/obsidian` itself.

## F0.6 · accepted · The docs do not say what the conversation commands and the status bar do
The README has a table of every command of the library: its id, its name, when it shows in the palette, and what it does. The answers:
- `yami-stop` interrupts the turn of the note's conversation and drops its queued messages. It also calls the `stop` of each work of `addWork` in the note. It does not stop a session's run: `yami-stop-session` does.
- `yami-revert` undoes the last step of agent edits in the note. A step begins when an agent starts a turn in the note. The undo covers every agent that writes through an `AgentPeer` of the hub, a host's own peer too, if it calls `beginTurn` at each turn. It also covers the writes of an agent's file tools that the hub merges. It does not undo an agent's own output, such as a reply in a conversation note, or the person's typing. Your guess was right: it undoes a mention's edits.
- Id collisions: every library id now starts with `yami-` (`COMMAND_PREFIX`). Give your own commands ids that do not start with `yami-`. You can take back `stop`, `revert`, and `new-conversation`.
- The status bar item has the class `yami-status`, and `is-working` while an agent works. Its text is `claude working in Ideas` for one agent, `2 agents working` for several, and else `Checking <session>` while runs check. A click opens the note.

## F0.7 · accepted · The docs do not list the files that `createYami` writes into the vault
The README section "What `createYami` adds to a vault and to its agents" lists the 14 files that `enable` writes when the plugin has no modules. It also lists the nine tools of the `yami` tool set, and the two skill sets, `internal/yami` and `internal/wiki`. A library test pins all three lists, so the docs cannot drift from the code. Note: the wiki's policies and promises are `cite-every-claim`, `one-plan`, `one-topic`, `change-applied`, `clean-topics`, and `sources-absorbed`, and the ingest skill's briefs are `drafter.md`, `extractor.md`, and `page-forms.md`.

## F0.8 · declined · A plugin with no modules cannot leave out the wiki's files, tools, and skills
The overseer's ruling holds: the wiki is built in, with one instance for the vault, so no option turns it off. The general part is accepted. A session that a host starts sets its own `tools` and `skills`, and they replace the agent's. They do not add to them. `skills: []` gives a session no skill set. The docs of `AgentPreferences`, `SessionStart`, and the README now say so, and a test covers it.

```ts
await agent.startSession({ instructions, access: "read-only", tools: noteTools, skills: [] }); // no /yami:run, no /wiki:ingest
```

## F0.9 · accepted · A note-scoped agent session is Duet's code, and any agent that works in a note needs it
`yami.noteSessions({ ids, save, idleMinutes })` gives one harness session for each note and agent. `notes.session(path, agent?, options?)` gives `{ session, continued }`. The session is the open one, or a new one that continues the session the host stored, or a fresh one when the harness lost it. `continued` is false only for a fresh session, so the host then sends the whole context. The call that starts a session gives its options. A session closes after the idle minutes with no turn. It follows a renamed note or folder, and is forgotten when its note is removed. It follows `setAgents` and closes when the plugin unloads. Each turn shows as work in the status bar and stops with `yami-stop`. You store the ids: give the stored ones in `ids`, and `save` gets every id after each change. `notes.forget(path)` closes a note's sessions and drops their ids.

```ts
const notes = this.yami.noteSessions({ ids: data.sessions, save: (ids) => this.persist(ids), idleMinutes: () => this.settings.idleMinutes });
const { session, continued } = await notes.session(file.path, profile.name, { instructions, access: "read-only", tools, skills: [] });
await notes.forget(file.path);
```

As the ruling asked, it is one mechanism: the conversation notes now use the same session slot, with the id in the note's `session` property. The trigger of a session, and its words, stay in your plugin.

## F0.10 · accepted · The feed of agent-written changes in a shared note is Duet's code
`hub.observe({ changed })` calls `changed({ path, ops, agent })` at each change of a shared note's text. The ops apply to the text before the change. `agent` is the `{ name, color }` of the agent that made the change: an edit, a merged write of its tools, or its own output. It is absent for the person's typing and for another program's write. No Yjs type is in the signature. Every member of `HubObserver` is now optional.

```ts
this.yami.hub.observe({ changed: ({ path, ops, agent }) => ledger.record(path, ops, agent) });
```

The feed covers a note while it is shared, as the hub's notes always were.

## F0.11 · accepted · `pluginBuild` makes `plugins` optional, and `copyStyles` writes one file
A second plugin that installs into a test vault needs both, so they pass the generality test. `pluginBuild({ production, plugins })` adds your esbuild plugins after Yami's, and its return type says `plugins` is there. `copyStyles` takes one path or several.

```js
await context({ ...pluginBuild({ production, plugins: [install] }), entryPoints, outfile });
await copyStyles(targets.map((t) => path.join(t, 'styles.css')), ['plugin/styles.css']);
```

## F0.12 · declined · `AgentEntry` and `ConversationAgent` are two names for one thing
They are two types on purpose: `AgentEntry` is what a host gives, with an optional name and color, and `ConversationAgent` is what Yami gives back, with both filled in. With one type of optional fields, every reader of `yami.registered` would have to handle a missing name. Your code already works: a `ConversationAgent` is a valid `AgentEntry`, so pass it as it is. The doc comment of `AgentEntry` now names the relation.

## Policy
Proposed changes to `design.md`, for the user to approve:
- **Layers, item 10:** replace "Some files in it do not need Obsidian, for example `collab/text-ops.ts`. A plain build can move them below." with "The text operations live in `yami/document`, because they need no Obsidian. A plain helper of the Obsidian layer moves below it when a plugin's tests need it without Obsidian."
- **Layers, item 9:** add "When its agents change, a plugin calls `yami.setAgents`. Every command id of the library starts with `yami-`, and a plugin's own ids never do."
- **The library and the plugin, item 2:** add `yami.setAgents`, `yami.addWork`, `yami.noteSessions`, and `hub.observe` to the public API that a plugin uses.
- **Conversations and shared documents:** add "4. A host's agent work outside conversation notes and runs shows the same: `addWork` puts it in the status bar and under the Stop command, and `noteSessions` gives one harness session for each note and agent. A conversation note uses the same session mechanism."

This change breaks the showcase's Obsidian tests, which I did not edit, as R6 requires: `obsidian_plugin/test/obsidian/plugin.test.ts` runs the library's commands by their old ids. Each library id there takes the prefix: `yami:new-conversation-claude` → `yami:yami-new-conversation-claude`, `yami:wiki-search` → `yami:yami-wiki-search`, `yami:hello-new-greeting` → `yami:yami-hello-new-greeting`, `startsWith("yami:hello-")` → `startsWith("yami:yami-hello-")`, and so on, 36 references in all. The showcase's own `yami:open-panel` and `yami:open-wiki-navigator` stay, and so does the skill command `/yami:run` on line 842, which is no command id. The showcase's build and unit tests pass with no change. I did not run `npm run test:obsidian` or the live tests.
