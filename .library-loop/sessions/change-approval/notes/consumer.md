# Consumer notes · change-approval

## Round 1

Built the approval into the showcase panel, `obsidian_plugin/src/panel/`:

- `view.ts`: a `change` place below Wiki; "Waiting for approval" at the top of Modules and above the Wiki module's sessions (`wiki.changes()`); the badge on the Wiki row adds the proposals; the change page over `wiki.changeDetails` with the acts from `wiki.changeActs`; `refusal` is view state, since a refusal writes nothing and the feed stays quiet; `shown` remembers the last waiting list so a new row enters and a finished one fades.
- `diff.ts`: `diffLines(before, after, context)` over `diffOps`; unit test in `test/unit/diff.test.ts`.
- `panel.css`: the change page, the diff, the marks for the change statuses, the row enter and leave.
- Obsidian test: "lists the wiki's proposals in the panel, …", after the checkout test. It proposes through the `wiki_change` tool with an ingest session from `yami.ingest`.

Learned by running the API: a modify's `after` holds the whole note with the merged properties; a created topic gets `tags: []`, `aliases: []`, `sources: []`, `status: draft` added, so its diff has 9 added lines for a one-line body (the README says so since 0.17.1); `InvalidPlan.message` is multi-line with `- write N (...)` items; `ChangeSummary.created` has no zone.

Obsidian suite: a `page.evaluate` that returns a `TFile` (as `vault.create` does) throws "Attempting to serialize"; wrap it in `void (await …)`. The Codex test "calls a module tool from both agents" fails with a live `429 Too Many Requests` about every other full run; rerun it alone with `npx vitest run test/obsidian -t "calls a module tool"`. Save the suite's output to a log: a full run is 4 minutes.

## Round 2

Library 0.17.1 closed F1.1 to F1.5. Removed both workarounds; `act()` is `await this.yami.runChangeAct(act)` with the refusal caught; `CHANGE_STATUS_LABELS` from `yami/wiki` replaces the panel's table. The Obsidian test gained an Escape step in the reject prompt. Checks pass; the one Obsidian failure in a full run was the Codex 429 again.

The guard blocked me again on `node_modules/yami/package.json`. Do not grep it. `node -e "import('yami').then(m => console.log(m.VERSION))"` in the plugin folder gives the version.

## Round 3

Library 0.17.2 closed F2.1: `runChangeAct(act, { started })`. `act()` sets `pending` (`{ path, kind }`) in `started`, so "Rejecting…" shows after the prompt and "Applying…" at once; `BUSY` holds the two words (F3.1, a nit: the library has no word for a reject in progress). The mark turns with `data-status="applying"` for both kinds. The Obsidian test checks the state label after Escape. README line updated.

The guard blocks `git show <commit>:<path>` without a pathspec: add `-- obsidian_plugin` to every git read.

## Next round

- `grep -n "library-loop" src/` should stay empty.
- If F3.1 lands (a busy word on the act), delete `BUSY` in `view.ts` and use it in `drawChange`.
- The Obsidian test depends on the created topic's property order (9 add lines); if the page forms change, that expectation moves.
- Check the test's `names()` on the Modules page still equals the three modules: a proposal that a test leaves waiting would add a row name.
