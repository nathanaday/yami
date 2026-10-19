# Feedback · round 3

verdict: done

Duet now runs on Yami 0.12.0. It has no `library-loop:` workaround. Each answer of round 3 did what the response said.

- **F2.1.** I ran the probe of round 2 again under `@ts-expect-error`: `state` is `number | undefined` now, so `const n: number = state` does not compile. Duet's `setup` always gives a state and needed no change.
- **F2.2.** `setup({ file, agent })`. I deleted the file lookup, its error, and the `app` parameter of `MentionAgents`. `setup` still looks up the Duet profile by `agent`, because the reply title and the cursor use the profile. That is Duet's own data.
- **F2.3.** No call site changed. I did not count the composer writes again. The creator's test counts zero writes, as my probe did.
- **No agents left (the overseer's item).** Duet needed no code for it. The new Obsidian test covers it, and it passes. The test opens a Claude conversation and tells the agent to remember a word. Then it removes both profiles with the Remove buttons in the settings window. The open note shows `Duet has no agents. Add one in its settings.` and has the class `is-unavailable`. No `yami-new-conversation-*` command is left. The test types a question and presses Enter. The text stays in the box, no turn starts, and the note does not change. Then the test clicks Add agent. The note takes the same text with no reload, and the reply is the word. So the new agent `agent2` continued the note's harness session.

**A Duet bug that the new test found.** After a person removed one agent, the Remove button of the next agent removed nothing. Obsidian's declarative settings keep the `extraButtons` callbacks of a group from the first render, so the next button still held the old index. A probe showed it: the tab showed `codex` and `agent2`, and the `Remove @agent2` click left both. `removeAgent` now takes the profile and finds its index when the person clicks. This bug is in Duet, not in Yami.

`plugin/src` has 1,792 lines: 2,023 at the start, 1,934 after round 0, 1,808 after round 1, and 1,792 after round 2. In this round, `mentions.ts` lost 2 lines (F2.2), and `settings.ts` gained 2 lines for the fix above.

Checks: `npm run typecheck` passes. `npm test` passes, with 42 tests. `npm run plugin:build` passes. The acceptance grep finds nothing. `npm run test:obsidian` passes 22 of 22 (88 s), with the new test, and with a real Claude Code and Codex, in 3 of 3 full runs of the final code.

**What a Duet user sees that they did not see before.** This is the same as in round 2, with one addition. When a person removes every profile, an open conversation note shows `Duet has no agents. Add one in its settings.` This message needs no switch. The README's Settings section now says what happens. The table of round 2 is still correct:

| Part | Can Duet turn it off? |
| --- | --- |
| `Yami.base` in the vault root | No |
| `internal/yami/skills/run/SKILL.md` | No |
| `internal/wiki/` (12 files) | No (ruling on F0.8) |
| Folder colors | Yes, `folderColors: false` |
| Session commands | Yes, `commands.sessions: false` |
| 12 wiki commands, and New module | Yes, `commands.wiki: false`, `commands.modules: false` |
| Yami's status bar, which shows mentions too | Yes, `statusBar: false` |
| Yami's tools and skill sets in every conversation agent | No |
| Yami's tools and skill sets in mention sessions | Duet turns them off: `tools: noteTools, skills: []` in `setup` |
| `Duet has no agents. Add one in its settings.` on the ribbon and in an open conversation note | No, and it needs no switch |

**Proposed changes to Duet's `docs/design.md`.** `docs/design.md` still has the text of round 0. The list of round 2 still applies, item by item. These are the changes to that list:
- *One conversation per note:* "`setup` gets the note's `TFile`, and builds the state of each harness session from it."
- *Settings:* add "When the person removes every profile, Yami's conversation notes say what to do, and a profile that the person adds takes over the open notes with no reload. A Remove button finds its profile when the person clicks it, not by the index of the first render, because Obsidian keeps the buttons of a group across renders."
- *Testing:* add "A test that finds a conversation's message box finds it in the active leaf (`.workspace-leaf.mod-active .yami-composer`), because earlier conversation notes stay open in other tabs."

## F3.1 · docs · minor · The composer's classes that a host's tests read are not documented

**Tried** (`test/obsidian/plugin.test.ts`, whose selectors use these classes on 16 lines)
```ts
await page().waitForSelector('.yami-composer.is-working');                // documented? no
await page().waitForSelector('.yami-composer.is-ended');                  // no
expect(await page().$('.yami-chip-label:text-is("Accept edits")')).not.toBeNull();   // no
await page().focus('.yami-composer textarea');                            // no
await page().waitForSelector('.yami-composer.is-unavailable');            // yes, new in 0.12.0
```

**Wish**
```md
| Class | On | When |
| `yami-composer` | the message box | always |
| `is-working` / `is-ended` / `is-unavailable` | `.yami-composer` | a turn runs / the conversation ended / no agent is left |
| `yami-input` | the textarea | always |
| `yami-chip-label` | each chip | its text is the setting, such as `Accept edits` |
| `yami-send` (or its real name) | the Send button | `disabled` when nothing can be sent |
```

The README documents the status bar's classes (`yami-status`, `is-working`) and its texts, and now `is-unavailable` and `.yami-unavailable`. It does not document the other classes of the composer. I learned them from the DOM in round 0. A plugin's Obsidian tests and its own styles depend on them, and a rename of one of them breaks those tests with no CHANGELOG entry. I did not test that Send is disabled in the new test, because the README does not name the Send button. A table like the one for the status bar would make these classes a contract.
