import type { Vault } from "../document/vault.js";
import { VERSION } from "../version.js";
import { hashBytes } from "../wiki/source.js";
import { INTERNAL } from "./module.js";
import type { ModuleProblem } from "./vault-module.js";

/** The reserved id of Yami's own skill set. No module can take it. */
export const YAMI_ID = "yami";

/** The folder of Yami's own skill set, which every agent of a Yami gets. */
export const YAMI_SKILLS = `${INTERNAL}/${YAMI_ID}`;

/** The base Yami skill, which every run of every module invokes as `/yami:run`. */
export const BASE_SKILL = `${YAMI_SKILLS}/skills/run/SKILL.md`;

/** The command that invokes the base skill. */
export const BASE_SKILL_COMMAND = `${YAMI_ID}:run`;

/**
 * The text that Yami installs at `BASE_SKILL` when no file is there, or when the file holds a text that an
 * earlier version shipped. A person can edit the file in the vault, and Yami keeps the edits.
 */
export const BASE_SKILL_TEXT = `---
name: run
description: How to run a Yami session. Read the session document, load its skills, follow its policies, deliver its promises, check the work, and expect a review.
---
# Run a Yami session

A Yami session is one piece of work, and one markdown document in the vault. The message that invoked this skill names the session document and gives its context: the instructions, the policies, the promises, the skills, and the articles. The working directory is the vault, and paths are relative to it.

1. **Read the session document.** Its body says what the work is, and a person can write in it. Yami writes its properties and its Deliverables, Progress, and Review sections. Do not edit the session document.
2. **Load the session's skills.** Load the first skill of the message before you begin, and load the others when you need them. To load a skill, invoke it by its command, \`/<module>:<skill>\`, or read the \`SKILL.md\` in the folder that the message gives. A skill that the message gives in full is loaded already.
3. **Follow every policy.** A policy is a rule for all of the work.
4. **Deliver every promise.** A promise names a deliverable, and where it goes. In a promise, \`{{session}}\` is the session's name, and \`{{field}}\` is the value of a session property.
5. **Check the work before the turn ends.** Call the tool \`yami_check\` with the session document's path. It runs the checks of the promises and returns each result, and it records nothing. Fix each unmet promise, and check again.
6. **Expect a review.** After your turn, Yami checks the promises. When the checks pass, a reviewer judges each policy, and each promise that has no check. The reviewer works in a new conversation, and does not change files. When a check fails, or the reviewer finds a broken policy or an unmet promise, you get the reasons as the next message. Fix what they name.

End your turn when the work is done and the checks pass. Say in your last message what you did, and which files you changed.
`;

/**
 * The SHA-256 of each text of the base skill that a version of Yami shipped, this one's too. A file with one
 * of them holds no edits of a person, so Yami replaces it. When you change `BASE_SKILL_TEXT`, add its hash.
 */
export const SHIPPED = [
  "c029ecc18fb2a31176f9e10e714f96d4d015ed668146865001d968fd82314b93", // 0.2.0
  "9c29780cf87ef22a044e6b2014246cb13d7172b5c80cf189a955d8d5b10881d5", // 0.3.0
];

export function hashText(text: string): Promise<string> {
  return hashBytes(new TextEncoder().encode(text));
}

/**
 * Writes the base skill when the vault has no file at its path, or a text that an earlier Yami shipped.
 * A file with any other text holds a person's edits: Yami keeps it, and returns the problem that says so.
 */
export async function installBaseSkill(vault: Vault): Promise<ModuleProblem | undefined> {
  const text = (await vault.exists(BASE_SKILL)) ? await vault.read(BASE_SKILL) : undefined;
  if (text === BASE_SKILL_TEXT) return undefined;
  if (text === undefined || SHIPPED.includes(await hashText(text))) {
    await vault.write(BASE_SKILL, BASE_SKILL_TEXT);
    return undefined;
  }
  return {
    module: YAMI_ID,
    path: BASE_SKILL,
    document: BASE_SKILL,
    message: `The base skill differs from the text of Yami ${VERSION}, so Yami keeps your edits. To get the new text, delete the file: Yami writes it again. Then copy back the edits you want.`,
  };
}
