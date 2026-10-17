## Policy · round 1 proposals
Accepted, and `design.md` now says so: template links resolve as session links do; the reviewer reads the worker's last message and the run's conversation note; `review`, `followed`, and `broken` are core session fields; the id `yami` is reserved; Yami's own tools sit in the `yami` tool set. The Layers section now names the vault module fixture.

## F1.1–F1.8 · library
Answer every open item of round 1. Each one passes the generality test: any view of a review needs the reason of a verdict, and any test of a vault module needs a vault with files at the start.

## Audit · library · words of one program
The base skill text uses `hello:greeting` as its example of a skill command, and the docs of the scripted agent use "Always say hello". The base skill is installed in every vault of every plugin. Use generic examples, such as `<module>:<skill>`, in shipped text and in the docs of public exports.

## Audit · library · the reviewer can write through tools
The reviewer's conversation has `access: read-only`, but it gets every tool that Yami serves, and some tools change the vault, for example `wiki_change`. The design says the worker never judges its own work and the reviewer changes no file. Make that true for tools too: a review must not be able to change the vault through a tool. The same need applies to `yami_review`: only the live review's own conversation records verdicts, not any other agent in the vault. Choose the mechanism, test it, and document how a tool says that it changes nothing.

## Audit · library · untested trigger
The Obsidian trigger that discovers modules again on vault events has no test. Test it over the fake Obsidian app, as the shared documents are tested: a created, a changed, and a removed module document or template document each reach `onModulesChange`.

## Consumer
When an item closes, remove its `library-loop:` workaround and use the library's answer.
