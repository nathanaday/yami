---
name: run
description: "Take a thread from where it stands to closed with no stop between steps: spec and plan when missing, do the tasks with commits, have a fresh read-only agent validate the work, resolve its findings, validate again, close. Use for run the thread, resume thread X, work on thread X, what threads are open, what should I work on."
---
# Run

This skill is the loop. Code derives each thread's next step from its document, so every session takes the same path: spec, plan, execute, validate, resolve, close. Go from one step to the next without a stop. The user steps in only when the step is `ask`, a command is refused, an action reaches outside the machine, or a repository is unclear.

## Find the thread

- The message or the session names a thread: `threads_status` with it.
- The request asks what is open, or what to work on: `threads_status` with no thread. Name at most three threads in a few lines, in the order it gives. Stop there.
- The request names work that no thread holds: plant it first (/threads:stub).

## The loop

Read `next.step` from `threads_status`, or from the result of any threads tool, and do the step. Repeat until the step is `none` or `ask`.

| Step | Do |
|---|---|
| `spec`, `plan` | /threads:spec, steps 1 to 6. |
| `wait` | Say in one line what the thread waits for. Stop. |
| `execute` | [Execute](#execute). |
| `validate` | [Validate](#validate). |
| `resolve` | [Resolve](#resolve), then validate again. |
| `ask` | [Ask](#ask). Stop until the user answers. |
| `close` | [Close](#close). |
| `none` | Say that the thread is closed or dropped. Stop. |

### Execute

1. For each repository of the thread, read its instruction files and follow them and the spec's rules. Note the files that were dirty before you started: they are the user's, and you leave them alone.
2. Take the open tasks in order. For each: do the work; run the tests of what you changed; commit the files you changed, with a message that names the task and the thread; then `threads_plan` with `done`: the task's id and its trail (`repository@commit`, or a note). Mark each task when it is done, not all at the end. After the last task, run each repository's full suite once.
3. A step the plan lacks: `threads_plan` with `add` before you do it. A task that is not needed: `threads_plan` with `drop` and the reason.
4. A requirement that is wrong or cannot be met: when the change is small and keeps what the user gets, revise the spec and record the decision. When it changes the scope, stop and ask the user.

### Validate

1. Send the `threads:validator` agent with the thread's path. It edits nothing. Without a subagent tool (Codex), never validate your own work: say in one line that the work waits for validation, and that the user starts it with `/threads:validate <thread>` in a new conversation. Stop.
2. Call `threads_round` with its report as it returned it: `scope`, `results`, `findings`, and `notes`. Do not turn a `fail` into a `pass`, and do not drop or soften a finding. When `threads_round` refuses the report, change only the part the refusal names, and say so in `notes`.
3. When the previous round has findings with no outcome, give each one in `resolved` of this call (see [Resolve](#resolve)).

### Resolve

Give each open finding of the last round an outcome: fixed, spec, stub, declined, knowledge. Each fix adds code for the next round to check, so fix what the spec needs, and send the rest elsewhere:

- a blocking finding that is real: `threads_plan` with `add` (a task that fixes it), do the task, and record `fixed` with the task ids;
- a finding that predates the thread (it has `predates`): plant a stub for it and record `stub`, or record `declined` with the reason. Fix it here only when the user asks, with their words in `user_asked`;
- a finding that does not block: fix it only when the fix is small and the spec asks for it; otherwise `stub`, `declined`, or `knowledge`;
- the spec is wrong: revise it, and record `spec`. You may reword or narrow a requirement; a new case widens the thread, so plant a stub or ask the user;
- real work beyond this thread: plant a stub, and record `stub` with its link;
- a false positive: `declined` with the reason and the evidence;
- a fact the wiki should hold: record `knowledge`, and tell the user what the wiki should learn.

Then validate again. The outcomes go into the next `threads_round` as `resolved`.

### Ask

The thread used its budget of rounds (3 unless the thread sets `budget`). Write one message: what passes and what fails, by requirement; what the last rounds fixed and what each found next; and your recommendation: one more round for a named fix, narrow or retire the failing requirement and plant a stub for the rest, or drop the thread. When the user answers, call `threads_spec` with a `budget` one more than the rounds used and their words in `user_asked`, with the narrowed or retired requirement when they chose that, then go on. To drop, `threads_close` with `outcome: "dropped"`.

### Close

A passing round ends the work. Do not fix its findings: a fix would make the round stale.

1. Give each finding of the last round its outcome in `resolved`: `stub` (plant the stub first), `declined` with the reason, or `knowledge`.
2. `threads_close` with `outcome: "closed"` and a summary of one or two sentences: what is true now.
3. End with two sentences at most: what is true now, with the thread as a link, and what waits for the user, if anything. The document holds the rest.

## Small work

A thread for small work takes the same path with short documents: one or two requirements, one or two tasks, one round. Do not skip the validator.
