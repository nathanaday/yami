## F0.1–F0.5 · library
Accepted. They are R1 to R4 of the brief:
- **F0.1:** agents that change while the plugin runs.
- **F0.2:** live options. Add an `animate` option that a host reads live.
- **F0.3:** a public way to resume a harness session, or to start a new one when the harness has lost it.
- **F0.4:** a host's own agent work shows in the status bar, and the library's Stop command in a note interrupts it.
- **F0.5:** the plain helpers import with no Obsidian classes.

## F0.6, F0.7 · library · docs
Accepted:
- **F0.6:** say what each conversation command and the status bar do. Say whether the library's command for undoing an agent's last changes covers every agent change in a shared note, or only some.
- **F0.7:** list every file that `createYami` writes into a vault, and every tool and skill set that it gives each agent.

## F0.8 · declined · the wiki stays built in
`design.md` says that the wiki is built in, with one instance for the vault, and that every module uses it. The user chose that this plugin take the whole runtime. So no option turns the wiki off.

One part of F0.8 is a gap, and it is accepted: a session that the host starts on an agent must be able to set its own skill sets and tools, and leave the library's out. Document whether a session's own options replace the agent's or add to them.

## F0.9 · library · sessions scoped to one note
Accepted. It passes the generality test. Any plugin whose agents work in one note needs these things:
- one harness session for each note and agent;
- session ids that the host stores and that follow renames;
- an idle close, and the resume fallback of F0.3;
- a way to forget a note's sessions.

The conversation manager already does this for conversation notes. Build one mechanism for both, if they can share it. The host's own words, such as what triggers a session in a note, stay in the host. Use no consumer term in the library: name the thing by what it is, a session of a note.

## F0.10 · library · a feed of changes to shared notes
Accepted. It passes the generality test. Any plugin that shows or audits agent text needs it. The hub gives a public subscription to the changes of each shared note: the text operations, and the agent that made them, or none. Yjs types stay out of the public signature.

## F0.11, F0.12 · library
The creator decides.

## Policy
This plugin's proposals for its own `docs/design.md` are noted. The overseer applies them at the end, when the workarounds are gone.

## Consumer
When an item closes, remove its `library-loop:` workaround. The command ids that changed in round 0 stay changed, and the README lists them for users who set hotkeys.
