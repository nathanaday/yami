# Task: the plugin on module forms, flows, and agents

The library changed how a module holds its documents. Every agent, policy, promise, skill, and flow (the new name of a template) is a folder with one file, `AGENT.md`, `POLICY.md`, `PROMISE.md`, `SKILL.md`, or `FLOW.md`, with a skill's header. A flow has no body. Every session gets a Request section. Agents with a fresh context run through a tool of Yami on both harnesses. Move the plugin onto these changes. The library's docs tell you how.

## Build

1. **Module documents.** Move each document of the threads, librarian, and journals modules into its folder form, with `name` and `description` in its header. Names are lower-case with dashes. Change the builder calls to match.
2. **Hello fixture.** Rewrite `test/fixtures/vault-modules/hello/` in the new layout. Keep its behavior: the flow `greeting` with the field `greeting` (default `Hello`), its policy, its promise with the `exists` check, and its skill.
3. **Threads agents.** The reviewer and the validator become agents of the threads module. The spec and run skills send them through the library's agent tool on both harnesses. Remove each workaround for a harness without subagents, such as telling the user to validate in a new conversation. The validator never validates work that it did itself, and it edits nothing.
4. **Librarian.** The checkout flow has no body. The request goes into the session's Request section, from the person or from `librarian_checkout`.
5. **Flows.** Use the word "flow" for what the plugin called a template, in code, views, and docs.
6. **Tests.**
   - Update the unit tests for the new forms.
   - Add a unit test in which a scripted thread run calls the validator through the agent tool. Check its result and its conversation note.
   - Update the Obsidian tests in `test/obsidian/plugin.test.ts` for the new forms. Add one test in which a real Claude session calls an agent through the tool.
7. **README.** Show the five forms with the Hello fixture as the example, and say how a flow reads as a signature.

## Acceptance

1. `npm run build` and `npm test` pass in `obsidian_plugin/`.
2. `grep -ri template obsidian_plugin/src obsidian_plugin/test obsidian_plugin/README.md` finds nothing.
3. No flat `.md` file is directly in an `agents/`, `policies/`, or `promises/` folder of a module or a fixture. No `FLOW.md` has a body.
4. No skill of the plugin has a workaround for a harness without subagents.
5. The unit test of build step 6 passes, and the validator's conversation note exists.
6. `npm run test:obsidian` passes. It needs a real Claude and Codex. The overseer runs it at the end.
7. `YAMI_LIVE_THREAD=1 npm run test:live` takes one thread from stub to closed with a real Claude Code. The validator runs through the agent tool.
