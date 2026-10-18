import { writeDocument } from "../document/document.js";
import { timestamp } from "../document/schema.js";
import type { Vault } from "../document/vault.js";
import { formPath, MODULE_ICON, moduleLayout } from "./module.js";

/**
 * Writes a starter vault module: the module document, one flow, one skill, one agent, one policy, and one
 * promise with a core check. A session from it runs to `done` when the agent writes the result note and the
 * review finds the policy followed. The caller checks that the id is free.
 */
export async function writeStarter(vault: Vault, id: string, name: string): Promise<void> {
  const lay = moduleLayout(id);
  await writeDocument(vault, {
    path: lay.moduleDoc,
    properties: {
      type: "module",
      module: id,
      name,
      description: `${name}: tasks that an agent does in the vault, and Yami checks.`,
      icon: MODULE_ICON,
      instructions: "",
      created: timestamp(),
    },
    body: `# ${name}

This module is defined in the vault, with no code. Change it here:

- This document: the module's \`name\`, \`description\`, \`icon\`, \`color\`, and \`instructions\` for every run.
- \`flows/<name>/FLOW.md\`: one for each kind of session. Its properties name the session's skills, agents, policies, and promises, and give its fields and its instructions. It has no body.
- \`skills/<name>/SKILL.md\`, \`agents/<name>/AGENT.md\`, \`policies/<name>/POLICY.md\`, and \`promises/<name>/PROMISE.md\`: the documents that the flows name. Each starts with its \`name\`, the name of its folder, and a \`description\`.

Sessions: [[${lay.ledger}|${name} sessions]]
`,
  });
  await writeDocument(vault, {
    path: formPath(lay, "flow", "task"),
    properties: {
      name: "task",
      description: "One task, which an agent does in the vault.",
      skills: ["task"],
      agents: ["checker"],
      policies: ["stay-in-scope"],
      promises: ["result-note"],
      maxIterations: 3,
      access: "edit",
      instructions: "",
      command: true,
    },
    body: "",
  });
  await vault.write(
    formPath(lay, "skill", "task"),
    `---
name: task
description: How to do the task of a ${name} session, and write its result note.
---
# Task

1. Read the Request section of the session document. It says what to do.
2. Do the task. Change only what the request needs.
3. Write the result note at the path that the result-note promise gives: what you did, and a link to each file you changed.
4. Ask the checker agent to compare the result note with the request. Fix what it finds.
`,
  );
  await writeDocument(vault, {
    path: formPath(lay, "agent", "checker"),
    properties: { name: "checker", description: "Compares the work of a session with its request, and says what is missing. It changes nothing.", access: "read-only" },
    body: "Read the session document that the task names: its Request section says what the work must do. Read the result note and each file that it links. Answer with a list of what the request asks for and the work does not do, or with `Nothing is missing.`\n",
  });
  await writeDocument(vault, {
    path: formPath(lay, "policy", "stay-in-scope"),
    properties: { name: "stay-in-scope", description: "Change only what the request needs." },
    body: "Change only the files that the request needs, and the result note. The result note names each file that the session changed.\n",
  });
  await writeDocument(vault, {
    path: formPath(lay, "promise", "result-note"),
    properties: { name: "result-note", description: "A note that says what the session did.", check: "exists", path: `${id}/{{session}}/Result.md` },
    body: "A note that says what the session did, and links each file that it changed.\n",
  });
}
