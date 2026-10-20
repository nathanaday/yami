# Feedback · round 1

verdict: done

I built the approval into the showcase panel over the new change API: a "Waiting for approval" list at the top of Modules and above the Wiki module's sessions (`wiki.changes()`), a badge on the Wiki row, a change page a level below Wiki over `wiki.changeDetails` with each write's diff from `diffOps`, and Approve and Reject from `wiki.changeActs`, with the result or the refusal on the page. The ingest proposes through `wiki_change`, the panel hears of it through `onSessionsChange`, and the two commands work on the open document. `diffLines` in `src/panel/diff.ts` has a unit test; the Obsidian test proposes four plans through the tool and approves, rejects, refuses, and runs the commands. Checks: `npm run build` and `npm test` (9 tests) pass; `npm run test:obsidian` passes 22 of 23 in one run, and the one failure, a Codex `429 Too Many Requests` in "calls a module tool from both agents", passes when run alone (a live rate limit, not the library).

The API did what the README says, and it was short to use: `changes()`, `changeDetails()`, and `changeActs()` were the whole read side, and the `REJECT_*` texts made the reject prompt one line. The feed fired for every proposal, approval, and rejection. What remains is below: one flag that reads wrong after an approval, and two places where every view repeats the commands' work.

## F1.1 · bug · minor · `changed` is true on every applied modify
After an approval, `changeDetails(path)` flags each modify and remove with `changed: true`, since the note now holds the write and no longer matches the hash the proposal read. The README defines the flag as "the note's text now is not the text the proposal read, so an approval overwrites a later edit; a view warns before the person approves", and its own example warns on it with no look at the status:

**Tried**
```ts
const details = await wiki.changeDetails(path);          // status: "applied"
details.writes.map((w) => [w.path, w.changed]);           // [["wiki/topics/Compost.md", true]]
if (details.writes.some((w) => w.changed)) warn("A note changed since the proposal.");   // the README's example: warns on every applied change
```

**Wish**
```ts
// `changed` is set only while the change is proposed; undefined once it is applied, failed, or rejected.
if (write.changed) warn(…);
```

The panel gates on the status for now (`library-loop: F1.1` in `src/panel/view.ts`). Either make the flag undefined for a change that is not proposed, or say in the README and the doc comment that it holds only for a proposal.

## F1.2 · ergonomics · minor · A view repeats what the reject and approve commands do
The commands ask for the reason, run the act, and show the notice; a view does the same three steps again, and must also catch the refusal to show it inline. `runModuleAct(act)` exists for a module's acts; the change acts have no such call, so this is the third copy of the sequence (two commands, one panel).

**Tried**
```ts
let reason: string | undefined;
if (act.kind === "reject") {
  reason = await this.yami.ask(REJECT_PLACEHOLDER, REJECT_HINT, { empty: REJECT_EMPTY });
  if (reason === undefined) return;
}
try {
  const said = act.kind === "reject" ? await act.run(reason) : await act.run();
  void this.yami.notify(Promise.resolve(said));
} catch (error) {
  this.refusal = { path, message: (error as Error).message };
}
```

**Wish**
```ts
// Asks for the reason of a reject (Escape does nothing), runs, shows the notice; rejects with the refusal so a view can show it.
await this.yami.runChangeAct(act);
```

`act.run` stays for a host that prompts its own way. Marked `library-loop: F1.2` in `act()` of `src/panel/view.ts`.

## F1.3 · ergonomics · minor · No words for the change statuses
`STATUS_LABELS` gives the words for each session status, so every view says "Needs attention" the same way. `ChangeStatus` has no such table, so the panel wrote its own, and the notices of the commands already use "Applied" and "Rejected" with no shared source.

**Tried**
```ts
const CHANGE_LABELS: Record<ChangeStatus, string> = { proposed: "Waiting for approval", applying: "Applying", applied: "Applied", failed: "Failed", rejected: "Rejected" };
```

**Wish**
```ts
import { CHANGE_STATUS_LABELS } from "yami/wiki";
state.createSpan({ text: CHANGE_STATUS_LABELS[details.status] });
```

## F1.4 · docs · nit · A created note's diff shows properties the plan never named
`changeDetails` gives a create's `after` as the whole note the approval writes, with the defaults of the topic form filled in: `tags: []`, `aliases: []`, `sources: []`, `status: draft`. So a create with a one-line body shows nine added lines. That is right, since it is what the approval writes, but the README's "Changes and versions" says only "the whole note after the write"; a line that says the form's defaults are in it would have saved a run to see why the count was nine. Not a change to the code.

## F1.5 · docs · nit · Where to read the library's version
The guard blocked me once: I read `node_modules/yami/package.json` to check that the plugin had 0.17.0. `VERSION` in `yami` answers it, and `dist/version.d.ts` says so; the README's "Build and tests" section could name it in one line, since that is where a host looks when the build and the CHANGELOG seem to disagree.
