# Creator notes · builtin-threads

## Round 1 (0.15.0)
- Threads: `src/module/threads/` (index, ops, thread, documents as TS strings). Entry `src/threads/index.ts` → `yami/threads`. Class `ThreadsModule`; `parseThread/threadPhase/nextStep`; `threads.status(thread?)`. Own color `#6e56cf`, outside MODULE_COLORS.
- Wiki in `src/module/wiki/` (index, ingest briefs, checkout). Checkout methods on `WikiModule`; types `CheckoutOrder`, `Checkout`, `ReturnedCheckout` from `yami`.
- Vault flows: `YamiModule.vaultFlows`; `flows` is a getter; vault flows in a WeakMap in module.ts (`setFromVault`, `isVaultFlow`). Vault flow fields checked against the module schema only.
- `yami.createForm(module, kind, name)`; commands `<Module>: create <kind>` and `create a flow session`; `ObsidianYami.ask`.

## Round 2 (0.16.0)
- F1.1 (ruled library): general primitive `FlowOptions.schema` / `Flow.schema` = fields of that flow's sessions alone. createSession merges SESSION + module.schema + flow.schema; the prompt lists flow.schema keys. Yami ctor refuses a flow schema with a core field or a module-schema field. Threads: thread fields moved to the `thread` flow, `ThreadsModule.schema` undefined. Wiki: `changes` in module, `sources` on ingest, `status`/`returned` on checkout. Breaking, in CHANGELOG.
- F1.2: `askText`/`pickOne` add `yami-ask`/`yami-pick` to `modalEl`; README "### The prompts" table (public API). Test `test/unit/obsidian/prompts.test.ts` with a fake SuggestModal; the commands test checks the picker labels (flow.title).
- F1.3: README bullet, tool description, and makeCheckout doc: JSON `{session, copies}`; a refusal throws from `run`, and `runTool` gives `{isError, text}`. Test in checkout.test.ts.
- Policy proposal: design.md Modules flow bullet (flow schema), Threads item 7 ("no thread field").

## Watch next round
- I did not document `.suggestion-empty` (Obsidian's class, not verified in the real app). If the consumer's Obsidian test shows that `.yami-ask` is not on the element it expects, check `modalEl` in the real app.
- `FLOW.md` has no `schema` key. A vault flow's `fields` are values only. Add a key only if a consumer asks for one.
- Typed accessor (`yami.threads`) still not asked for.
- The live thread test (`YAMI_LIVE_THREAD=1`) was not run. It needs a real Claude Code.
