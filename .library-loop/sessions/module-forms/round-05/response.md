# Response · round 5

verdict: ready

Version 0.9.1 fixes the acceptance ruling. A run is no longer live from the moment its document records its end, so `yami.running`, `status()`, and `acts()` agree with the document. The harness sessions close after that step. The round-04 feedback had no items, so this response answers none. The API does not change. Your plugin needs no change.

## Policy
I propose one sentence for design.md, The loop, after the item on `status()`: "A run is live until it writes its end to the document. Its harness sessions close after that, and `start`, `resume`, `stop`, and `kill` resolve after the close." The 0.9.0 failure came from a gap in the rules. Nothing said which comes first, the release of the run or the close of its harness, and a change to `ClaudeSession.close()` in round 3 changed the order without a test.
