# Feedback · round 0

verdict: not-done

Duet now calls `createYami` in `onload` with one entry for each agent profile, and adds no modules. `installCollab`, `new ConversationManager`, `new PermissionPrompts`, Duet's own conversation commands, its status bar, and `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` are gone from `plugin/src`. Mentions take `yami.hub`, the ledger observes `yami.hub`, and `plugin.api` calls `yami.conversations`. A mention session is read-only, so it asks for nothing, and mentions need no prompts. `scripts/esbuild-options.mjs` is deleted: `scripts/plugin.mjs` uses `pluginBuild` and `copyStyles` from `yami/esbuild`. It no longer reads `node_modules/yami/src/obsidian/styles.css`. `plugin/src` has 1,934 lines, down from 2,023.

Checks: `npm run typecheck` passes, `npm test` passes (42 tests), and `npm run plugin:build` passes, with no `new Function` in the bundle. I did not run `npm run test:obsidian`. The brief leaves it to the overseer. It has a new test: a profile added in the settings shows as a command and as a mention tag with no reload.

What went well: the bundle fixes, the stylesheet, the hub, the conversations, and the prompts each cost one line or less. The 0.9.0 CHANGELOG told me that the adapter sets `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS`. The docs told me that a read-only session never asks, so mentions dropped their permission handler.

What hurt: every option of `createYami` is fixed at `onload` (F0.1, F0.2). Duet's settings change at run time. A host also cannot put its own agent work into Yami's status bar or Stop command (F0.4).

Command ids changed, so a user's hotkeys for them break: `new-chat` → `new-conversation-claude`, `new-chat-<tag>` → `new-conversation-<tag>`, `end-chat` → `end-conversation` (Yami's). The mention Stop is now `stop-mention`, because Yami owns `stop` (F0.4). `new-conversation` (Forget the mention conversation) is now `forget-mentions`, because Yami's ids start with `new-conversation-`. Duet's `revert` is gone. Yami's command has the same id, and I assume that it undoes a mention's edits too (F0.6).

**What a Duet user sees that they did not see before** (see F0.7 and F0.8):

| Part | Can Duet turn it off? |
| --- | --- |
| `Yami.base` in the vault root | No |
| `internal/yami/skills/run/SKILL.md` | No |
| `internal/wiki/`: `wiki.md`, `sessions.base`, 3 policies, 3 promises, and the ingest skill with 3 briefs (12 files) | No |
| Folder colors: `internal/` gray, the module folders in color | Yes, `folderColors: false` |
| Session commands: run with each agent, resume, stop, kill | Yes, `commands.sessions: false` |
| 12 wiki commands, and New module | Yes, `commands.wiki: false`, `commands.modules: false` |
| Yami's status bar, which shows conversations and session runs, and no mentions | Yes, `statusBar: false` |
| Yami's tools (`yami_check`, `yami_agent`, `wiki_*`) in every conversation agent | No |
| Yami's skill sets (`/yami:run`, `/wiki:ingest`) in every agent, also in mention sessions | No |

Duet keeps every default for now. The brief says to add no modules, and it does not say to remove command groups.

**Proposed changes to `docs/design.md` of Duet** (shared policy, so I did not edit it):

- *What Duet is:* "Duet calls `createYami` from `yami/obsidian` with one agent for each profile, and adds no modules. Yami gives it the shared-document hub, the conversation notes with their commands, the approval prompts, and the status bar." Remove the sentence about `installCollab`.
- *Turns the user did not ask for:* "Yami's Claude adapter sets `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` for every Claude session." Duet no longer sets it. Keep the follow-up callout.
- *Note tools:* add "A read-only session asks for nothing, so a mention has no permission handler."
- *API for other plugins:* `ConversationManager.start` → `yami.conversations.start`. `folder` defaults to the setting at the time of the call.
- *Settings:* "A change to a profile applies at once: `ProfileAgents.sync` gives Yami the agents as they are now, with a New conversation command for each. The conversation folder and the idle minutes apply to mentions and to the API at once, and to Yami's conversation commands after a reload." This text stays until F0.1 and F0.2 are fixed.
- *Bundling:* replace the paragraph with "`scripts/plugin.mjs` bundles the plugin with `pluginBuild` from `yami/esbuild`, which holds the SDK fixes, and writes `styles.css` with `copyStyles`: Yami's stylesheet, then `plugin/styles.css`."
- *Vault files:* a new section with the table above.
- *Testing:* "The unit tests mock `obsidian` with `Modal`, `SuggestModal`, and `FuzzySuggestModal`, because `yami/obsidian` loads them at import." This text stays until F0.5 is fixed.

## F0.1 · gap · major · The agents of `createYami` cannot change after `onload`

**Tried** (`plugin/src/agents.ts`, run after each settings change)
```ts
// library-loop: F0.1
sync(yami: ObsidianYami, plugin: Plugin): void {
  const entries = this.entries();
  for (const { agent } of entries) if (!yami.agents.includes(agent)) agent.setPreferences({ tools: yami.tools({ agent }), skills: yami.skills() });
  for (const { name } of yami.registered) plugin.removeCommand(`new-conversation-${name}`);
  yami.registered.splice(0, yami.registered.length, ...entries);
  yami.agents.splice(0, yami.agents.length, ...entries.map((entry) => entry.agent));
  for (const entry of entries) {
    plugin.addCommand({ id: `new-conversation-${entry.name}`, name: `New conversation with ${entry.name}`, callback: () => void yami.conversations.create(entry) });
  }
  // … close the agents of removed profiles
}
```

**Wish**
```ts
this.yami = createYami(this, { agents: () => this.agents.entries() });
// after a settings change:
this.yami.refreshAgents();
```
Or `yami.setAgents(entries)`. Either one must set the working directory, the tools, and the skills of a new agent, add and remove the commands of each agent (`new-conversation-<name>` and `run-session-<name>`), and close the sessions of an agent that is gone.

The brief requires that adding, removing, or editing a profile applies with no reload, commands too. `createYami` takes `agents` once, and `Yami.agents` and `registered` are documented as plain fields. So Duet writes the conversation commands again, which the brief says to remove, and it mutates two arrays that the docs do not say a host may change. Three things here are guesses that the docs do not answer:
- Does the conversation manager read `registered` at each use? If it keeps a copy, a conversation with a new agent falls back to the first agent with no error.
- Does Yami's `new-conversation-<name>` callback keep the agent object? If it does, an edited profile would start with its old program. For that reason the workaround replaces every per-agent command.
- What does `createYami` do with zero agents? Duet lets a user remove every profile.

The `run-session-<name>` commands stay stale. Duet adds no modules, but a user can make a vault module.

## F0.2 · gap · major · The conversation folder and the idle minutes are fixed at `onload`, and conversations have no `animate`

**Tried**
```ts
this.yami = createYami(this, {
  agents: this.agents.entries(),
  conversationFolder: this.settings.conversationFolder, // read once
  idleMinutes: this.settings.idleMinutes,               // read once
});                                                     // "Show agents typing" has no option
```

**Wish**
```ts
createYami(this, {
  agents: () => this.agents.entries(),
  conversationFolder: () => this.settings.conversationFolder,
  idleMinutes: () => this.settings.idleMinutes,
  animate: () => this.settings.animate,
});
```

This is a regression from the move. Before, Duet gave `ConversationManager` the functions `folder`, `idleMinutes`, and `animate`, so the three settings applied live. Now a new conversation folder reaches only the API, because Duet passes `folder` itself, and mentions. Yami's commands keep the old folder until a reload, and the wiki goes on excluding the old folder. "Show agents typing" now applies only to mentions. The docs do not say whether Yami's conversations animate at all, or whether they respect `prefers-reduced-motion`, as Duet's did. I found no workaround that uses only the documented API, so the README now says that these settings apply to conversations after a restart.

## F0.3 · gap · major · No public way to resume a harness session, or to start a new one when the harness has lost it

**Tried** (`plugin/src/agents.ts`, used by mentions)
```ts
// library-loop: F0.3
export async function startSession(agent: Agent, options: SessionStart<AgentPreferences>): Promise<AgentSession> {
  if (!options.resume) return agent.startSession(options);
  try {
    return await agent.startSession(options);
  } catch {
    return agent.startSession({ ...options, resume: undefined });
  }
}
```

**Wish**
```ts
const session = await agent.startSession({ resume: saved, ifGone: "start", instructions, access: "read-only", tools });
session.continued; // false when the harness no longer had `saved`
```

The brief lists this fallback as wiring that the library offers. The library has it twice, and neither is public for a session with no note: `ConversationController.startAgent` is private ("When the stored conversation is gone, starts a new one"), and `Conversations.open({ resume })` does it but writes a conversation note. A mention has no note. The docs also do not say what `startSession({ resume })` does with an id that the harness lost: does it throw, with which error, or does it start silently? So Duet catches every error and retries. For example, a read-only refusal ("A read-only session does not start: …") is tried twice before the user sees it.

## F0.4 · gap · major · A host's own agent work is not in Yami's status bar or its Stop command

**Tried**
```ts
// library-loop: F0.4
this.addCommand({
  id: 'stop-mention',
  name: 'Stop the mention agent in this note',
  checkCallback: (checking) => { /* mentions.working, mentions.interrupt(file) */ },
});
```

**Wish**
```ts
const work = this.yami.work({ name: profile.name, file, interrupt: () => session.interrupt() });
work.start();  // the status bar shows it, and Yami's `stop` command in that note interrupts it
work.end();
```

Before the move, Duet's status bar showed "claude working in Ideas" for a mention, and a click opened the note. Now the brief removes Duet's status bar, and Yami's bar does not know about mentions, so a mention that works shows nothing. `yami.updateStatus()` is public, but a host cannot add an entry. The palette now has two stop commands: Yami's `stop` and Duet's `stop-mention`. Any plugin that runs agent sessions outside conversation notes and session runs has the same problem.

## F0.5 · gap · major · The text ops cannot be imported without the Obsidian classes

**Tried**
```ts
vi.mock('obsidian', () => ({ Modal: class {} }));
import { applyOps, diffOps } from 'yami/obsidian';
// Error: [vitest] No "FuzzySuggestModal" export is defined on the "obsidian" mock.
//  ❯ ../yami/yami/dist/obsidian/wiki/list-modal.js:9:49
//  ❯ ../yami/yami/dist/obsidian/commands.js:6:1
```
The workaround, in both unit tests:
```ts
// library-loop: F0.5
vi.mock('obsidian', () => ({ Modal: class {}, SuggestModal: class {}, FuzzySuggestModal: class {} }));
```

**Wish**
```ts
import { applyOps, deltaOps, diffOps } from 'yami/document'; // or a plain entry such as 'yami/collab'
```

`npm test` failed at the start of this round, before I changed any code. Duet's unit tests need only `diffOps` and `applyOps`, which need no Obsidian. Yami's design.md, Layers item 10, says that `collab/text-ops.ts` does not need Obsidian and that a plain build can move it below. The brief allows no mock classes beyond the ones that Duet's own code uses, and Duet uses neither `SuggestModal` nor `FuzzySuggestModal`. Each new modal in `yami/obsidian` will break the tests again.

## F0.6 · docs · minor · The docs do not say what the conversation commands and the status bar do

The command table gives `new-conversation-<agent name>, end-conversation, stop, focus-composer, revert` and the names "New conversation with claude, End this conversation, …". I needed this, and had to guess it:
- What `stop` stops: the conversation's turn only, or any agent in the note?
- What `revert` undoes: the last turn of every `AgentPeer` in the note, so a mention's edits too? Duet dropped its own `revert` on that guess. The README names it "Undo the agent's last changes in this note", also a guess.
- When each command shows in the palette (its check), and its full name.
- What happens when a plugin adds a command with the same id as one of Yami's. Duet had both `stop` and `revert`.
- The status bar item: its text, its class, and whether a click opens the note. The new Obsidian test waits for a `.status-bar-item` whose text matches `/claude/i`, also a guess.

## F0.7 · docs · minor · The docs do not list the files that `createYami` writes into the vault

The README says that each module installs its documents and that the base skill is at `internal/yami/skills/run/SKILL.md`. It does not list the wiki module's files. I learned them by running `testYami({})` and listing the vault: `Yami.base`, `internal/yami/skills/run/SKILL.md`, and 12 files under `internal/wiki/`. A plugin author must tell users what appears in their vault. The brief asks for exactly that list, and Obsidian's review asks what a plugin writes.

## F0.8 · gap · minor · A plugin with no modules cannot leave out the wiki's files, tools, and skills

**Tried**
```ts
createYami(this, { agents, commands: { sessions: false, wiki: false, modules: false }, statusBar: false, folderColors: false });
// Yami.base, internal/yami/, and internal/wiki/ are still written; every agent still gets wiki_* and /wiki:ingest
```

**Wish**
```ts
createYami(this, { agents, wiki: false }); // no wiki module, no Yami.base, no wiki tools or skills
```

A Duet user who wants only mentions and conversations gets 14 files and a gray `internal/` folder that they did not ask for, and the files cannot be turned off. Mention sessions also get Yami's skill sets through the agent's preferences, so a mention agent sees `/wiki:ingest` but has none of its tools. The docs say that a session's own `tools` replace the agent's, but they do not say whether a session's `skills` replace or add to them. Yami's design.md says that the wiki is built in, so this item can need a policy change. The overseer rules.

## F0.9 · gap · minor · A note-scoped agent session is Duet's code, and any agent that works in a note needs it

**Tried** (`plugin/src/mentions.ts`, about 90 lines)
```ts
export type SessionIndex = Record<string, Record<string, string>>; // saved with the plugin data
// liveSession(): one starting promise per note and agent; start(): startSession with resume, save the id;
// rename(): move the saved ids and the live keys; an idle timer that closes the process; forget(); closeAll()
```

**Wish**
```ts
const notes = this.yami.noteSessions({ load: () => data.sessions, save: (ids) => persist(ids), idleMinutes: () => n });
const session = await notes.session(file, agent, { instructions, access: 'read-only', tools });
await notes.forget(file);
```

The brief asks me to file each part of mentions that any Yami plugin would need. The parts here have nothing to do with mentions: one harness session for each note and agent, saved ids that follow renames, the resume fallback (F0.3), and an idle close. A plugin that answers in a note, such as one that comments in the margin, would write the same code. The overseer rules on the generality.

## F0.10 · gap · minor · The feed of agent-written changes in a shared note is Duet's code

**Tried** (`plugin/src/contributions/ledger.ts`)
```ts
const observer = (event: Y.YTextEvent, transaction: Y.Transaction) => {
  const ops = deltaOps(event.delta);
  if (!ops.length) return;
  const peer = AgentPeer.of(transaction.origin);
  const agent = peer && { name: peer.identity.name, time: new Date().toISOString() };
  // …
};
note.text.observe(observer);
```

**Wish**
```ts
this.yami.hub.onEdit((note, ops, author /* AgentIdentity | undefined */) => ledger.record(note.path, ops, author));
```

The ledger itself is Duet's feature. But "which ops changed this note, and which agent made them" is Yami's data, read through Yjs internals (`YTextEvent`, the transaction origin, `deltaOps`). Any plugin that shows or audits agent text needs it. The overseer rules on the generality.

## F0.11 · ergonomics · nit · `pluginBuild` makes `plugins` optional, and `copyStyles` writes one file

**Tried**
```js
const options = pluginBuild({ production: !values.watch });
await context({ ...options, plugins: [...(options.plugins ?? []), install] });
for (const target of targets) await copyStyles(path.join(target, 'styles.css'), ['plugin/styles.css']);
```

**Wish**
```js
await context({ ...pluginBuild({ production, plugins: [install] }), entryPoints, outfile });
await copyStyles(targets.map((t) => path.join(t, 'styles.css')), ['plugin/styles.css']);
```

`pluginBuild` always returns its plugins, but its type is `BuildOptions`, so a caller who adds a plugin needs `?? []`.

## F0.12 · nit · nit · `AgentEntry` and `ConversationAgent` are two names for one thing

`createYami` takes `AgentEntry` (`{ agent, name?, color? }`), and `yami.registered` gives `ConversationAgent` (`{ agent, name, color }`). Duet builds `ConversationAgent`s and passes them as `AgentEntry`s. One type with optional fields would do.
