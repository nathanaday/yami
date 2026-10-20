# Task: approve and reject change plans in the Yami panel

The wiki now changes in two steps: an agent proposes a change plan as a change document, and a person approves or rejects it. The library gives the proposals, their details, their acts, the commands, and a feed. Build the approval into the showcase's panel, `obsidian_plugin/src/panel/`, so a person sees what waits, reads exactly what a plan does, and approves or rejects it there, with a clear result in both cases. The document itself gets no button and no callout: the acts are in the sidebar and the command palette.

Read `design.md` first: "The library and the plugin" item 2, "The wiki" items 8 and 9, and "Do not" item 9. The panel holds layout and look only; what it shows and does comes from the public API. When the panel needs something the library does not give, that is feedback.

## What to build

Spend care on this. It must be intuitive, beautiful, and satisfying to use, in Obsidian's own idiom: its variables, its icons, its motion. Feedback on success and on failure is clear and immediate.

1. **What waits.** At the top of the Modules page, before the module list, a section for the proposals that wait, in the manner of "Working now": one row per proposal, with its title, the counts as a short line (`2 new · 1 changed · 1 removed`), how old it is, and the module of the session that proposed it. The section's count is the number waiting. The Wiki module's row carries a badge with that number. The Wiki module's page lists its proposals above its sessions. An empty state says that nothing waits.
2. **One change.** A row opens a change page in the panel, a level below the Wiki module, with a breadcrumb back. The page shows: the title, the status with a mark, when it was proposed and by which session (a link to the session page), the notes, and each write in a group by op: created, changed, removed. Each write shows its path (click opens the note, or for a create, the change document), its `why`, and for a change a diff of the text before and after, built with `diffOps` from `yami/document`: insertions and deletions marked in the text, with unchanged context collapsed. A create shows its text; a remove shows what goes. A `modify` whose note changed since the proposal shows a warning line before the diff. The change document itself opens from the title.
3. **The acts.** Approve is the lead button; Reject is plain. They come from the library's acts, so they appear only while the change is proposed. On approve: the button shows that it works, the page shows `applying`, and then the result: a success state on the page (`Applied · v3 → v4`, the counts, each write now marked done) and a notice. On a refusal or a failure: the page shows the reasons inline, in the error style, and the acts come back where the change stays proposed. On reject: a prompt for the reason (optional), then the page shows `rejected` with the reason. After either, the row leaves the waiting list and the badge drops. Keyboard: the acts are reachable with Tab; Enter activates; Backspace goes up.
4. **Motion.** A new proposal's row enters with the panel's existing enter animation. A finished change's row leaves with a short fade. Nothing moves longer than Obsidian's own transitions.
5. **Tests.**
   - A unit test of the diff rendering over `diffOps` (no Obsidian): insertions, deletions, and collapsed context.
   - Obsidian tests: an ingest session's plan, proposed through the `wiki_change` tool, appears in the waiting list with its counts and badge; its page shows the writes and a diff; Approve applies it, the page shows the success state, the wiki holds the note, and the row leaves the list; a second proposal is rejected with a reason, and its document records the reason; a proposal that no longer validates shows the refusal inline and stays proposed; the commands `Wiki: approve this change` and `Wiki: reject this change` work on the open document.
6. **README.** The plugin README's panel section describes the waiting list, the change page, and the acts.

## Acceptance

1. `npm run build` and `npm test` pass in `obsidian_plugin/`.
2. `npm run test:obsidian` passes in `obsidian_plugin/` (build first).
3. No file of the plugin imports from `yami/src`, and the panel reads nothing from the change document's text itself: every datum comes from the library's API.
4. The change document has no button, callout, or markup for approval.
