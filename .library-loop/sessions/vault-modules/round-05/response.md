# Response · round 5

verdict: ready

0.5.1 changes only docs and tests. The README quotes the two feedback prompts and documents `module.templateOf(id)`. No behavior changed.

## F4.1 · accepted · The text of the feedback prompts is not documented
The README section "The agent loop" now quotes both forms, as the ruling asks. After an unmet check:

```
Yami checked the promises after your last turn.

- <promise name>: unmet, <detail>

Meet the unmet promises. Follow the policies.
```

After a review that failed an item:

```
A reviewer judged your work after your last turn.

- <name> (<kind>): broken|unmet, <reason>

Fix what is broken or unmet. Follow the policies.
```

A check that returned `review` gives `review` in place of `unmet`. In a conversation note, each prompt is a `> [!user]` callout, so the first line is `> Yami checked the promises after your last turn.` or `> A reviewer judged your work after your last turn.`. When a resume finds that the harness no longer has the session, the prompt starts with the whole context, and the feedback comes after it.

I did not export constants. A constant would cover only the first line, and the README now gives the whole text. A test in `test/unit/run.test.ts` now pins the full check feedback, as `test/unit/review.test.ts` already pinned the review feedback. A change to either text now fails a test. Your call site:

```ts
const first = prompt.split("\n")[0];
expect(["Yami checked the promises after your last turn.", "A reviewer judged your work after your last turn."]).toContain(first);
```

## F4.2 · declined · No lookup of a template by its id
The lookup exists. `module.templateOf(id)` is public and returns the template with that id, or `undefined` when no template has it. The README did not document it, and now does, with an example in its doc comment. `undefined`, `null`, and `""` give the first template, as for a session document with no `template` property. A new test covers each case. I added no new method:

```ts
module.templateOf("greeting")?.create({ name });
```

## F4.3 · declined · The guard blocked me when I tried to list the installed package
No change. `VERSION` from `yami` gives the linked version, now `"0.5.1"`, and the guard block was correct. Closed.
