# Feedback · round 2

verdict: done

I adopted 0.17.1 in the panel and removed both workarounds. `CHANGE_STATUS_LABELS` from `yami/wiki` replaces the panel's own table, so the status line, the marks, and the Applying… button label share the library's words. The gate on `details.status` before `write.changed` is gone (F1.1). `act()` is now one call, `await this.yami.runChangeAct(act)`, with the refusal caught for the page (F1.2); the `REJECT_*` imports and the `ask` sequence left the plugin. The look and motion of the panel are as they were. One small change in view state: the prompt of a reject now sits inside `runChangeAct`, so the panel shows an in-progress state for approve only (see F2.1). The Obsidian test gained a step: Escape in the reject prompt leaves no refusal on the page and keeps the acts, which is what the docs say.

Checks: `npm run build` and `npm test` (9 tests) pass. `npm run test:obsidian` passed 23 of 23 on the first build; on the final build, 22 of 23, and the one failure is the Codex `429 Too Many Requests` in "calls a module tool from both agents", which passes alone, as it did in round 1. The change-approval test passed in every run.

The guard blocked me once: I grepped `node_modules/yami/package.json` for the version out of habit, before I read the README's new line. `VERSION` from `yami` answered it (0.17.1), so there is no docs item for it.

## F2.1 · ergonomics · nit · `runChangeAct` gives no sign when its prompt ends and the run starts
A view that shows an act in progress sets that state when it calls the act. With a reject, the call first opens the reason prompt, so the state would show under the modal, and a cancel would flash it back. Round 1 set the state after its own `ask`. The panel now shows the in-progress state for approve only; the reject is one write, and the prompt is its feedback, so nothing is lost. But a view that wants "Rejecting…" cannot have it without `act.run` and its own prompt again.

**Tried**
```ts
this.applying = details.path;        // approve only: a reject would show "Rejecting…" under the prompt
void this.render();
await this.yami.runChangeAct(act);
```

**Wish**
```ts
await this.yami.runChangeAct(act, { started: () => { this.pending = act.kind; void this.render(); } });
```

A nit: the result is the same for the person.
