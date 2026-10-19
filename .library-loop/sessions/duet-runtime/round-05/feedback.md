# Feedback · round 5

verdict: done

Duet runs on Yami 0.14.0 (`VERSION` gives `0.14.0`). It has no `library-loop:` workaround. `plugin/src` did not change: 1,792 lines (2,023 at the start).

**F4.1 is closed.** Only `test/obsidian/plugin.test.ts` changed (23 lines added, 13 removed). Each presence and question selector now comes from the README tables:
- The mention test waits for `.workspace-leaf.mod-active .yami-caret`, and expects `.yami-caret-name` to be `claude`. Before, it expected the whole flag to contain `claude`.
- The edit test waits for `.workspace-leaf.mod-active .yami-fresh`.
- The question test scopes each selector to `${box}.has-approval .yami-approval .yami-questions`. It finds the question on screen with `.yami-question:not([hidden])`, so the `$$eval` filter on `hidden` is gone. It picks an option by `.yami-question-label:text-is("Pear")`, not by `:has-text`. It waits for `.yami-question-progress:text-is("2 of 2")`, as the creator suggested, so the `waitForFunction` is gone. It types the person's own answer in `input.yami-question-other`.
- The question test also walks the new names. `button[data-action="back"]` is hidden on the first question. After the second question shows, Back shows `1 of 2`, Next is enabled, and Next shows `2 of 2` again.

Each name did what the table says, on the first run, with no probe.

**F4.2 is closed.** The README lists the five facts under `start`, and `manager.d.ts` says the same. They match what the Obsidian test "starts a conversation for another plugin through the API" checks. `docs/design.md` (API for other plugins) took the sentence that I proposed, so each guarantee that Duet gives now points to a fact that Yami's docs state.

Checks: `npm run typecheck` passes. `npm test` passes 42 tests. `npm run plugin:build` passes. The acceptance grep finds nothing. `npm run test:obsidian` passes 22 of 22 in 2 of 2 full runs (94 s and 82 s), with a real Claude Code and Codex.

**What a Duet user sees.** No change from round 3. `docs/design.md` (Vault files) holds the table.

**Policy.** No new proposal. `yami/design.md` (Documentation, item 2) and `docs/design.md` (API for other plugins) now hold the round-4 proposals, and I found no sentence in either that the code contradicts.

## F5.1 · docs · nit · Two facts that Duet's question test depends on are not in the table
**Tried** (`test/obsidian/plugin.test.ts`)
```ts
expect(await page().textContent(`${box} .yami-approval`)).toContain('claude asks you');   // text not named
await page().click(`${form} button[data-action="back"]`);
expect(await page().isEnabled(submit)).toBe(true);                                         // Back keeps the answer: not stated
```

**Wish** (two more words in the table)
```md
| `.yami-approval .yami-questions` | the form | ... Its heading is `<agent> asks you`. |
| `.yami-questions button[data-action="back"]` | Back: shows the question before, with its answer kept | `hidden` on the first question |
```

Both facts held in 2 of 2 runs. But I learned them from a run, not from the README. The heading text is outside each named part, so by `design.md` (Documentation, item 2) it is internal, and Duet's test reads it. A nit: the test can drop the heading check, and the kept answer is what a person expects.
