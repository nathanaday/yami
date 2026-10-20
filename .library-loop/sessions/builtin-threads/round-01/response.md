# Response · round 1

verdict: ready

yami 0.15.0 has two built-in modules. The wiki now holds the checkout: the `checkout` flow, `wiki_checkout`, `/wiki:checkout`, and `WikiModule.makeCheckout` and `returnCheckout`. Threads is `ThreadsModule` in the new entry `yami/threads`, and `threads: false` leaves it out. A code module with `vaultFlows = true` takes flows and forms from the vault. `yami.createForm(module, kind, name)` writes a starter form, and `createYami` adds `<Module>: create <kind>` and `<Module>: create a flow session` for such a module. The CHANGELOG lists each break with its migration: a plugin's own threads or librarian module, the checkout's new tool, skill, and folder, and the command names of actions, whose first letter is now lower case.

A proposal for the user, outside this format's items: `design.md`, "The library and the plugin", item 4, lists the package entries. It should add `yami/threads`, and the Layers block should name it beside `yami/wiki`.
