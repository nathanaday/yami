#!/usr/bin/env node
// PreToolUse hook of the library-creator and library-consumer agents: `guard.mjs creator|consumer`.
// It blocks a call with exit 2, and logs each block to .library-loop/guard.log for the overseer's audit.
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { judge } from "./access.mjs";
import { loadConfig, projectRoot, SIDES } from "./config.mjs";

const side = process.argv[2];
let input = {};
let reason;
try {
  if (!SIDES.includes(side)) throw new Error(`the guard needs a side: ${SIDES.join(" or ")}.`);
  input = JSON.parse(readFileSync(0, "utf8"));
  reason = judge(loadConfig(), side, input);
} catch (error) {
  reason = `the guard failed, so it blocks the call: ${error.message}`;
}

if (reason) {
  const entry = { time: new Date().toISOString(), side, tool: input.tool_name, input: input.tool_input, reason };
  try {
    appendFileSync(path.join(projectRoot(), ".library-loop", "guard.log"), JSON.stringify(entry) + "\n");
  } catch {}
  process.stderr.write(`library-loop: ${reason}\n`);
  process.exit(2);
}
