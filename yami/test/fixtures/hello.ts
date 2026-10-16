import { defineTool, YamiModule, z, type AgentTool, type Schema } from "../../src/index.js";

export const GREETING_SKILL = `---
name: greeting
description: How to greet a person or a session by name.
---
# Greeting

To greet, write the greeting word from the session, a comma, and the name. Keep it to one line, with no other words.
`;

/** The smallest module: one policy, one promise, one skill, one template, one session field, and one tool. */
export class Hello extends YamiModule {
  readonly id: string = "hello";
  readonly name: string = "Hello world";
  readonly description = "Says hello, and writes the greeting to a note in the vault.";
  readonly schema: Schema = { greeting: { type: "text", default: "Hello" } };

  readonly greeting = this.skill(GREETING_SKILL);
  readonly polite = this.policy("Always say hello", "Begin every reply with the session's greeting, exactly as the `greeting` session property gives it.");
  readonly note = this.promise("Greeting note", "Create this note. Its content is one line: the greeting, addressed to the session by name.", {
    check: "exists",
    path: "greetings/{{session}}.md",
  });
  readonly greet = this.template({ id: "greet", name: "Greeting", skills: [this.greeting], policies: [this.polite], promises: [this.note] });

  tools(): AgentTool[] {
    return [
      defineTool({
        name: "greet_user",
        description: "Greets a person by name. Returns the greeting.",
        input: { name: z.string().describe("The person's name.") },
        title: ({ name }) => `Greet ${name}`,
        run: async ({ name }) => `Hello, ${name}!`,
      }),
    ];
  }
}
