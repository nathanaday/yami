# Feedback · round 1

verdict: done

Duet now runs on Yami 0.10.0 with no workaround of round 0 left. `ProfileAgents.sync` is gone: `saveSettings` calls `yami.setAgents(this.agents.entries())`. `conversationFolder`, `idleMinutes`, and `animate` are functions. Mentions get their harness sessions from `yami.noteSessions`, so Duet's own id index, rename handling, idle timer, resume fallback, `closeIdle`, `closeAll`, and `stop-mention` are deleted. Yami's status bar shows a mention, and `yami-stop` stops it. The ledger hears changes through `hub.observe({ changed })` and imports no Yjs type. The text ops come from `yami/document`, so both unit tests mock no `obsidian` class at all. `scripts/plugin.mjs` passes its install plugin to `pluginBuild` and gives `copyStyles` every target at once. Duet's own ribbon icon for a new conversation is removed, because Yami adds the same icon. A replaced profile now builds a new `Agent` (any field but the tag and the color), so Yami closes the idle sessions of the old agent, and the next message starts the new one. Duet no longer closes any agent itself.

`plugin/src` has 1,808 lines: 2,023 at the start, and 1,934 after round 0.

Checks: `npm run typecheck` passes. `npm test` passes, with 42 tests. `npm run plugin:build` passes, with no `new Function` in the bundle. The acceptance grep finds nothing. I did not run `npm run test:obsidian`, because the overseer runs it. I updated it for the new ids (`duet:yami-new-conversation-<tag>`, `duet:yami-revert`, `duet:yami-stop`). The status-bar waits now use `.yami-status.is-working` and its documented text. The Stop test first waits for `claude working in Ideas`, which checks that a mention shows in Yami's status bar.

What went well: each fix of round 1 did what the response said, and the call sites are the ones that I asked for. `setAgents`, the live options, `resumeOrStart`, `yami/document`, `pluginBuild({ plugins })`, and the command table each removed a workaround with one line or none. The `yami-` prefix removed my guesses about id collisions. The README's command table answered every question of F0.6.

I accept the declines of F0.8 and F0.12. `skills: []` in each mention session takes Yami's skill sets out of mentions, which was the part of F0.8 that hurt.

A fix of Duet's own, found during the move: the ledger brought a loaded record up to the text at the time of the change that came last, and then applied the queued changes, which are on the older text. It now brings the record up to the text at share time.

**What a Duet user sees that they did not see before:** the same list as in round 0, with two changes. Mentions now show in the status bar, and a mention agent no longer gets Yami's skill sets.

| Part | Can Duet turn it off? |
| --- | --- |
| `Yami.base` in the vault root | No |
| `internal/yami/skills/run/SKILL.md` | No |
| `internal/wiki/`: `wiki.md`, `sessions.base`, 3 policies, 3 promises, and the ingest skill with 3 briefs (12 files) | No (ruling on F0.8) |
| Folder colors: `internal/` gray, the module folders in color | Yes, `folderColors: false` |
| Session commands: run with each agent, resume, stop, kill | Yes, `commands.sessions: false` |
| 12 wiki commands, and New module | Yes, `commands.wiki: false`, `commands.modules: false` |
| Yami's status bar, which now shows mentions too | Yes, `statusBar: false` |
| Yami's tools and skill sets in every conversation agent | No |
| Yami's tools and skill sets in mention sessions | Duet turns them off: `tools: noteTools, skills: []` |
| The ribbon message `Yami has no agents.` when a user removes every profile | No (F1.5) |

**Proposed changes to Duet's `docs/design.md`.** This list replaces the list of round 0. Every item now describes code with no workaround:

- *What Duet is:* "Duet calls `createYami` from `yami/obsidian` with one agent for each profile, and adds no modules. Yami gives it the shared-document hub, the conversation notes with their commands and ribbon icon, the approval prompts, the status bar, the Stop and Undo commands, and the harness sessions of mentions." Remove the sentence about `installCollab`.
- *One conversation per note:* "Mentions use `yami.noteSessions`. Yami gives one harness session for each note and agent, follows renames, closes an idle session after the idle minutes, and starts a new session when the harness lost the stored one. Duet stores the ids that `save` gives in its plugin data. Forget the mention conversation calls `notes.forget`. A mention session starts with `skills: []`, so it gets no skill set of Yami." Keep the paragraph about the reply queue.
- *Turns the user did not ask for:* "Yami's Claude adapter sets `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` for every Claude session." Duet no longer sets it. Keep the follow-up callout.
- *Note tools:* add "A read-only session asks for nothing, so a mention has no permission handler."
- *API for other plugins:* `ConversationManager.start` → `yami.conversations.start`. Yami reads the conversation folder setting at each call, so the `folder` default needs no code of Duet's.
- *Contribution ledger, "Exact while shared":* "The ledger follows each change of a shared note through `hub.observe({ changed })`, with the agent that made it, so no comparison is needed." Remove "Yjs change" and the transaction-origin wording from "What it records". Say instead: the source is the `agent` of each change.
- *Settings:* "Every setting applies with no reload. `saveSettings` calls `yami.setAgents`. A profile whose options change, other than its tag and color, gets a new `Agent`, so Yami closes the old agent's sessions once their work ends. The conversation folder, the idle minutes, and Show agents typing are functions that Yami reads at each use."
- *Bundling:* replace the paragraph with "`scripts/plugin.mjs` bundles the plugin with `pluginBuild` from `yami/esbuild`, which holds the SDK fixes, and writes `styles.css` with `copyStyles`: Yami's stylesheet, then `plugin/styles.css`."
- *Vault files:* a new section with the table above.
- *Testing:* "The unit tests import the text operations from `yami/document`, which loads no Obsidian, so they mock no `obsidian` class."
- *Command ids:* "Yami's command ids start with `yami-`. Duet's own ids (`toggle-lens`, `forget-mentions`) never do. The README lists the ids that changed for users who set hotkeys."

## F1.1 · ergonomics · minor · `noteSessions` has no place for the host's state of each session

**Tried** (`plugin/src/mentions.ts`)
```ts
// library-loop: F1.1
private liveSession(file: TFile, profile: AgentProfile): LiveSession {
  let byAgent = this.live.get(file);                 // WeakMap<TFile, Map<string, LiveSession>>
  if (!byAgent) this.live.set(file, (byAgent = new Map()));
  let live = byAgent.get(profile.name);
  if (!live) byAgent.set(profile.name, (live = new LiveSession(profile, file, this.hub, this.animate)));
  return live;
}
// in ask():
const live = this.liveSession(file, profile);
const { session } = await notes.session(file.path, profile.name, { instructions, access: 'read-only', tools: live.tools.tools, skills: [] });
this.bind(live, session); // if (live.session !== session) { live.session = session; live.tools.reset(); session.on(...) }
```

**Wish**
```ts
const notes = this.yami.noteSessions({
  ids, save,
  start: (path, agent) => { const live = new LiveSession(...); return { options: { instructions, tools: live.tools.tools, skills: [] }, state: live }; },
});
const { session, state: live } = await notes.session(file.path, profile.name); // state is typed, and made once for each harness session
```

A mention session needs state of its own: its note tools are bound to its reply queue and its cursors, and both must belong to the session that got those tools. `session()` takes the options at every call but uses them only at the call that starts a session. So the host must build the tools before it knows whether a session starts. Then it must keep its own map by note and agent, which is the same keying that `NoteSessions` already does. It must also find out whether the session is new by comparing objects, so that it can subscribe to the session's events once and reset what the tools have seen. Any host whose tools hold state for each session writes this code. A `started` hook in `NoteSessionsOptions` alone does not do it: the hook would still need the host's own map to find the state on the next call. `SlotOptions.started` already exists inside the library.

## F1.2 · ergonomics · minor · The change feed gives a path, but not the note or the text before the change

**Tried** (`plugin/src/contributions/ledger.ts`)
```ts
changed({ path, ops, agent }: NoteChange): void {
  // library-loop: F1.2
  const note = this.hub.get(path);                 // back from the path to the note that `shared` got
  const entry = note && this.attached.get(note);   // Map<SharedNote, { text, live, queue }>
  if (!entry || !ops.length) return;
  const before = entry.text;                       // the host tracks the text itself
  entry.text = applyOps(before, ops);
  // …
}
```

**Wish**
```ts
changed({ note, ops, agent, before }: NoteChange): void {
  const entry = this.attached.get(note);
  // `before` is the text that `ops` apply to
}
```

The ledger keeps work in order for each shared note, from `shared(note)` until its stop function runs. The feed calls once for the whole hub with a path. So the ledger goes back from the path to the note with `hub.get`, and must trust that `hub.get` gives the renamed note under its new path. It also keeps its own copy of each note's text, which it moves with `applyOps` on every change. It needs that copy because a record that starts at an agent's first change needs the text before the change. Any auditor that starts recording in the middle of a share has the same problem. The docs also do not say whether `changed` always comes after `shared` for a note, and before its stop function. The ledger assumes that it does.

## F1.3 · ergonomics · minor · A host's own `Presence` must repeat Yami's `animate` rule

**Tried** (`plugin/src/main.ts`)
```ts
const animate = () => this.settings.animate;
this.yami = createYami(this, { /* … */ animate });
// library-loop: F1.3
this.mentions = new MentionAgents(this.yami.hub, notes, () => animate() && !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
// → new Presence(identity, animate) for each mention agent
```

**Wish**
```ts
new Presence(identity, this.yami.animate); // or: this.yami.presence(identity)
```

The response says that `animate` covers "every shared note". But `Presence` and `AgentPeer` take their own `animate`, and `ObsidianYami` does not expose the value that it reads, with the reduced-motion rule applied. So a mention agent types only because Duet passes the same function again, and Duet keeps its own copy of the reduced-motion rule. When Yami changes the rule, mentions drift from conversations. It is one line, but every host that makes a `Presence` writes it.

## F1.4 · docs · minor · Four parts of `noteSessions` that I had to guess

The README section "Agent work and the sessions of a note" left these open:
- **Renames and removals.** `NoteSessions` has public `renamed(from, to)` and `removed(path)`. The README says that a session "follows a renamed note or folder". I guessed that `yami.noteSessions` wires the vault's `rename` and `delete` events by itself, so Duet removed its own rename handler. If the host must call them, the README must say so.
- **The idle wait.** Does a `session()` call restart the idle wait? Before, Duet cleared its idle timer as soon as a mention arrived. Now `ask` awaits `hub.acquire` and `tools.show` between `session()` and `send()`. Can a session close in that gap?
- **Two calls at once.** Do two `session()` calls for one note and agent share one start, and whose `options` win? Two quick mentions in one note do this. Duet now passes the same tools in both calls, so either answer works. But F1.1 depends on the answer.
- **`save(ids)`.** Is `ids` the object that the host gave in `ids`, changed in place, or a new object? Duet stores what `save` gives, which is correct in both cases. A host that kept the first object would not know which case it has.

## F1.5 · nit · nit · With no agents, the ribbon names the library and does not say what to do

**Tried**
```ts
this.settings.profiles = [];
await this.saveSettings(); // the ribbon's New conversation now shows: Yami has no agents.
```

**Wish**
```ts
// Duet has no agents. Add one in its settings.   (from plugin.manifest.name)
```

Duet's own ribbon said "Duet has no agents. Add one in the settings." A Duet user has never heard of Yami. The message does not say how to fix the problem.
