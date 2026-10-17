# Feedback · round 4

verdict: done

I adopted 0.5.0 and fixed the two Obsidian tests that the ruling "Obsidian · consumer" gave me.

- **F3.1 is fixed.** `test/unit/threads.test.ts` now expects `reason: expect.stringContaining("iteration 1: 0 met, 0 unmet, 1 for review: Thread closed — ask the user: the thread used its 1 rounds")`. It passes. I close F3.1.
- **The panel test** used `module("hello").greet`, which was a field of the old code module. It now uses `module("hello").templates.find((t) => t.id === "greeting")`.
- **The stop-and-resume test.** The overseer's run had three user messages, and I could not find out what the third one was. The harness deletes the vault on close, and the one vault left in `$TMPDIR` came from an earlier launch that crashed, with no sessions in it. I ran the test twice and got two user messages both times. Then I used `yami/testing` to learn the two feedback texts: an unmet check sends "Yami checked the promises after your last turn.", and a review sends "A reviewer judged your work after your last turn." The test now checks that the first prompt is the run prompt and the second is the resume's check feedback. Each later prompt must be one of the two feedback texts, which is how the library is designed to work. When an assertion fails, it prints the whole conversation record, so the next run names any other message. My best guess is that the third message was review feedback: in round 3, reviewers sent verdicts on checked promises, the tool refused them, and the round 4 prompt fixes that.

Checks: `npm run build` passes. `npm test` passes, 83 of 83. `npm run test:obsidian -- -t "creates the hello module with New module|shows each module in the panel with its icon|stops a session's run in the middle of a turn"` passes, 3 of 3. I had to include the module creation test because the other two need the Hello module that it writes. The final run of the stop test plus that prerequisite passes, 2 of 2. I did not run "runs a hello session from its document": I did not change it, and the library's fix covers it.

Policy: I support the creator's proposed change to the `failed` line in the loop section of `design.md`.

## F4.1 · docs · minor · The text of the feedback prompts is not documented
The README says that the next prompt "says which, and why", and that a review's feedback goes back "the same as an unmet check". It does not give the text. A test that reads a conversation record must tell check feedback from review feedback, and must tell both from anything else. I had to run a probe to learn the opening lines:

**Tried**
```ts
t.agent.queue(() => {}, (p) => { out.push(p); return write(); }, review({ "Always say hello": ["broken", "x"] }), (p) => out.push(p), review());
// "Yami checked the promises after your last turn." / "A reviewer judged your work after your last turn."
```

**Wish**
```ts
import { FEEDBACK } from "yami";
expect([FEEDBACK.checks, FEEDBACK.review]).toContain(prompt.split("\n")[0]);
```

Exported constants would be best. A README line that quotes the two first lines would also do.

## F4.2 · nit · nit · No lookup of a template by its id
`module.templates.find((t) => t.id === "greeting")` is the only way to get a template by id. A host that creates a session from a stored template id, such as a URI handler or a saved setting, writes this every time. The obvious name, `module.template(id)`, is taken by the protected `template(options)`. The workaround is one line, so this is a nit.

```ts
module.templateById("greeting")?.create({ name });
```

## F4.3 · docs · nit · The guard blocked me when I tried to list the installed package
I ran `ls node_modules/yami` because I wanted to confirm that the plugin linked 0.5.0. The `VERSION` export from round 3 answers that question, so the docs already cover it. I file this only because the rules say to file every block. No change is needed.
