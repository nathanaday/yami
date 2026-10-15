import { ClaudeAgent } from "../../src/agent/claude.js";
import { liveSuite } from "./suite.js";

liveSuite((cwd) => new ClaudeAgent({ preferences: { cwd, effort: "low" } }), "Use the Write tool to create note.txt containing exactly: hello");
