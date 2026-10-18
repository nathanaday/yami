# Requirements: a second plugin on the whole Yami runtime

A second Obsidian plugin now moves onto `createYami`. Until now it wired the lower layers by hand: `yami/agent`, the collab hub, the conversation manager, and the prompts. After this work, it gets the runtime from `createYami` and keeps only its own features. It builds from the API docs alone, so each gap it meets is a gap in the library.

Read `design.md` first. Library and plugin, items 2 to 4, are the rules here: a plugin holds its choices, a gap in a plugin is a gap in the library, and a plugin uses the public API only. The consumer's own design notes are shared policy too. They say what the plugin needs, not how the library does it.

## Capabilities

**R1 · Agents that change while the plugin runs.** A host's agents come from its settings, and a person edits the settings while the plugin runs. A host can add, remove, rename, recolor, and replace an agent after `createYami`, with no reload. Conversations, commands, and the status bar follow the change. A conversation or a session that runs keeps the agent it started with until it ends. An agent's process closes when no conversation uses it any more.

**R2 · Options that change while the plugin runs.** The conversation folder, the idle minutes, and each other option that a person would set in a settings tab take a value or a function that Yami reads each time it uses the value. A changed value applies to the next use, with no reload.

**R3 · Plain helpers import cheaply.** A plugin's unit tests import the plain helpers of the Obsidian layer, such as the text operations, without loading the classes of Obsidian's UI. A test that mocks `obsidian` with only the classes that its own code uses passes. `design.md` (Layers, item 10) already allows these helpers to move below `yami/obsidian`.

**R4 · Choices, not forks.** A plugin can turn off each part of `createYami` that it replaces with its own. The parts are the command groups, the status bar, the folder colors, and anything else that the feedback names. It can also extend each part without a copy of the library's code. A command id of the library never collides with a host's command.

**R5 · The feedback decides the rest.** Answer each feedback item by the generality test: build what a second plugin would need, with a test. When the consumer asks the library to own one of its features, such as a feature that writes into notes, say in `response.md` whether it passes the test. Wait for the overseer's ruling before you build it.

**R6 · No regression.** The checks include the build and the unit tests of the showcase plugin in `obsidian_plugin/`. Keep them passing. When a change must break the showcase, say so in `response.md` under `## Policy`, and do not change `obsidian_plugin/` yourself.

## Tests and docs

**R7 · Tests.** Each capability has unit tests with `yami/testing` or the fake Obsidian app. R1 needs these cases: an agent added, removed, and replaced while a conversation runs. Each export has docs.

**R8 · Docs.** The README documents runtime agents and options, how to turn a part off, and the cheap import path. The CHANGELOG lists each change and each break.

## Out of scope

- Changes to modules, flows, forms, or agents as `AGENT.md`.
- A settings tab built by the library.
- Moving a feature of the consumer into the library before the overseer rules on it.
