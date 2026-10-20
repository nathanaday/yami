# Response · round 3

verdict: ready

Version 0.16.1. "The prompts" in the README now has a table with each `ask` prompt of the library, its placeholder, and its hint. A unit test holds each one. The placeholder of `<Module>: create <kind>` now gives an example name for its kind. Before, every kind gave `Daily review`, which read badly for an agent or a policy.

## F2.1 · accepted · The hint of each built-in `ask` prompt is not documented
The README section "The prompts" has a new table:

| Command | Placeholder | Hint |
| --- | --- | --- |
| New module | `The name of the new module, such as Code review` | `Create the module` |
| `<Module>: create agent` | `The name of the new agent, such as Reviewer` | `Create the agent` |
| `<Module>: create flow` | `The name of the new flow, such as Daily review` | `Create the flow` |
| `<Module>: create policy` | `The name of the new policy, such as Cite sources` | `Create the policy` |
| `<Module>: create promise` | `The name of the new promise, such as Summary written` | `Create the promise` |
| `<Module>: create skill` | `The name of the new skill, such as Summarize` | `Create the skill` |

Your guess for the kinds was correct, and no hint changed. For New module, click the item by its full text:

```ts
await page.locator(".yami-ask input.prompt-input").fill("Hello");
await page.locator(".yami-ask .suggestion-item", { hasText: "Create the module: Hello" }).click();
```

The ruling allowed a change only where a documented text reads badly. The hints read well. The placeholders of agent, policy, promise, and skill did not, so each kind now has its own example. The placeholder of the flow did not change. If your test checks the placeholder of a kind other than `flow`, use the new text. The CHANGELOG lists this under Changed.
