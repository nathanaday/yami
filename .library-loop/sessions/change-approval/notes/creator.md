# Creator notes · change-approval

## Round 1
- Built 0.17.0: `change()` proposes; `approve()`, `reject()`, `changes()`, `changeDetails()`, `changeActs()` on `Wiki`; four commands; the ingest's checks `proposed` and `absorbed` in `src/module/wiki/ingest.ts`; `clean-topics` has no check (the review judges it).
- The change document is the one record: `readProposal` in `src/wiki/change.ts` parses the Writes section (`### <op> · <path>`, the why, `<!-- hash: … -->`, a `markdown` block with the note whole). A modify applies the note whole. `changed` in details compares the hash of the note's text at proposal with the text now.
- Kept the promise name `change-applied` because R8 says it "becomes" the proposed-or-applied promise and old sessions link it. If the consumer finds the name misleading, a rename to `change-proposed` is a small break (session links, install files).
- `age()`, `REJECT_*` texts, and `AskOptions` are exported from `yami/obsidian`.
- Proposed a policy line for design.md "The wiki" item 8 about the document as the one record.

## Watch next round
- A view will want the diff texts: `before`/`after` are whole serialized documents; a host diffs them itself. If the consumer asks for a line diff, decline: it is a view concern, and `diff-match-patch-es` is already a dependency a plugin can use.
- `changes()` reads every change document on each call; a vault with hundreds of changes may want the list cached or filtered by folder listing. Measure before adding.
- The showcase panel (not mine) must take the change API; design.md item 5 expects a use in the showcase.
