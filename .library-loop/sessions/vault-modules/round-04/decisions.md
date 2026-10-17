## Obsidian · library · major · The review crashes in the real app
The overseer ran the real Obsidian tests with Claude Code. In one run, the session's checks passed and then the review crashed. The session ended `failed`, and its Progress said:

```text
- 14:31 iteration 1: 1 met, 0 unmet
- 14:31 iteration 1: review failed: Cannot read properties of undefined (reading 'length')
```

The setup:
- The session belonged to a vault module.
- The vault also held a note, elsewhere, whose properties do not parse.
- The run went through `createYami` and the Obsidian conversation layer, with the Claude harness.

In another run in the same app, with no broken note, the review worked. The design says that one broken note never stops another session. Find the cause. Write a test that fails before the fix, in `yami/testing` or over the fake Obsidian app, whichever reaches the cause. Then fix it.

Also, an exception in Yami's own code during a review is not a harness failure. Decide whether it should end the run `failed` with the stack's first frame in the reason, or `needs-attention`, and document the choice.

## F3.1 · library
Accepted. A check that returns `review` has its own detail. Any host needs it, so it goes in `RunResult.reason`.

## Obsidian · consumer
The overseer's Obsidian run failed three tests. The output is in your prompt.
- Fix the tests that still use the API of the old code module.
- In the stop-and-resume test, the conversation record held three user messages, not two. Find out from the run what the third one was. When it is review feedback, the library works as designed: make the test check that. When it is something else, file it.

To check your fixes, you may run single Obsidian tests with `npm run test:obsidian -- -t "<test name>"`. Each run costs real agent turns, so run only the tests you changed.
