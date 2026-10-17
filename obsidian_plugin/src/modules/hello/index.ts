import { defineTool, YamiModule, z, type AgentTool, type Schema } from "yami";
import polite from "./policies/Always say hello.md";
import note from "./promises/Greeting note.md";
import greeting from "./skills/greeting/SKILL.md";

/** The smallest module, as the reference: one policy, one promise, one skill, one template, one session field, and one tool. */
export class Hello extends YamiModule {
  readonly id = "hello";
  readonly name = "Hello world";
  readonly icon = "hand";
  readonly description = "Says hello, and writes the greeting to a note in the vault.";
  readonly schema: Schema = { greeting: { type: "text", default: "Hello" } };

  readonly greeting = this.skill(greeting);
  readonly polite = this.policy("Always say hello", polite);
  readonly note = this.promise("Greeting note", note);
  readonly greet = this.template({ id: "greeting", name: "Greeting", skills: [this.greeting], policies: [this.polite], promises: [this.note] });

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
