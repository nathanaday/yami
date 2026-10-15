import { policy, promise, skill, type Module } from "../module/module.js";

/** The smallest module: one policy, one promise, one skill, and one session field. */
export const hello: Module = {
  id: "hello",
  name: "Hello world",
  description: "Says hello, and writes the greeting to a note in the vault.",
  schema: {
    greeting: { type: "text", default: "Hello" },
  },
  documents: [
    policy("Always say hello", "Begin every reply with the session's greeting, exactly as the `greeting` session property gives it."),
    promise(
      "Greeting note",
      { check: "exists", path: "greetings/{{session}}.md" },
      "Create this note. Its content is one line: the greeting, addressed to the session by name.",
    ),
    skill(
      "greeting",
      "How to greet a person or a session by name.",
      "# Greeting\n\nTo greet, write the greeting word from the session, a comma, and the name. Keep it to one line, with no other words.",
    ),
  ],
  defaults: {
    policies: ["Always say hello"],
    promises: ["Greeting note"],
    skills: ["greeting"],
  },
};
