import { CodexAgent } from "../../src/agent/codex.js";
import { liveSuite } from "./suite.js";

liveSuite(
  (cwd) => new CodexAgent({ preferences: { cwd, effort: "low" } }),
  "Run this exact shell command: printf hello > note.txt",
  "Create the file note.txt containing exactly: hello. Use apply_patch, not a shell command.",
);
