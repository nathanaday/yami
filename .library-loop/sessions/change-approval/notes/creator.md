# Creator notes · change-approval

## Round 1
- Built 0.17.0: `change()` proposes; `approve()`, `reject()`, `changes()`, `changeDetails()`, `changeActs()` on `Wiki`; four commands; the ingest's checks `proposed` and `absorbed` in `src/module/wiki/ingest.ts`; `clean-topics` has no check (the review judges it).
- The change document is the one record: `readProposal` in `src/wiki/change.ts` parses the Writes section (`### <op> · <path>`, the why, `<!-- hash: … -->`, a `markdown` block with the note whole). A modify applies the note whole. `changed` in details compares the hash of the note's text at proposal with the text now.
- Kept the promise name `change-applied` because R8 says it "becomes" the proposed-or-applied promise and old sessions link it. If the consumer finds the name misleading, a rename to `change-proposed` is a small break (session links, install files).
- `age()`, `REJECT_*` texts, and `AskOptions` are exported from `yami/obsidian`.
- Proposed a policy line for design.md "The wiki" item 8 about the document as the one record; the overseer put it in.

## Round 2
- 0.17.1, all five items accepted (the rulings said so). `changed` only while `proposed` (the snapshot before an approval holds the note as edited, so an applied modify read `true`). `ObsidianYami.runChangeAct(act)` in `src/obsidian/yami.ts`; the commands call `yami.notify(yami.runChangeAct(act))`: the notice of success is the act's, the refusal is `notify`'s. `CHANGE_STATUS_LABELS` in `src/wiki/change.ts`, used by `statusText` and the acts' notices.
- The commands test fakes `runChangeAct`; the sequence's own test is in `test/unit/obsidian/yami.test.ts` over the mocked `Notice`.

## Round 3
- 0.17.2, one item by ruling: `runChangeAct(act, { started? })`. `started` fires after the reject prompt answers, at once for approve, never on Escape; it fires before a refusal rejects, so a view clears its busy state in `finally`. The body is now one path: prompt (reject only), return on Escape, `started`, run, notice.
- The consumer's verdict was `done` in rounds 1 and 2, and round 2 was one nit. The session is at its end unless the panel finds more.

## Watch next round
- A line diff stays in the consumer (`diff-match-patch-es` is a dependency a plugin can use); decline if asked.
- `changes()` reads every change document on each call; measure before caching.
- The consumer's verdict was `done` in round 1; if round 2 feedback is nits only, the session is near its end. Check that the showcase's `library-loop: F1.1` and `F1.2` marks can go.
