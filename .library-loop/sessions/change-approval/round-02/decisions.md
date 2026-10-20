## F1.1 · library
A bug. `changed` means "an approval would overwrite a later edit", which only a proposal can mean. Set it only while the change is proposed, and leave it out otherwise. Fix the README's example and the doc comment.

## F1.2 · library
Any view that offers the acts repeats the prompt, the run, the notice, and the refusal. `runModuleAct` is the precedent. Give the Obsidian layer one call that does an act on a change: asks for the reason of a reject (a cancel does nothing), runs the act, shows the notice on success, and rejects with the refusal so a view shows it inline. The commands use it too, so the sequence is in one place.

## F1.3 · library
`STATUS_LABELS` is the precedent. Give the words for each change status in one table, and use it in the commands' notices and the documents' text where the words appear.

## F1.4 · docs
Say in "Changes and versions" that a create's `after` holds the form's defaults, since that is what the approval writes.

## F1.5 · docs
Name `VERSION` in the README where a host checks which version it has.
