## F1.1 · library
Accepted. A session of a person's own flow is not a thread, so it must not carry the thread's fields. A session of a vault flow of a code module gets the core fields and the fields of its own flow, and no default of a module field that only the code flows use. Make the rule general for every module that takes vault flows, not a special case of threads: for example, a module's flow can declare the session fields that belong to it alone, and threads declares its thread-only fields on the `thread` flow. A test shows a vault flow's session of threads with none of the thread fields, and a thread with all of them.

## F1.2 · docs
Document, as public API (design.md, Documentation item 2), the elements that a host's test uses to drive `ask` and `pick`, and the text of each item in the `<Module>: create a flow session` picker.

## F1.3 · docs
Document what `wiki_checkout` returns: the `Checkout` as JSON text, and what it returns when it refuses an order.
