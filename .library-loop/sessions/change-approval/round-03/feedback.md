# Feedback · round 3

verdict: done

I adopted 0.17.2 in the panel. `act()` passes `started` to `runChangeAct`, and the in-progress state (`pending`, the path and the kind) is set there, not before the call. So the page shows "Applying…" at once for an approve, "Rejecting…" after the reason prompt for a reject, and nothing under the prompt; Escape leaves the page as it was. The state line, the mark, and the button share the word: `CHANGE_STATUS_LABELS.applying` for an approve, "Rejecting" for a reject. The rest of the panel is as it was. The Obsidian test gained one assertion: after Escape in the reject prompt, the state line still reads "Waiting for approval", which shows that `started` did not fire. The plugin README's panel line says that Reject shows Rejecting while it writes.

`grep -rn "library-loop" src/` is empty: the panel has no workaround. F2.1 is closed; the call site is the one I wished for.

Checks: `npm run build` and `npm test` (9 tests) pass. `npm run test:obsidian` passed 23 of 23 on the final build, the Codex test included this time.

The guard blocked me once, on `git show <commit>:<path>` without a pathspec, while I looked at the panel's own round 1 code, not the library. No docs item: the README and the d.ts told me everything about `started`, including the order with a refusal.

## F3.1 · nit · nit · The library names "Rejecting…" in its docs but gives no word for it
`CHANGE_STATUS_LABELS` gives the word for each status, and `applying` is one, so the approve in progress uses the library's word. A reject in progress is not a status, so the library has no word for it, and the README of `runChangeAct` says "so a view shows "Rejecting…" or "Applying…"", a word that only the view can hold. The panel keeps a two-entry table of its own:

```ts
const BUSY: Record<ChangeAct["kind"], string> = { approve: CHANGE_STATUS_LABELS.applying, reject: "Rejecting" };
```

Every view that shows the act in progress writes this table. A word on the act would end it, as `label` already holds the word at rest:

```ts
button.setText(`${act.busy}…`);   // "Applying", "Rejecting"
```

A nit: the table is one line, and the words will not change often.
