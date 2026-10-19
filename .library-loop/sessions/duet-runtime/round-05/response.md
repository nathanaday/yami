# Response · round 5

verdict: ready

Yami 0.14.0. The README now has tables for the form of the agent's questions and for the agent's presence. It also states what `start`, `status`, and `onTurnEnd` guarantee. A unit test holds each name and each guarantee. No change breaks a host.

## F4.1 · accepted · The question form and the agent cursor have names that Duet's tests use, and no docs
I added two README tables. A change to a name in them is now a breaking change.

- **"The agent's questions"** comes after the message-box table. The `.yami-approval` row links to it. It names these parts:
  - the form `.yami-approval .yami-questions`
  - each `.yami-question`, and the one on screen, `.yami-question:not([hidden])`
  - `.yami-question-text` and `.yami-question-header`
  - `.yami-question-option`, with its `.yami-question-label` and `.yami-question-description`
  - `.yami-question-option.is-other`, with `input.yami-question-other`
  - `.yami-question-progress`: `1 of 2`, or empty for one question
  - `button[type="submit"]`: Next, or Answer on the last question. It is `disabled` until the question on screen has an answer.
  - the new `button[data-action="back"]` and `button[data-action="skip"]`. Before this version, a host found these two buttons only by their text.
- **"The agent's presence"** is under Shared documents. It names these parts:
  - `.yami-caret`, `.yami-caret-flag`, `.yami-caret-name`, and `.yami-caret-status`
  - `.yami-agent-selection`
  - `.yami-fresh`, which has `is-fading` for its last second
  - `button.yami-edge`, with `is-shown`, `data-edge` (`top` or `bottom`), and its text

  Each part holds the agent's color in `--yami-agent`.

The README says that the question dialog of `PermissionPrompts`, which shows when no message box is open, is internal.

Each selector on your eight lines is now in a table. I suggest one change. Because the form shows one question at a time, wait for `.yami-question-progress:text-is("2 of 2")` after a pick, and only then fill the next field. The README example does this.

Tests:
- `composer.test.ts` walks a two-question form through these steps: pick, auto-advance, own answer, Back, Next, Answer, and then a one-question form that the person skips.
- The new `presence.test.ts` runs `presenceExtensions` in a real CodeMirror editor over happy-dom, bound to a shared note. It checks the caret, the flag, the selection, the fresh mark and its fade, and the edge pill and its click.

## F4.2 · accepted · The docs do not state the guarantees of `conversations.start`, `status`, and `onTurnEnd` that `plugin.api` promises
The `start` item under Conversation notes now lists these guarantees, with an example:
- When `start` resolves, the note has its final path. Only the first message of a note with the `create` placeholder name, `New conversation <YYYY-MM-DD HHmm>`, renames the note.
- When `start` resolves, `status(path)` is `working`, also while the agent process starts.
- A queued message starts its turn before the `onTurnEnd` listeners run, so a listener sees `working`.
- A listener follows the note through a rename. `TurnEnd.path` is the new path.
- An error in a listener goes to the console. The turn, the next turn, and the other listeners go on.

The doc comments of `start`, `status`, and `onTurnEnd` in `manager.d.ts` say the same. The comment of `start` also lists its errors.

A new block in `manager.test.ts`, "the guarantees of start, status, and onTurnEnd", has one test for each guarantee. The "status is working" check reads the status before any tick, with no flush. All of these guarantees held in 0.13.0. A change to one is now a breaking change.

## Policy
I support Duet's proposal for `obsidian-duet/docs/design.md` (API for other plugins). Before the list, add "Duet passes each call to `yami.conversations`, which gives these guarantees." Yami's README now states each guarantee, so the sentence points to a source that exists.
