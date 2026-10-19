# Summary · duet-runtime

Six rounds, rounds 0 to 5, with the consumer first. This was the first session with a consumer in another repository, `../obsidian-duet`. yami went from 0.9.1 to 0.14.0. Duet runs on the whole Yami runtime with no workaround.

## Rounds

| Round | Library | Consumer (Duet) |
| --- | --- | --- |
| 0 | No change: the consumer tried 0.9.1 | Moved onto `createYami`, `pluginBuild`, and `copyStyles`, and dropped its own wiring. Five majors: fixed agents, fixed options, no resume-or-start, no host work in the status bar or Stop, text ops that need Obsidian. |
| 1 | 0.10.0: `setAgents`, live options and `animate`, `resumeOrStart`, `addWork`, text ops in `yami/document`, `noteSessions` (which conversation notes now share), `hub.observe`, `yami-` command ids, docs of the commands and the vault files | No workaround of round 0 left, and no `obsidian` mock. F1.1–F1.5 minor. |
| 2 | 0.11.0: state in each note session, `note` and `before` in each change, `yami.animate()`, `noteSessions` docs; fixed a note session that never closed when idle | No workaround left. The overseer's `test:obsidian` failed 15–17 of 21 on Duet's own test helpers and a lost-keys bug in its settings, which the consumer fixed. |
| 3 | 0.12.0: no agents left no longer throws; typed state; `setup` gets the file; composer writes only changes; unit tests are type-checked | A new Obsidian test with every profile removed. Fixed Duet's Remove button, which held an old index. |
| 4 | 0.13.0: the message box's names are public API, with a test that walks them | The tests use the documented names. Send is disabled with no agent left. |
| 5 | 0.14.0: the question form and presence names; the five guarantees of `start`, `status`, and `onTurnEnd`, each with a test | The tests use the new names. One nit left. |

## Rulings

- **The user** chose the whole runtime for Duet. So a Duet vault gets `Yami.base`, the base skill, and `internal/wiki/`.
- **F0.8 declined.** No option turns the wiki off, because the wiki is built in. The general part was accepted: a session's own tools and skills replace the agent's.
- **F0.9 accepted:** sessions scoped to one note, which any plugin whose agents work in notes needs.
- **F0.10 accepted:** a feed of changes to shared notes, for any plugin that shows or audits agent text.
- **The overseer** asked for the no-agents bug, which the creator suspected, and the public names of the message box.
- **F0.12 declined** by the creator, because `AgentEntry` and `ConversationAgent` are input and output.

## Breaks a user sees

The library's command ids now start with `yami-`. Duet's README lists its changed ids for users who set hotkeys:
- `new-chat` → `yami-new-conversation-claude`
- `end-chat` → `yami-end-conversation`
- `new-conversation` → `forget-mentions`
- Duet's `stop` and `revert` are now Yami's.

The showcase's ids read `yami:yami-…`, and the overseer updated its Obsidian tests.

## Tooling

- `config.json` holds `sessions.<slug>`, and `.library-loop/active` names the live session.
- Each side's `git` runs in its own repository, with a base commit for each side.
- The guard lets both sides read shared files, and neither side write them. Before, a shared file inside a side's folder was writable by that side and unreadable by the other side.

## Policy changes

**yami `design.md`:**
- Layers, items 9 and 10: `setAgents`, the `yami-` ids, and text ops in `yami/document`.
- The library and the plugin, item 2: the new public API.
- Conversations and shared documents, item 4: `addWork`, `noteSessions`, and `hub.observe`.
- Documentation, item 2: names that the README gives a host are public API.

**Duet `docs/design.md`:** What Duet is, mentions on `noteSessions`, the ledger on `hub.observe`, live settings, the build, command ids, vault files, the API's guarantees, and testing.

## Backlog

- **F5.1, nit:** the README does not state the question form's heading text, or that Back keeps the answer.
- **For the user:** `design.md` (The library and the plugin, item 5) says each new part of the API gets a use in the showcase. `noteSessions`, `addWork`, `yami.animate`, and `hub.observe` are used only by Duet, and Duet's Obsidian tests run them in a real Obsidian. Either add showcase uses, or let a second plugin's Obsidian tests count.
- A `title` in the placeholder form `New conversation <date>` is renamed by the first message. The README states this exception.

## Acceptance

All checks were run by the overseer on 2026-10-18:

| Check | Result |
| --- | --- |
| 1. Duet `npm run typecheck`, `npm test` (42), `npm run plugin:build` | pass |
| 2. The grep for `installCollab`, `new ConversationManager`, `new PermissionPrompts`, and the background-task flag in `plugin/src` | nothing found |
| 3. `scripts/esbuild-options.mjs` | deleted; the build uses `pluginBuild` |
| 4. Lines of `plugin/src` | 1,792, down from 2,023; no `library-loop:` marker |
| 5. Duet `npm run test:obsidian` | 22 of 22, with the settings test and the no-agents test |
| yami `npm run build` and `npm test` (387) | pass |
| Showcase `npm run build`, `npm test` (85), `npm run test:obsidian` (21 of 21) | pass |
| yami `npm run test:live` on 0.13.0 | 40 pass, 2 Claude-only tests skipped on Codex |
