import { writeDocument } from "../document/document.js";
import { timestamp } from "../document/schema.js";
import type { Vault } from "../document/vault.js";
import { MODULE_ICON, moduleLayout } from "./module.js";

/**
 * Writes a starter vault module: the module document, one template, one skill, one policy, and one
 * promise with a core check. A session from it runs to `done` when the agent writes the result note
 * and the review finds the policy followed. The caller checks that the id is free.
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
- \`templates/\`: one document for each kind of session. Its properties link the session's skills, policies, and promises, and its body is the body of a new session.
- \`skills/\`, \`policies/\`, and \`promises/\`: the documents that the templates link.

Sessions: [[${lay.ledger}|${name} sessions]]
`,
  });
  await writeDocument(vault, {
    path: `${lay.internal}/templates/Task.md`,
    properties: {
      type: "template",
      module: id,
      name: "Task",
      description: "One task, which an agent does in the vault.",
      skills: ["task"],
      policies: ["[[Stay in scope]]"],
      promises: ["[[Result note]]"],
      maxIterations: 3,
      access: "edit",
      instructions: "Do the task that the Request section of the session document gives.",
      command: true,
    },
    body: "## Request\n\nWrite the task here. Then run the session.\n",
  });
  await vault.write(
    `${lay.folders.skills}/task/SKILL.md`,
    `---
name: task
description: How to do the task of a ${name} session, and write its result note.
---
# Task

1. Read the Request section of the session document.
2. Do the task. Change only what the request needs.
3. Write the result note at the path that the Result note promise gives: what you did, and a link to each file you changed.
`,
  );
  await writeDocument(vault, {
    path: `${lay.folders.policies}/Stay in scope.md`,
    properties: { type: "policy", module: id },
    body: "Change only the files that the request needs, and the result note. The result note names each file that the session changed.\n",
  });
  await writeDocument(vault, {
    path: `${lay.folders.promises}/Result note.md`,
    properties: { type: "promise", module: id, check: "exists", path: `${id}/{{session}}/Result.md` },
    body: "A note that says what the session did, and links each file that it changed.\n",
  });
}
