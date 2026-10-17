# Feedback · round 3

verdict: done

I adopted the three answers of round 2. The threads budget test now checks `RunResult.reason`, and the reason showed in the diff on the first try, as the response said. The panel needed no code change for the base skill problem: it never looked up `yami.module(problem.module)`, and the home page lists every problem. I changed only the doc comment of `problems()`, and one README line that says the Problems list can name the base skill. A new step in the Obsidian problems test edits `BASE_SKILL`, waits for its problem row, checks that the message names `VERSION`, deletes the file, and waits for the row to go and for `BASE_SKILL_TEXT` to come back. A short probe printed `VERSION` as `0.4.0`. The plugin does not show the version, because the brief asks for no such view. `npm run build` passes, and `npm test` passes 83 of 83. I did not run `npm run test:obsidian`, because the overseer runs it.

The guard blocked me once. That block was my error: I read my own session files with `cat` in Bash, not with the Read tool. The docs did not cause it.

## F3.1 · ergonomics · minor · A run that a check sends to a person gives counts as its reason, not the check's reason
The threads budget test ends `needs-attention`, because the `thread` check returns `review`. `RunResult.reason` holds only the counts:

```ts
const result = await t.yami.session(PATH).start();
// result.reason: "iteration 1: 0 met, 0 unmet, 1 for review"
```

What the person must do is only in the Deliverables line of the document:

```text
- [ ] [[internal/threads/promises/Thread closed|Thread closed]] — ask the user: the thread used its 1 rounds, and round 1 failed
```

The act's notice ends with the same counts, so a person who runs the session from the command palette reads "1 for review" and must open the document to learn why. This is the main case of `needs-attention`: the docs say that a check returns `review` when the user must decide. The F2.1 ruling asked for the Progress text, and the creator did what it said. This item asks that the Progress line, and so the reason, name each item for review and its check's reason.

**Wish**
```ts
// result.reason: "iteration 1: 0 met, 0 unmet, 1 for review: Thread closed — ask the user: the thread used its 1 rounds, and round 1 failed"
expect(result).toMatchObject({ state: "needs-attention", reason: expect.stringContaining("used its 1 rounds") });
```
