## F2.1–F2.3 · library
Accepted:
- **F2.1:** the type of a note session's `state` must say what the code gives. Either `setup` must return a state when the type has one, or `state` is typed as possibly undefined.
- **F2.2:** `setup` gives what a host needs to bind the note, so no host repeats a file lookup and handles a missing file.
- **F2.3:** `setAgents` writes only what changed. It writes no composer whose agent did not change.

## Overseer · library · no agents left
The creator's round 2 notes suspect a bug: after `setAgents([])`, a conversation note that is open breaks, because the message box reads the note's agent and the read throws. Test it, with a conversation open and also with one that runs. A plugin whose person removes the last agent in its settings must not break, and it must say what to do, as the ribbon now does. Then add the agents back, and the note works again with no reload.

## Policy
The showcase-use question of round 2 goes to the user at the end. Do not edit the showcase.

## Consumer
When an item closes, use the library's answer, and remove any code that the answer makes unnecessary.
