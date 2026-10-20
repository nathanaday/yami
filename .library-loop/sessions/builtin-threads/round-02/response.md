# Response · round 2

verdict: ready

Version 0.16.0. A flow can declare the session fields of its own sessions with `schema`. Threads puts the thread fields on the `thread` flow, and the wiki puts `sources` on `ingest` and `status` and `returned` on `checkout`. The prompts of `ask` and `pick` have the classes `yami-ask` and `yami-pick`, and a README table. The README states what `wiki_checkout` returns. Checks: `npm run build` passes, and `npm test` passes (29 files, 483 tests).

## F1.1 · accepted · A session of a person's own flow in threads gets the thread fields
Per the ruling, the fix is a general primitive and not a special case of threads. A second program needs it too: any module whose flows have different shapes needs it, and the wiki already did, because a checkout got the ingest's `sources: []`.

- `this.flow({ …, schema })` declares the session fields of that flow's sessions alone, with their types and defaults. The module's `schema` keeps only the fields that every session of the module shares. `flow.create` fills in the defaults of both schemas and validates against both. The first prompt of a run lists both. `Flow.schema` is `{}` by default.
- `Yami` refuses a flow schema that holds a core field, or a field that the module's schema declares, so each field has one type.
- Threads: `ThreadsModule.schema` is `undefined`, and `threads.thread.schema` holds `description`, `repositories`, `after`, `priority`, `budget`, `retired`, `phase`, and `tags`. A session of a vault flow gets the core fields and its own flow's `fields`, and nothing else:

```ts
await yami.createForm(threads, "flow", "Daily review");
await threads.flowOf("daily-review")!.create({}); // type, module, flow, and the core fields: no repositories, after, retired, or tags
```

- The wiki: `wiki.schema` holds `changes`, `wiki.ingest.schema` holds `sources`, and `wiki.checkout.schema` holds `status` and `returned`.

These are breaking changes for code that reads `threads.schema` or the moved fields of `wiki.schema`. The CHANGELOG gives the migration. A thread document does not change. A session of your own flow that 0.15.0 wrote keeps its four empty fields. No code reads them, so you can delete them by hand or leave them.

## F1.2 · accepted · The DOM of `ask` and `pick`, and the text of each flow in the picker, are not documented
The README section "The prompts", under `yami/obsidian`, is public API now. `ask` adds the class `yami-ask` to its prompt, and `pick` adds `yami-pick`, so a test can tell them apart from the command palette, which is also a `.prompt-input` prompt. The table names the text field, `input.prompt-input`, and the items, `.suggestion-item` and `.is-selected`. It also gives the text of each item. In `ask`, the one item reads `<hint>: <text>`, for example `Create the flow: Daily review`, and the prompt shows `Type a name.` before the person types. In `pick`, an item reads `label(item)`. In `<Module>: create a flow session`, an item reads the flow's `title`, for example `Daily review`, and the placeholder is `The flow of the new <Module> session`. A unit test holds the classes and the item texts.

```ts
await page.locator(".yami-ask input.prompt-input").fill("Daily review");
await page.locator(".yami-ask .suggestion-item", { hasText: "Create the flow: Daily review" }).click();
await page.locator(".yami-pick .suggestion-item", { hasText: "Daily review" }).click();
```

Your selectors `.prompt-input` and `.suggestion-item` still work. Scope them with `.yami-ask` or `.yami-pick`.

## F1.3 · accepted · What `wiki_checkout` returns is not documented
The README's Checkouts section has the bullet "What `wiki_checkout` returns". The tool returns the `Checkout` of `makeCheckout` as JSON text, `{"session": "...", "copies": [...]}`, with the copies in reading order. When it refuses an order, it writes nothing. Its `run` throws the error of `makeCheckout`. Through `runTool`, which is how an agent calls it, the result is `{ isError: true, text }` with the error's message. An input that the schema refuses gives `The input is not valid:`. The tool's description and the doc comment of `makeCheckout` say the same, and a test holds both results. Your call site stays as it is:

```ts
const made = JSON.parse(await tool.run({ request, name: "Compost", documents }, { signal })) as Checkout;
```

## Policy
- `design.md`, Modules, the `this.flow(...)` bullet: after the list of keys, add: "A flow's `schema` declares the session fields of its sessions alone. The module's `schema` holds the fields that every session of the module shares. A field is in one of them, never in both." The `FLOW.md` keys do not change.
- `design.md`, The built-in modules, Threads item 7: after "They are not threads", add "and get no thread field". The thread fields are the `thread` flow's schema.
