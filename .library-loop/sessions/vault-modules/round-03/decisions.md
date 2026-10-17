## Policy · round 2 proposals
Accepted. `design.md` now says that the reviewer gets only the tools that declare `readOnly` and its own `yami_review`, and that a tool that changes nothing sets `readOnly: true`.

## F2.1 · library
Accepted. Any host that shows a run's end needs the reason, so it passes the generality test. Give the reason for `failed` and for `needs-attention`, the same text that Progress records.

## F2.2 · library
Scope it to the base skill, which Yami itself ships, and do both options:
- When the file in the vault equals a text of the base skill that an earlier version of Yami shipped, Yami replaces it with the current text. The person never edited it, so nothing of theirs is lost. Keep the earlier texts, or their hashes, in the library's code. Do not write a state file into the vault.
- When the file differs from every shipped text, it holds the person's edits. Yami keeps it, and `yami.problems` reports that the base skill differs from this version's text, with the path and how to get the new text.

Test both cases, and a vault with no file. Update `design.md` Entities item 5 only through a `## Policy` proposal in `response.md`. The same question for the documents of code modules is out of scope: the overseer takes it to the user.

## F2.3 · library
Accepted. Export the version from the package entry `yami`, and test that it equals `package.json`.
