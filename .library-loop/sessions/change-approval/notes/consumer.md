# Consumer notes · change-approval

## Round 1

Built the approval into the showcase panel, `obsidian_plugin/src/panel/`:

- `view.ts`: a `change` place below Wiki; "Waiting for approval" at the top of Modules and above the Wiki module's sessions (`wiki.changes()`); the badge on the Wiki row adds the proposals; the change page over `wiki.changeDetails` with the acts from `wiki.changeActs`; a reject asks with `REJECT_PLACEHOLDER/HINT/EMPTY` from `yami/obsidian`; `pending` and `refusal` are view state, since a refusal writes nothing and the feed stays quiet; `shown` remembers the last waiting list so a new row enters and a finished one fades.
- `diff.ts`: `diffLines(before, after, context)` over `diffOps`; unit test in `test/unit/diff.test.ts`.
- `panel.css`: the change page, the diff, the marks for the change statuses, the row enter and leave.
- Obsidian test: "lists the wiki's proposals in the panel, …", after the checkout test. It proposes through the `wiki_change` tool with an ingest session from `yami.ingest`.

Workarounds in the code, marked `library-loop: F1.n`:
- F1.1 `write.changed && status === "proposed"`: `changed` is true on every applied modify.
- F1.2 the reject ask + run + notify in `act()`: the commands do the same; wished `yami.runChangeAct(act)`.

Learned by running the API (not in the docs): a modify's `after` holds the whole note with the merged properties; a created topic gets `tags: []`, `aliases: []`, `sources: []`, `status: draft` added, so its diff has 9 added lines for a one-line body; `InvalidPlan.message` is multi-line with `- write N (...)` items; `ChangeSummary.created` has no zone.

Obsidian suite: a `page.evaluate` that returns a `TFile` (as `vault.create` does) throws "Attempting to serialize"; wrap it in `void (await …)`. The Codex test "calls a module tool from both agents" can fail with a live `429 Too Many Requests`; rerun it alone with `npx vitest run test/obsidian -t "calls a module tool"`.

Guard blocked once: I read `node_modules/yami/package.json` for the version out of habit. `VERSION` from `yami` answers it.

## Next round

- Remove each workaround that the CHANGELOG covers; `grep -n "library-loop" src/`.
- If `CHANGE_STATUS_LABELS` arrives, drop `CHANGE_LABELS` in `view.ts`.
- The Obsidian test depends on the created topic's property order (9 add lines); if the page forms change, that expectation moves.
- Check the test's `names()` on the Modules page still equals the three modules: a proposal that a test leaves waiting would add a row name.
