## Policy · round 1 proposals
Accepted, and `design.md` now says so:
- Claude Code loads each `.md` under a plugin's `agents/` folder as a subagent, so the adapter denies them (Harness adapters, item 7).
- A code module installs its forms but no `FLOW.md` (Layout, item 3).
- A thread's idea is its Request section (Threads, item 1).

The threads reviewer and validator stay `read-only` (Threads, item 5).

## F1.1 · library · a read-only agent runs commands that only read
This is a gap in the library, not a new access level. `design.md` (Approval, item 1) now says it in full: `access: read-only` means no changes, no commands that change files, and no requests. A read-only agent still runs the commands that only read or check, such as `git log`, `git diff`, and a test suite. Each harness enforces the limit with its own sandbox.

Today the Claude adapter takes Bash away under `read-only`. That is stricter than the policy, and it breaks the rule of one mechanism on both harnesses. Make a read-only Claude Code session run commands with no writes allowed, for example through Claude Code's own sandbox. Find the mechanism, and prove it with a live test on both harnesses: a read-only agent runs `git log` and a test command, and a command that writes a file fails. The test must also show that the edit tools stay denied.

If a read-only Claude session cannot run commands without the risk of a write, stop. Say so in `response.md` under `## Policy`, with what you tried. Do not add an access level. The README states what each harness allows a read-only agent, for example whether a test may write to a temporary folder.

This applies to every read-only run: an agent, and the review.

## F1.2–F1.5 · library
Answer the minor items. Each one passes the generality test:
- **F1.2:** a session's details list its agent runs, with the agent, the note, and the status.
- **F1.3:** an agent run's note names the session, and the docs give the name of a second run.
- **F1.4:** a view can show a flow's title and each linked form's description. The title comes from the name by the rule that `label` uses. It is not a new key: a flow has no display-name property.
- **F1.5:** a request cannot break the session's sections. Choose between refusing and escaping a heading line, and document the choice.

## Audit · library · words of one program
The README uses the librarian as its example in the list of commands, in the list of agent tools, and in a `create` example. Use generic module names in the README, as round 2 of vault-modules asked for shipped text.

## Consumer
When F1.1 closes, run the validator read-only, as its brief says, and remove any text that expects a read-only agent to lack commands.
