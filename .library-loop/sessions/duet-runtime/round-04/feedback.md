# Feedback · round 4

verdict: done

Duet runs on Yami 0.13.0. It has no `library-loop:` workaround, and `plugin/src` did not change: 1,792 lines (2,023 at the start).

**F3.1 is closed.** The table "The message box" answers each selector that I asked about. As the ruling says, the Obsidian tests now use only the documented names for the message box:
- Each conversation test finds the box in the active leaf (`.workspace-leaf.mod-active .yami-composer`). Before, only the no-agents test did, so `docs/design.md` (Testing) described one test and not the suite. Now the code matches the sentence.
- The text field is `textarea.yami-input`, not `.yami-composer textarea`.
- The approval-mode test reads `button.yami-chip[data-setting="approval"] .yami-chip-label`. It expects `Ask first` before the change and `Accept edits` after it. Before, the test found any label with that text.
- "Records an edit to a note that is not open" answers with a click on `.yami-approval button[data-decision="allow"]`. The test before it still presses `y`, so the suite tests both ways.
- The no-agents test checks that `button.yami-send` is `disabled` while the field has text and no agent is left. It also checks that Send is enabled again when Add agent gives an agent back.

Each name did what the table says, on the first run. The test diff adds 30 lines and removes 23, and it needed no probe and no read of the DOM.

Checks: `npm run typecheck` passes. `npm test` passes 42 tests. `npm run plugin:build` passes. The acceptance grep finds nothing. `npm run test:obsidian` passes 22 of 22 in 2 of 2 full runs (88 s and 82 s), with a real Claude Code and Codex.

**What a Duet user sees.** No change from the table of round 3, which `docs/design.md` (Vault files) now holds.

**`docs/design.md` against the code.** The overseer's update took the proposals of rounds 2 and 3. I checked each section against `plugin/src` and the tests. Each sentence describes the code, except one. *API for other plugins* gives three guarantees as Duet's, but Duet's code only passes `start`, `status`, and `onTurnEnd` through to `yami.conversations`. The guarantees come from Yami, and Yami's docs state only one of them (F4.2). The change that I propose: before the list, add "Duet passes each call to `yami.conversations`, which gives these guarantees."

**Policy.** I support the creator's proposed item 4 for Documentation in `yami/design.md`. From the host's side, it is the rule that closed F3.1. I propose one addition: "This includes the names that a host's tests need to drive a view, such as the form of the agent's questions." See F4.1.

## F4.1 · docs · minor · The question form and the agent cursor have names that Duet's tests use, and no docs

**Tried** (`test/obsidian/plugin.test.ts`)
```ts
await page().waitForSelector(`${box}.has-approval .yami-questions`);                    // internal, says the README
expect(await page().textContent('.yami-question-progress')).toBe('1 of 2');              // internal
await page().click('.yami-question:not([hidden]) .yami-question-option:has-text("Pear")'); // internal
await page().click('.yami-question:not([hidden]) .yami-question-other');                 // internal
expect(await page().isDisabled('.yami-questions button[type=submit]')).toBe(true);       // internal
await page().waitForSelector('.yami-caret');                                             // not documented
expect(await page().textContent('.yami-caret-flag')).toContain('claude');                // not documented
await page().waitForSelector('.yami-fresh');                                             // not documented
```

**Wish** (two more parts of the README's tables)
```md
| `.yami-questions` | the form of the agent's questions, in `.yami-approval` | while a question waits |
| `.yami-question` | one question | the shown one has no `hidden` |
| `.yami-question-progress` | the step text | `1 of 2` |
| `.yami-question-option` / `.yami-question-other` | an option / the field for the person's own answer | |
| `button[type=submit]` in `.yami-questions` | Answer | `disabled` until each question has an answer |

| `.yami-caret`, `.yami-caret-flag` | the agent's cursor and its name flag, from `Presence` | while the agent's cursor shows |
| `.yami-fresh` | text that the agent wrote a moment ago | |
```

The message-box table says that "for a question, it holds the form of the agent's questions". It also says that every other class in `.yami-composer` is internal. So now Duet's question test depends on names that the README calls internal, on 8 lines. The `presenceExtensions` line names the caret, the name flag, and the fresh-text highlight, but not their classes. Duet's mention test waits for them on 3 lines. A host that styles its own agent's cursor also needs the names. The ruling on F3.1 says to give "each of its parts that a host may use" a stable name. The question form and the presence are two more parts of that kind.

## F4.2 · docs · minor · The docs do not state the guarantees of `conversations.start`, `status`, and `onTurnEnd` that `plugin.api` promises

**Tried** (`plugin/src/main.ts`: Duet's code for these calls only passes them through)
```ts
newConversation: async ({ profile, ...options }) => ({ path: (await conversations.start({ ...options, agent })).path }),
conversationStatus: (path) => conversations.status(path),   // must be 'working' at once
onTurnEnd: (path, callback) => conversations.onTurnEnd(path, callback),
```

**Wish** (in the README, under `start`)
```md
- `start` names the note when it creates it, from `title` or from the message, so the first message does not rename it.
- When `start` resolves, `status(path)` is `working`.
- When a turn ends with a message in the queue, the next turn starts before the `onTurnEnd` listeners run, so a listener sees `working`.
- `onTurnEnd` follows the note, so a rename keeps the listener. An error in a listener goes to the console, and does not stop the turn or the other listeners.
```

The brief requires `plugin.api` "with its guarantees", and `docs/design.md` lists them. In Yami's docs, only "Follows the note, not the path, so a rename keeps the listener" (the doc comment of `onTurnEnd` in `manager.d.ts`) says one of them. The README gives `start` and `onTurnEnd` one line, with no guarantee. The Obsidian test "starts a conversation for another plugin through the API" checks the first three guarantees, so I know that they hold today. But each is a fact that I learned from a test, and no doc names it. If Yami changes one, the CHANGELOG need not say so.
