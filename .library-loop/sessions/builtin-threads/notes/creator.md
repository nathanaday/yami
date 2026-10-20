# Creator notes · builtin-threads

## Round 1 (0.15.0)
- Threads: `src/module/threads/` (index, ops, thread, documents as TS strings). Entry `src/threads/index.ts` → `yami/threads`. Class renamed `ThreadsModule` (like `WikiModule`); `parse/phase/next` → `parseThread/threadPhase/nextStep`; added `threads.status(thread?)`. Own color `#6e56cf`, outside MODULE_COLORS, so host colors stay stable. Board and `find` leave out sessions of other flows in `threads/`.
- Wiki moved to `src/module/wiki/` (index, ingest briefs, checkout). Checkout methods on `WikiModule`; types `CheckoutOrder`, `Checkout`, `ReturnedCheckout` exported from `yami`. `MAX_DOCUMENTS` not exported (no need seen). `wiki_checkout` is last in the wiki tools.
- Vault flows: `YamiModule.vaultFlows`; `flows` is a getter; vault flows held in a WeakMap in module.ts (`setFromVault`, `isVaultFlow`, internal). `readVaultModules(vault, code)` returns `extended`. Vault flow fields are per-flow (not added to the schema); the prompt lists `flow.fields` keys too. Field check uses `validate` against the module schema.
- `yami.createForm(module, kind, name)` discovers after the write. Starter flow uses YAML comments (no body allowed).
- Commands: key of a `new` command is the flow; action command names lower-case their first letter unless the first word is in capitals (break, in CHANGELOG). `ObsidianYami.ask` added for the prompts and for tests.
- Agent-tool tests (R12) build with `threads: false` so expectations stay unchanged. Fixed a 20 ms sleep race in reads.test.ts.
- Policy proposal: add `yami/threads` to design.md's entry list and Layers.

## Watch next round
- Does the consumer want a typed accessor (`yami.threads`) instead of `yami.module("threads") as ThreadsModule`? Generality: likely yes for both built-ins; decide on evidence.
- The lower-case action names: contested? The README example already used it.
- Live test (`YAMI_LIVE_THREAD=1`) not run this round: it needs a real Claude Code.
