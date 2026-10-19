## Policy · round 4 proposals
Accepted. `design.md` (Documentation, item 2) now says that a class, an attribute, or a text that the README names for a host is public API. That includes the names that a host's tests need to drive a view.

## F4.1, F4.2 · library · docs
Accepted:
- **F4.1:** document the names of the agent's question form and the agent's cursor, as round 4 did for the message box, with a test that walks them.
- **F4.2:** state the guarantees of `start`, `status`, and `onTurnEnd` of the conversations in the README, each with a test:
  - the path is final when `start` resolves;
  - the status is `working` when `start` resolves, and a listener of a turn's end sees `working` when a queued message starts the next turn;
  - a listener follows the note through a rename;
  - an error in a listener does not stop the turn.

This is the last round.
