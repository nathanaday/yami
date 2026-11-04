import { basename } from "../../document/document.js";
import { excerpt, mapThrough, protectedRanges } from "../../document/protected.js";
import { diffOps, normalizeNewlines } from "../../document/text-ops.js";
import type { HubObserver, NoteChange } from "../collab/hub.js";
import type { ProtectedStore } from "./store.js";

/** The origin of the guard's own changes to a shared note, which no agent and no person made. */
export const GUARD_ORIGIN = Symbol("yami-protected-guard");

/**
 * Puts a protected text back when an agent's live edit of a shared note removes or changes it: the range
 * the text had, mapped through the agent's change, takes the text again. The agent's other edits stay. The
 * person's own typing is never touched: the hub names the agent of a change, and a change with none passes.
 * `notify` says what happened, once for each change.
 */
export function protectedGuard(store: ProtectedStore, notify: (message: string) => void): HubObserver {
  return {
    changed({ note, path, before, agent }: NoteChange): void {
      if (!agent) return;
      const marks = store.marks(path);
      if (!marks.length) return;
      const after = normalizeNewlines(note.content);
      const lost = protectedRanges(marks, before).filter((range) => !after.includes(range.mark.text));
      if (!lost.length) return;
      // A character-level diff keeps two nearby changes apart, so the range of the text maps to what replaced it, and not to a neighbor's edit too.
      const ops = diffOps(normalizeNewlines(before), after, { semantic: false });
      // The observer runs inside the note's own transaction; the restore is a transaction of its own.
      queueMicrotask(() => {
        let text = normalizeNewlines(note.content);
        const restored: string[] = [];
        for (const range of lost) {
          if (text.includes(range.mark.text)) continue;
          const { from, to } = mapThrough(range, ops);
          if (from > text.length) continue;
          note.applyOps([{ from, to: Math.min(to, text.length), insert: range.mark.text }], GUARD_ORIGIN);
          text = normalizeNewlines(note.content);
          restored.push(excerpt(range.mark.text, 40));
        }
        if (restored.length) notify(`Yami kept the protected text in ${basename(path)} that ${agent.name} changed: ${restored.map((t) => `"${t}"`).join(", ")}.`);
      });
    },
  };
}
