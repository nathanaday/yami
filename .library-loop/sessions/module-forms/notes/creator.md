# Creator notes · module-forms

## Round 1 (0.6.0)
- Built R1 to R13 in one pass. Forms in `FORMS` (schema.ts). One name resolver: `resolveForm` and `parseName` in `links.ts`. Shared fresh run: `freshRun` in `fresh-run.ts`, used by the review and by `runAgent` (`agent-run.ts`). `yami.tools(caller)` binds `yami_agent` to its caller. Yami gives each agent its own set, and each worker the set for its session.
- Stop and kill go through one `RunControl.signal`. Kill aborts with the reason `KILL`, so conversations close and nothing is interrupted, because a Codex interrupt starts a new server. Removed `RunControl.conversation`.
- A code module installs no FLOW.md. I proposed this under Policy. Watch whether the overseer or the consumer reads R1 ("installs the same layout") as a demand for a FLOW.md.
- Claude Code loads `agents/**/*.md` of a plugin as subagents (I probed 2.1.302). The adapter denies them with `disallowedTools`. A live test covers it.
- Renamed the `property` check's `name` key to `property`, because it collides with the form's `name`.
- Fixed a race: two notes that open at the same time got the same path (FileConversations, Obsidian manager).
- Live tests: the agent tool passed on Claude and on Codex. The Claude "no subagent" test passed. I did not run the full live suite.
- Rejected ideas: a bare name in a conversation does not fall back to a unique match in another module (it is an error that lists full names). A read-only caller refuses an edit agent; it does not downgrade the agent to read-only.

## Watch next round
- Consumer ergonomics of `this.policy({ name, description, body })` against markdown imports.
- Whether the name aliases `<module>:<name>` read well in session documents (Yami writes full-path links).
- Out of scope, and to decline: the ingest workers as agents, agents that call agents, and checks on an agent's output.
