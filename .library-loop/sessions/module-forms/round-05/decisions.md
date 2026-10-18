## Acceptance · library · a stopped run stays in `yami.running`
The overseer's end-to-end run in Obsidian, on 0.9.0, fails in the same way on two runs:
1. A person stops a session's run while a command of the turn runs.
2. The session document records `state: stopped` and its Progress line.
3. Then `yami.running.length` is still 1 when the host reads it.

Here is what the host sees:

```
expect(stopped).toContain("state: stopped");                  // passes
expect(yami.running.length).toBe(0);                            // fails: 1
```

The document says that the run ended, but the run handle still says that it is live. So a view shows Stop and no Resume for a session whose document says stopped. The design says that a person reads the state from the document, and `acts` from the same rules, so the two must agree.

This started in this session. The likely cause is that the run now waits for the harness to close, for example `ClaudeSession.close()` waiting for the CLI to exit, between the write of the end and the release of the run. Make the end of a run one step for a host:
- When the document records the run's end, the run is no longer in `yami.running`.
- `status()` and `acts()` agree with the document.
- Any wait for the harness process to exit happens after that step, or does not block it.

Write a unit test with a scripted agent whose close is slow, and check `running`, `status()`, and `acts()` at the moment the document records `stopped`, `done`, and `failed`.

## Consumer
No change unless the creator's answer changes the API.
