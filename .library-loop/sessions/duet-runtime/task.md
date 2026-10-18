# Task: Duet on the whole Yami runtime

Duet is built on Yami, but by hand. It wires the collab hub, the conversation manager, the permission prompts, its own conversation commands, its status bar, and its own esbuild fixes. Move Duet onto `createYami`, and keep only what is Duet's own:
- mentions and the note tools;
- the agent profiles and the settings;
- the contribution ledger and the lens;
- `plugin.api`.

The library's docs tell you how. Write as little code as you can. Each piece of Yami wiring that you must still write is a feedback item.

Work in `/Users/nathanaday/projects/software/obsidian-duet`, on its branch. Duet links yami with `file:../yami/yami`. Learn the library only from the round's `api/` folder.

## Build

1. **createYami.** Duet calls `createYami` in `onload` with its profile agents, and adds no modules. Remove each piece of wiring that the library offers. Today that is:
   - `installCollab`;
   - `new ConversationManager`, and `new PermissionPrompts` for conversations;
   - the commands for a new conversation, a new conversation with each profile, ending a conversation, and focusing the message box;
   - the status bar;
   - `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS`;
   - the resume fallback of `startSession`.
2. **Build.** Use `yami/esbuild` for the bundle and the library's way to ship its stylesheet. Remove the copied esbuild fixes in `scripts/esbuild-options.mjs`.
3. **Settings apply live.** Adding, removing, or editing an agent profile, the conversation folder, and the idle minutes take effect with no reload. That includes the commands and the mention tags.
4. **Duet's features keep working:**
   - a mention's reply and its note edits;
   - one conversation per note, which follows renames;
   - the contribution ledger and the lens;
   - `plugin.api`, with its guarantees: the path is final at once, the status has no race, and listeners follow the note.

   Mentions keep their own sessions. When a part of mentions or of the ledger is something any Yami plugin would need, file it as a feedback item. The overseer rules whether the library takes it.
5. **What a Duet vault gets.** `createYami` installs its own files: the base skill, `Yami.base`, and the wiki index. Say in the feedback what a Duet user sees that they did not see before, and whether each part can be turned off.
6. **Tests.**
   - `npm test` passes with no change to the `obsidian` mock beyond the classes that Duet's own code uses.
   - Update `test/obsidian` for the commands and the status bar that now come from Yami.
   - Add one Obsidian test: a profile that you add in the settings shows as a command and a mention tag with no reload.
7. **Docs.** Update the README. Propose the changes to `docs/design.md` in the feedback, because it is shared policy: Duet's parts, the settings, the bundling, and the vault files.

## Acceptance

1. `npm run typecheck`, `npm test`, and `npm run plugin:build` pass in the Duet repository.
2. `grep -rn "installCollab\|new ConversationManager\|new PermissionPrompts\|CLAUDE_CODE_DISABLE_BACKGROUND_TASKS" plugin/src` finds nothing.
3. `scripts/esbuild-options.mjs` holds no SDK fix of its own.
4. The line count of `plugin/src` is lower than 2,023, its count at the start.
5. `npm run test:obsidian` passes, with the new settings test. It needs a real Claude and Codex, so the overseer runs it at the end.
