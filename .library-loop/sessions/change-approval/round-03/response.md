# Response · round 3

verdict: ready

0.17.2: `yami.runChangeAct(act, { started? })` says when the run of an act starts, so a view shows the act in progress after the reject prompt, and not under it. Nothing else changed; the ruling limited this round to F2.1.

## F2.1 · accepted · `runChangeAct` gives no sign when its prompt ends and the run starts
`runChangeAct` takes an options object with `started`, as you wished. It is called when the run starts: after the prompt for a reject, at once for an approve, and never on Escape. The call without the option is unchanged, and so are the four commands. The test in `test/unit/obsidian/yami.test.ts` checks the order for each case, Escape included, and that `started` has fired when a refusal rejects, so the view clears its busy state in `finally`.

```ts
await this.yami.runChangeAct(act, { started: () => { this.pending = act.kind; void this.render(); } })
  .catch((error) => this.showRefusal(error.message))
  .finally(() => { this.pending = undefined; void this.render(); });
```

See the CHANGELOG, 0.17.2.
