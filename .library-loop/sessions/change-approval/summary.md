# Summary · change-approval

Goal: a wiki change plan is a proposal that a person approves or rejects. The change document shows exactly what the plan creates, modifies, and removes. The acts live in the Yami sidebar and the command palette, not in the document. Success and failure are clear at once.

## Rounds

| Round | Creator | Consumer |
| --- | --- | --- |
| 1 | yami 0.17.0: `wiki.change` proposes; `approve`, `reject`, `changes`, `changeDetails`, `changeActs`; four commands; the ingest ends at the proposal; the checkout return proposes and approves. Ready. | The waiting list, the change page with a diff per write, Approve and Reject with the result or the refusal inline, an Obsidian test of the cycle. Done, with 3 minor and 2 nit items. |
| 2 | yami 0.17.1: `changed` only while proposed (F1.1), `runChangeAct` (F1.2), `CHANGE_STATUS_LABELS` (F1.3), docs (F1.4, F1.5). All accepted. | The workarounds are gone. Done, with 1 nit. |
| 3 | yami 0.17.2: `runChangeAct(act, { started })` (F2.1). Accepted. | "Rejecting…" after the reason prompt. Done, with 1 nit (F3.1). |

## What the library gained

- **A plan is a proposal.** `wiki.change(plan)` and the tool `wiki_change` validate the plan and write the change document with `status: proposed`. Nothing under `wiki/` changes, and no snapshot is taken.
- **`wiki.approve(path)`** reads the plan back from the document, validates it again against the wiki as it is now, snapshots, applies, snapshots, and sets `applied`. A plan that no longer fits is refused with the reasons and stays proposed. A write that fails restores the version before.
- **`wiki.reject(path, reason?)`** records the rejection and the reason in the document.
- **The reads for a view:** `wiki.changes(status?)`, `wiki.changeDetails(path)` (each write with its text before and after, and `changed` while a later edit would be overwritten), `wiki.changeActs(change)`, and `CHANGE_STATUS_LABELS`.
- **The commands:** `Wiki: approve this change`, `Wiki: reject this change` (on the open document), `Wiki: approve a change`, `Wiki: reject a change` (a pick of the proposals). Reject asks for a reason; an empty reason is allowed.
- **`yami.runChangeAct(act, { started })`** in the Obsidian layer: the prompt, the run, the notice, and the refusal in one place, used by the commands and the panel.
- **The ingest ends at the proposal.** Its promises judge the proposals through the module's checks `proposed` and `absorbed`; `clean-topics` is for the review. A rejected change makes them unmet again, with the reason in the feedback of a resume.
- **Breaks, each with a migration in the CHANGELOG:** `change()` no longer applies; the change document's form changed; the statuses are five; a modify applies the note whole; the ingest's promises changed, so a vault set up by 0.16 deletes the old forms once.

`design.md` changed before round 1 ("The wiki" items 8, 9, and 11; "Do not" 9; the Terms and the Layout) and took one proposal from the creator: the change document is the one record of the plan, so a hand edit that keeps its form is applied as written.

## What the panel gained

- A **Waiting for approval** section at the top of the Modules page and on the Wiki page, with each proposal's title, counts, age, and the module of its session. The Wiki row carries a badge with the count. A new row enters with the panel's motion, and a finished one fades out.
- A **change page**: the status with a mark, when it was proposed and by which session, the notes, and the writes grouped as Creates, Changes, and Removes, each with its path, its `why`, and a line diff with the changed parts marked and unchanged lines collapsed. A note that changed since the proposal shows a warning before its diff.
- **Approve** as the lead button and **Reject** plain. The page shows "Applying…" or "Rejecting…" while it works, then a green result line with the versions and the counts, or the rejection with its reason. A refusal shows inline in the error style with `role="alert"`, and the acts stay. Escape in the reason prompt changes nothing.
- The diff rendering is `src/panel/diff.ts` over `diffOps`, with a unit test.

## Declined requests

None.

## Backlog

- F3.1 (nit): the library gives "Applying" but no word for a reject in progress; the panel says "Rejecting". One string, when a second view needs it.
- Approval by an agent, or an automatic-approval setting, was out of scope.
- A vault set up by 0.16 must delete the wiki's old forms once; the CHANGELOG says which.

## Guard blocks

The creator was blocked on nothing of note. The consumer was blocked on one read of the library's `package.json` (answered by `VERSION` after F1.5), and one `git show` without a pathspec. None came from a docs gap after round 2.

## Acceptance

1. `npm run build` and `npm test` pass in `obsidian_plugin/` (9 tests).
2. `npm run test:obsidian` in the overseer's own run: 22 of 23 passed. The one failure was "calls a module tool from both agents": the Codex conversation hit the API's rate limit (the log holds a 429), which no code of this session touches. Rerun alone, that test passed, so every test of the suite passed in this session.
3. No plugin file imports `yami/src`; the panel reads every datum from the API, and no `library-loop` marker remains.
4. The change document holds no button, callout, or approval markup; the acts are commands and panel buttons.

Also:
- In `yami/`, `npm run build` and `npm test` pass (497 tests).
- Duet typechecks, passes its 42 unit tests, and builds on 0.17.2 with no change.
