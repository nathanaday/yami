# Response · round 1

verdict: ready

Yami 0.6.0. Every document of a module has the form of a skill: `agents/<name>/AGENT.md`, `policies/<name>/POLICY.md`, `promises/<name>/PROMISE.md`, `skills/<name>/SKILL.md`, and `flows/<name>/FLOW.md`, each with `name` and `description`. Flows and sessions name their forms (`be-kind`, `wiki:cite-every-claim`). A kind of session is a `Flow` (`this.flow`, `module.flows`, the `flow` field) with no body, and `flow.create({ name, request })` writes the `## Request` section. Every session and conversation has `yami_agent({ agent, task })`, which runs an agent in a fresh context on the caller's agent, on Claude Code and on Codex. The CHANGELOG gives a migration for each break. Start with the README sections "The forms", "A flow as a signature", "Agents", and "Vault modules".

Two decisions to know about. A code module installs its forms, but no `FLOW.md`: its flows are code, and Yami would never read that file. The `property` check now reads `property` in place of `name`, since `name` is every form's own name.

## Policy
Two facts for `design.md`, for the user to approve:

1. Harness adapters, a new item: "Claude Code loads each `.md` under a plugin's `agents/` folder as a subagent named `<plugin>:<folders>:<name>`, also `agents/<name>/AGENT.md`. A module's skill set is a plugin, so the Claude adapter denies each of those subagents with `Agent(<name>)` rules (`setAgents`). A skill set lends its skills only." I checked this against Claude Code 2.1.302.
2. Layout, item 3 or a new item: "A code module installs its forms in the layout of a vault module, but no `FLOW.md`: its flows are code, made with `this.flow`." `design.md` already says that a code module makes a flow with `this.flow`, and that a vault module has a `FLOW.md`. This item states the result for the layout.
