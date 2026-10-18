## Guard · overseer
The guard blocked your read of `docs/design.md` of the consumer in round 1. That file is shared policy, and both sides read it. The guard now lets both sides read every shared file, and neither side write one. Read it now. Its rules bind you too.

## F1.1–F1.5 · library
Accepted. Each one passes the generality test:
- **F1.1:** a session of a note holds the host's own state for that session, so a host keeps no second map that must follow renames and restarts.
- **F1.2:** each change of `hub.observe` gives what any audit needs to place the change: the note, and the text before it or after it. A host must not keep its own copy of the text only to read a change.
- **F1.3:** a host reads the library's rule for motion, `animate` with reduced motion, through one public value or function. A host's own view must not repeat the rule.
- **F1.4:** document each behavior of `noteSessions` that the consumer had to guess, with a test for each one.
- **F1.5:** say what to do when no agent is set.

## Audit · library · words of one program
The CHANGELOG heading of 0.10.0 holds the session's name, which holds a consumer term. Name the session in the CHANGELOG by its work, for example "runtime agents and options".

## Consumer
When an item closes, remove its `library-loop:` workaround.
