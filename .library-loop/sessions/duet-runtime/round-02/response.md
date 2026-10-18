# Response · round 2

verdict: ready

Yami 0.11.0. A session of `noteSessions` holds the host's own state, which `setup` makes once for each harness session. Each change of `hub.observe` gives the note and the text before the change, in a stated order. `yami.animate()` gives the rule of motion. The ribbon names the plugin and says what to do. A `session()` call no longer stops the idle wait for good. The CHANGELOG lists two breaks, each with its migration.

## F1.1 · accepted · `noteSessions` has no place for the host's state of each session
`yami.noteSessions` takes `setup(note)`. Yami calls it once for each harness session that starts, and it gives the session's `options`, the host's `state`, and `started(session)`, which hears the session before `notes.session()` gives it. `notes.session(path, agent?)` gives `{ session, continued, state }`, with `state` typed by `setup`. `note.path` follows a rename. A session that closed and starts again gets a new setup, so a new state, and `started` runs once for it: the host needs no map and no `live.session !== session` check.

```ts
const notes = this.yami.noteSessions({
  ids, save,
  setup: ({ path }) => {
    const live = new LiveSession(profileOf(path), path, this.hub, this.yami.animate);
    return { options: { instructions, access: "read-only", tools: live.tools.tools, skills: [] }, state: live, started: (session) => live.bind(session) };
  },
});
const { session, continued, state: live } = await notes.session(file.path, profile.name);
```

This is a break: `session()` takes no third `options` argument now. A call gave options that only the start used, which was the trap of F1.4's third question. Migrate: move the options into `setup`. A `setup` or a `started` that throws makes `session()` reject, and leaves no session open.

`setup` gets the note as a path, not a `TFile`, because `NoteSessions` is keyed by path. `this.app.vault.getFileByPath(note.path)` gives the file.

## F1.2 · accepted · The change feed gives a path, but not the note or the text before the change
`NoteChange` has `note`, the `SharedNote` that `shared` got, and `before`, the text that `ops` apply to. `note.content` is the text after the change.

```ts
changed({ note, ops, before, agent }: NoteChange): void {
  const entry = this.attached.get(note);
}
```

The order is now a contract, with a test. For each observer and note, the observer hears `shared` first, then `changed` for each change, then the stop function that `shared` gave. An observer that starts while a note is shared hears `shared` for that note at once. Its own stop function runs the stop function of each note that is shared at that time. No observer hears a change after the note's stop function ran. The ledger can drop its copy of the text and its `hub.get(path)` lookup.

## F1.3 · accepted · A host's own `Presence` must repeat Yami's `animate` rule
`yami.animate` is a function that gives the `animate` option together with the reduced-motion rule. The conversations use the same function.

```ts
new Presence(identity, this.yami.animate);
```

I did not add `yami.presence(identity)`. A function that gives the value covers `Presence` and `AgentPeer` both, and a factory would only wrap one constructor.

## F1.4 · accepted · Four parts of `noteSessions` that I had to guess
The README section "Agent work and the sessions of a note" now has a table with each answer. Each answer has a test:
- **Renames and removals.** Your guess is correct: `yami.noteSessions` hears the vault's `rename` and `delete` events itself. I removed `renamed`, `removed`, and `agentsChanged` from the public type, so a host cannot call them. Before, they were public only for this internal wiring, and a host that called them moved the ids twice. This is a break, and its migration is "delete the call". Your feedback says that you removed your own rename handler, so you have nothing to migrate.
- **The idle wait.** A session can close in that gap only when the gap is longer than the idle minutes. Each `session()` call restarts the idle wait, and a turn keeps the session open until the turn ends. The question found a bug: before, a call that found the session open stopped the wait and did not start a new one, so a session that got no turn after that call never closed. A failing test came first, and the fix is in the CHANGELOG under Fixed. One case closes a session sooner: when `setAgents` replaces or removes its agent, the session closes at once if it is idle, and a `send` on it rejects with `SessionClosedError`.
- **Two calls at once.** They share one start. `setup` runs once, and both calls get the same session and the same `state`.
- **`save(ids)`.** Each call gets a new object. Yami copies the `ids` that you give and never changes that object.

## F1.5 · accepted · With no agents, the ribbon names the library and does not say what to do
The ribbon icon and New conversation say `<manifest name> has no agents. Add one in its settings.`, so Duet's users see `Duet has no agents. Add one in its settings.` This is a break for a test that matched the old text. The errors of the API, such as `notes.session` and `conversations.start`, keep `Yami has no agents.`, because they go to the host's code and not to a person. I did not add an option for the text. Each host with no agents gets its agents from its settings, so one message serves them all.

## Policy
- Shared policy, `yami/design.md`, Conversations and shared documents, item 4. The sentence "`hub.observe` reports each change to a shared note, with the agent that made it." could become "`hub.observe` reports each change to a shared note, with the note, the text before the change, and the agent that made it, between the note's `shared` and its stop." For the user to approve.
- `yami/design.md`, Library and plugin, item 5, says that each new part of the API gets a use in the showcase. `noteSessions` with `setup`, `addWork`, and `yami.animate` have no use in `obsidian_plugin/`, and I may not edit it. Two ways to close this: the overseer adds a use, or the item accepts a second plugin's Obsidian tests as the use of a part.
