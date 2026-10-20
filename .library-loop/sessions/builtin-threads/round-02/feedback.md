# Feedback · round 2

verdict: done

The showcase is on 0.16.0. The plugin code did not change: `src/main.ts` and the views do not read `schema`, so the breaking changes of the CHANGELOG did not reach them. The Obsidian tests now drive the prompts by their documented names. `Threads: create <kind>` and New module use `.yami-ask input.prompt-input`, and click the item `Create the <kind>: <name>`. `Threads: create a flow session`, Wiki: restore a version, and Wiki: ingest a folder use `.yami-pick .suggestion-item`. The test checks the placeholder `The flow of the new Threads session`, and that the picker offers the item text `Daily review`. The test also checks that the session of `daily-review` holds no key of `threads.thread.schema`. For contrast, a new thread made with `threads.thread.create` holds `repositories`, `after`, `retired`, and `tags`. A new thread does not hold `description`, `priority`, `budget`, or `phase`, because they have no default. That agrees with the README rule that `flow.create` fills in the defaults. The plugin README now says that a session of your own flow gets no thread field.

F1.1, F1.2, and F1.3 are fixed. The `wiki_checkout` docs now give the result that my test parses.

Checks: `npm run build` passes, and `npm test` passes (3 tests). In the full run, `npm run test:obsidian` passed 21 of 22 tests. The one failure was Codex in "calls a module tool from both agents", which ended with `exceeded retry limit, last status: 429 Too Many Requests`. That is an outside rate limit. Run again alone, that test passes. The acceptance greps find nothing, `src/modules/` does not exist, and `createYami` gets agents only.

The guard blocked three calls. None of them came from a gap in the docs. The first was an `ls` of the session folder, and the Read tool worked. The second was a compound command that named `node_modules/yami`. The third was the acceptance grep for the `yami/src` import, which I ran again with another pattern.

Policy: I support both proposals of the creator's response, for the `this.flow(...)` bullet and for Threads item 7. The second one matches what the test now holds.

## F2.1 · docs · minor · The hint of each built-in `ask` prompt is not documented
"The prompts" gives the item text as `<hint>: <text>`, with one example: `Create the flow: Daily review`. The library chooses the hint of New module and of each `<Module>: create <kind>` command. design.md, Documentation item 2, makes it public API, because a host's test clicks the item by its text. I guessed that the other kinds follow the pattern. The guess passed:

```ts
await page.locator(".yami-ask .suggestion-item", { hasText: `Create the ${kind}: ${name}` }).click();
```

For New module, I could not guess the hint, so I match on the name alone:

```ts
await page.locator(".yami-ask .suggestion-item", { hasText: "Hello" }).click();
```

Add one line to the table: the hint of `<Module>: create <kind>` is `Create the <kind>`, for `agent`, `flow`, `policy`, `promise`, and `skill`. Also give the hint of New module.
