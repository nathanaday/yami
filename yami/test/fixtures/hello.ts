import { defineTool, YamiModule, z, type AgentTool, type Schema } from "../../src/index.js";

export const GREETING_SKILL = `---
name: greeting
description: How to greet a person or a session by name.
---
# Greeting

To greet, write the greeting word from the session, a comma, and the name. Keep it to one line, with no other words.
`;

export const POLITE_POLICY = `---
name: always-say-hello
description: Begin every reply with the greeting.
---
Begin every reply with the session's greeting, exactly as the \`greeting\` session property gives it.
`;

export const NOTE_PROMISE = `---
name: greeting-note
description: A note with the greeting.
check: exists
path: greetings/{{session}}.md
---
Create this note. Its content is one line: the greeting, addressed to the session by name.
`;

/** The smallest module: one policy, one promise, one skill, one flow, one session field, and one tool. */
export class Hello extends YamiModule {
  readonly id: string = "hello";
  readonly name: string = "Hello world";
  readonly description = "Says hello, and writes the greeting to a note in the vault.";
  readonly schema: Schema = { greeting: { type: "text", default: "Hello" } };

  readonly greeting = this.skill(GREETING_SKILL);
  readonly polite = this.policy(POLITE_POLICY);
  readonly note = this.promise(NOTE_PROMISE);
  readonly greet = this.flow({ name: "greet", description: "Greets the session by name.", skills: [this.greeting], policies: [this.polite], promises: [this.note] });

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
