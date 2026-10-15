# yami-obsidian

The Obsidian layer of Yami. It holds what needs the Obsidian API: the vault adapter, shared documents, conversation notes, and the approval prompts. Every Yami plugin uses it, so agents behave the same in all of them. The design policy is in [`design.md`](../design.md).

The code came from [Duet](https://github.com/nathanaday/obsidian-duet), and Duet uses it from here.

```ts
import { ConversationManager, installCollab, ObsidianVault, PermissionPrompts, uninstallCollab, vaultRoot } from "yami-obsidian";

// In Plugin.onload:
const vault = new ObsidianVault(this.app, vaultRoot(this.app));
const hub = installCollab(this.app, this);
const conversations = new ConversationManager(this.app, hub, new PermissionPrompts(this.app), {
  agents: () => [{ name: "claude", color: "#d97757", agent: claudeAgent }],
  folder: () => "conversations",
  animate: () => true,
  idleMinutes: () => 15,
  onActivity: () => {},
});
conversations.install(this);

// In Plugin.onunload:
await conversations.destroy();
uninstallCollab(hub);
```

The plugin must ship `styles.css` from this package next to its `main.js`.

## Shared documents (`collab/`)

While an agent works with a note, the note is a shared document: a Yjs `Y.Doc` with one `Y.Text`. The user and each agent are peers of this document. They exchange Yjs updates in memory; there is no network, and the markdown file stays the only thing on disk.

- `CollabHub` owns the shared notes. `acquire(file, holder)` shares a note until `release`. While an agent writes files with its own tools (`addWriter`), every note open in an editor is shared, so a change on disk merges with unsaved typing instead of replacing it. The hub patches `MarkdownView.setViewData` and `Vault.modify` while it is installed, so one Obsidian window has one hub: `installCollab` makes it, and a second plugin gets the same one.
- `SharedNote` remembers the document state that matches the file on disk. When another program changes the file, the note forks the document at that state, replays the change on the fork, and merges the fork. Text that the user typed after the last save stays, also inside a range that the agent rewrote.
- `EditorBinding` keeps a CodeMirror editor and a shared note in sync. Changes from the note reach the editor with `addToHistory: false`, so Cmd+Z undoes only the user's own typing.
- `AgentPeer` is one agent in one note. Its edits carry the peer as the Yjs origin, so editors highlight them and `agentUndo` can revert one turn. It publishes a cursor and a status through the Yjs awareness protocol, and types its edits when the note is visible.
- `LiveRegion` is a range that an agent writes as its own output, such as a reply. Appended text is typed a few characters at a time.
- `presenceExtensions` draw the agent's caret, name flag, selection, fresh-text highlight, and the edge pill that scrolls to the agent.

## Conversation notes (`conversation/`)

A conversation note is a document with `type: conversation`; the format is in `yami/conversation`. `ConversationManager` gives each open conversation note a `Composer`, the message box at the bottom of the note, and creates new conversations in the `folder`. `ConversationController` runs one note: its agent session, the transcript in the note, queued messages, approval requests, and the agent's questions.

- `create(agent)` makes a note with a placeholder name and opens it. The first message names the note.
- `start({ message, agent?, title?, folder?, open?, module? })` creates a note and sends the first message, for a module or another plugin. `status(path)` and `onTurnEnd(path, listener)` follow it.
- The composer shows approval requests and questions above the message box, with `Y`, `A`, and `N` keys. With no composer open, `PermissionPrompts` shows a dialog.
- `/model`, `/effort`, `/mode`, `/new`, and `/end` are local commands. Other `/` commands come from the harness. `[[` suggests notes.
- The agent process closes after `idleMinutes` without a composer; the next message resumes the session from the `session` property.

## Tests

- `npm test` runs the collab tests: diffs, disk merges, agent edits against an older version, typing, presence, live regions, and whole conversation turns in a shared note.
- The plugin's `npm run test:obsidian` drives the real Obsidian app with these parts.
