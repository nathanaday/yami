# Requirements: module forms, flows, and agents

Today a module's documents have mixed forms. A skill is `skills/<name>/SKILL.md` with `name` and `description`. A policy, a promise, and an agent are flat files with their own headers, and a kind of session is a "template" with a body. After this work, every document of a module has the form of a skill. A kind of session is a **flow**, which reads as a function signature. A fresh-context **agent** is something every session can call, on both harnesses, through a tool of Yami.

Read `design.md` first. It already holds the policy for this work. These requirements make it checkable. There is no backward compatibility: no alias, no migration, and no reading of the old forms.

## Forms

**R1 · Folder forms.** These are the documents of a module, under `internal/<id>/`:

- `agents/<name>/AGENT.md`
- `policies/<name>/POLICY.md`
- `promises/<name>/PROMISE.md`
- `skills/<name>/SKILL.md`
- `flows/<name>/FLOW.md`

The folder can hold other files, which the document names by path. A code module installs the same layout. Articles stay as notes, and the module document stays at `internal/<id>/<id>.md`.

**R2 · One header style.** Each file of R1 starts with `name` and `description`, as a `SKILL.md` does. `name` is the id: lower-case letters, digits, and dashes. It is the same as the folder's name. The files have no `type` and no `module` property, because the folder gives both. The kind-specific properties are:

- `PROMISE.md`: `check`, `path`, and the properties that its check reads.
- `AGENT.md`: `access`, which is `read-only` (the default) or `edit`.
- `FLOW.md`: the keys of R5.

The schemas stay in `yami/src/document/schema.ts`. A code module's builders take each document's name from its frontmatter, as `this.skill` and `this.agent` do now.

**R3 · Links by name.** A flow and a session link their skills, agents, policies, and promises by name. A name resolves first in the session's module. `<module>:<name>` names a document of another module. Articles stay `[[links]]`, and resolve as they do now. The session document holds links that open each document in Obsidian. The loop accepts both what Yami writes and a bare name that a person types.

**R4 · Not knowledge.** The wiki index leaves out the folders of R1. Lint finds no duplicate names in them.

## Flows

**R5 · Template becomes flow.** The word "template" goes from the public API, the document types, the schemas, the docs, the commands, and the core session fields. The core field `template` becomes `flow`. A `FLOW.md` holds these keys:

- `name` and `description`
- `skills`, `agents`, `policies`, `promises`, and `articles`
- `fields`
- `maxIterations`, `access`, `instructions`, and `command`

A flow has no body. A `FLOW.md` with body text is a problem, and its message says to move the text into `instructions`. The code API has no body option. The command and the button for a flow say `New <name>`, with each dash of the name as a space.

**R6 · The Request section.** Yami writes a `## Request` section in every new session. `create({ name, request, fields, add })` fills it. Without a request it stays empty, for the person to write. The base skill tells the agent that the Request section, the session fields, and the articles are the session's input.

## Agents

**R7 · The agent tool.** Every session and every conversation gets one Yami tool that runs an agent. It takes an agent's name (a bare name for the caller's module, or `<module>:<name>`) and a task in text. It then:

1. Starts a new conversation with a fresh context, on the caller's agent (the same harness and preferences). The conversation gets the agent's brief (the body of `AGENT.md`), the task, the skill sets, and the vault as the working directory.
2. Applies the agent's `access`. A `read-only` agent gets only the tools that declare `readOnly`, as the reviewer does now.
3. Writes the run as a conversation note.
4. Returns the agent's final message and the path of its conversation note.

An agent run by the tool does not get the tool, so agents do not nest. The tool can run several agents at the same time. When the caller's run stops or is killed, its agents stop too. An unknown name returns an error that lists the agents the caller can use.

**R8 · Agents in a flow.** A flow's `agents` key lists the agents that its sessions call. The first prompt lists each one with its description and says how to call it. A session can call any module's agent by name. A module's skill set holds no Claude Code subagent files. Both harnesses use the one tool.

**R9 · One fresh-context run.** The review and the agent tool share one implementation of a fresh-context run. The review behaves as it does now.

**R10 · Claude Code is favored.** The README and the CHANGELOG say that Claude Code is the favored and better-supported harness. Codex works through the same tool. The README states each difference you find between the harnesses for agents.

## Vault modules

**R11 · Discovery and problems.** A vault module is a module document and at least one `flows/<name>/FLOW.md`. Live changes cover each path of R1. These are problems, with a message that says how to fix each one:

- A `name` that is not the folder's name.
- A `FLOW.md` with body text.
- A flat file where a folder form belongs, such as `policies/x.md`. The message says to move it to `policies/x/POLICY.md`.
- A name that resolves to nothing.

The starter module and the `New module` command write the new forms.

## Tests and docs

**R12 · Tests.** Use `yami/testing` for unit tests of these behaviors:

- Each form and each problem of R11.
- Links by name, in the module and across modules.
- The Request section.
- The agent tool: a read-only agent and an edit agent; two agents at the same time; a stop of the caller; an unknown name; no nesting.
- The review, which still passes on the shared run.

The scripted agent of `yami/testing` can play an agent that the tool runs. The live tests run the agent tool on Claude and on Codex. Each export has docs.

**R13 · Docs.** The README documents the five forms and their headers, links by name, a flow as a signature (input, method, constraints, output), the Request section, the agent tool, and the harness note of R10. The CHANGELOG lists each change and each break.

## Out of scope

- Promises or checks on an agent's output. An agent returns its message only.
- Agents that call agents.
- Lists of tools for each agent, other than `access`.
- The wiki ingest's workers as agents.
- The module document as `MODULE.md`.
- Migration of vaults or sessions in the old forms.
