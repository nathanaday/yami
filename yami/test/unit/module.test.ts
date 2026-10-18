import { afterEach, describe, expect, it } from "vitest";
import { runTool, setSkills, slashCommand } from "../../src/agent/index.js";
import { readDocument, sectionText } from "../../src/document/index.js";
import { MODULE_ICON, skillCommand, Yami, YamiModule, type AgentTool, type Place } from "../../src/index.js";
import { FsVault, ScriptedAgent, testYami, type TestYami } from "../../src/testing/index.js";
import { GREETING_SKILL, Hello, NOTE_PROMISE, POLITE_POLICY } from "../fixtures/hello.js";

let t: TestYami | undefined;
afterEach(async () => {
  await t?.dispose();
  t = undefined;
});

async function fresh(...modules: YamiModule[]) {
  t = await testYami({ modules: modules.length ? modules : [new Hello()] });
  return t;
}

describe("a module's files", () => {
  it("installs the ledgers, the module document, and each form in a folder of its name, with no type and no module", async () => {
    const { vault } = await fresh();
    for (const file of ["Yami.base", "internal/hello/sessions.base", "internal/hello/hello.md", "internal/hello/policies/always-say-hello/POLICY.md", "internal/hello/skills/greeting/SKILL.md"]) {
      expect(await vault.exists(file), file).toBe(true);
    }
    expect(await vault.exists("hello/sessions.base")).toBe(false);
    expect(await vault.exists("internal/hello/flows")).toBe(false);
    expect(await vault.read("internal/hello/skills/greeting/SKILL.md")).toBe(GREETING_SKILL);
    expect(await vault.read("internal/hello/policies/always-say-hello/POLICY.md")).toBe(POLITE_POLICY);
    expect(await vault.read("internal/hello/promises/greeting-note/PROMISE.md")).toBe(NOTE_PROMISE);
    expect(await vault.read("internal/hello/hello.md")).toContain("[[internal/hello/sessions.base|Hello world sessions]]");
  });

  it("keeps edited documents and bases on a second enable", async () => {
    const { vault, yami } = await fresh();
    await vault.write("internal/hello/policies/always-say-hello/POLICY.md", "---\nname: always-say-hello\ndescription: Edited.\n---\nEdited by the user.\n");
    await vault.write("internal/hello/sessions.base", "views:\n  - type: table\n    name: Mine\n");
    await yami.enable();
    expect(await vault.read("internal/hello/policies/always-say-hello/POLICY.md")).toContain("Edited by the user.");
    expect(await vault.read("internal/hello/sessions.base")).toContain("Mine");
  });

  it("puts the sessions and the ledger where the module says", async () => {
    class Inner extends Hello {
      readonly id = "inner";
      readonly sessionsIn = "internal";
    }
    class Shown extends Hello {
      readonly id = "shown";
      readonly ledgerIn: Place = "folder";
    }
    class Quiet extends Hello {
      readonly id = "quiet";
      readonly sessionsIn = "none";
    }
    const quiet = new Quiet();
    const inner = new Inner();
    const { vault } = await fresh(inner, new Shown(), quiet);
    expect((await inner.greet.create({ name: "x" })).path).toBe("internal/inner/sessions/x.md");
    expect(await vault.read("internal/shown/shown.md")).toContain("[[shown/sessions.base|Hello world sessions]]");
    expect(await vault.exists("shown/sessions.base")).toBe(true);
    expect(await vault.exists("internal/quiet/sessions.base")).toBe(false);
    expect(await vault.read("internal/quiet/quiet.md")).not.toContain("Sessions:");
    await expect(quiet.greet.create()).rejects.toThrow("has no sessions");
  });

  it("installs a form's files beside it, and keeps edited ones", async () => {
    class Files extends Hello {
      readonly id = "files";
      readonly toned = this.skill({ name: "toned", description: "Greets in a tone.", body: "Read tone.md first.", files: { "tone.md": "Warm and short." } });
      readonly kind = this.policy({ name: "kind", description: "Be kind.", body: "See examples.md." }, { "examples.md": "Thank you." });
    }
    const { vault, yami } = await fresh(new Files());
    expect(await vault.read("internal/files/skills/toned/tone.md")).toBe("Warm and short.");
    expect(await vault.read("internal/files/skills/toned/SKILL.md")).toBe("---\nname: toned\ndescription: Greets in a tone.\n---\nRead tone.md first.");
    expect(await vault.read("internal/files/policies/kind/examples.md")).toBe("Thank you.");
    await vault.write("internal/files/skills/toned/tone.md", "Edited.");
    await yami.enable();
    expect(await vault.read("internal/files/skills/toned/tone.md")).toBe("Edited.");
  });

  it("installs an agent, a policy, and a promise from their parts, with every other property in the header", async () => {
    class Parts extends Hello {
      readonly id = "parts";
      readonly checker = this.agent({ name: "checker", description: "Checks the greeting.", access: "read-only", body: "Read the greeting note." });
      readonly fixer = this.agent("---\nname: fixer\ndescription: Fixes the greeting.\naccess: edit\n---\nFix it.\n");
      readonly brief = this.policy({ name: "brief", description: "One line.", body: "Write one line." });
      readonly made = this.promise({ name: "made", description: "The note exists.", check: "exists", path: "made/{{session}}.md", body: "Write the note." });
    }
    const parts = new Parts();
    const { vault } = await fresh(parts);
    expect(await vault.read("internal/parts/agents/checker/AGENT.md")).toBe("---\nname: checker\ndescription: Checks the greeting.\naccess: read-only\n---\nRead the greeting note.");
    expect(await vault.read("internal/parts/agents/fixer/AGENT.md")).toBe("---\nname: fixer\ndescription: Fixes the greeting.\naccess: edit\n---\nFix it.\n");
    expect(await vault.read("internal/parts/policies/brief/POLICY.md")).toBe("---\nname: brief\ndescription: One line.\n---\nWrite one line.");
    expect(await vault.read("internal/parts/promises/made/PROMISE.md")).toBe("---\nname: made\ndescription: The note exists.\ncheck: exists\npath: made/{{session}}.md\n---\nWrite the note.");
    expect(parts.checker).toMatchObject({ kind: "agent", name: "checker", path: "internal/parts/agents/checker/AGENT.md", link: "[[internal/parts/agents/checker/AGENT|checker]]" });
  });

  it("refuses a form with no name or no description, a name that cannot name a folder, a document or a flow twice, and an id a folder cannot take", () => {
    const build = (make: (m: any) => unknown) => () => new (class extends Hello { readonly extra = make(this); })();
    expect(build((m) => m.skill("# No frontmatter\n"))).toThrow("A skill of the hello module has no name in its frontmatter.");
    expect(build((m) => m.policy("---\nname: brief\n---\nOne line.\n"))).toThrow("A policy of the hello module, brief, has no description in its frontmatter.");
    expect(build((m) => m.policy({ name: "Be brief", description: "One line.", body: "x" }))).toThrow('is named "Be brief". A name is lower-case letters, digits, and dashes, and it names the document\'s folder.');
    expect(build((m) => m.policy(POLITE_POLICY))).toThrow("The policy always-say-hello is in the module twice.");
    expect(build((m) => m.flow({ name: "greet", description: "Again." }))).toThrow("The flow greet is in the module twice.");
    expect(build((m) => m.flow({ name: "Not a name", description: "Bad." }))).toThrow('"Not a name" cannot name a flow');
    const vault = new FsVault("/tmp/none");
    expect(
      () =>
        new Yami({
          vault,
          modules: [
            new (class extends Hello {
              readonly id = "Bad Id";
            })(),
          ],
        }),
    ).toThrow("cannot be a module id");
    expect(() => new Yami({ vault, modules: [new Hello(), new Hello()] })).toThrow("Two modules have the id hello.");
    expect(
      () =>
        new Yami({
          vault,
          modules: [
            new (class extends Hello {
              readonly id = "wiki";
            })(),
          ],
        }),
    ).toThrow("Two modules have the id wiki.");
  });

  it("knows the vault only once a Yami has it, and belongs to one Yami", () => {
    const hello = new Hello();
    expect(() => hello.vault).toThrow("The hello module is not added to a Yami yet.");
    const vault = new FsVault("/tmp/none");
    new Yami({ vault, modules: [hello] });
    expect(hello.vault).toBe(vault);
    expect(() => new Yami({ vault, modules: [hello] })).toThrow("already added to another Yami");
  });

  it("gives a module its own icon, the default when it names none, and the wiki a book", () => {
    const yami = new Yami({ vault: new FsVault("/tmp/none"), modules: [new Hello(), new (class extends Hello { readonly id = "shelf"; readonly icon = "library"; })()] });
    expect(Object.fromEntries(yami.modules.map((m) => [m.id, m.icon]))).toEqual({ wiki: "book-open", hello: MODULE_ICON, shelf: "library" });
    expect(MODULE_ICON).toBe("box");
  });
});

describe("creating a session from a flow", () => {
  it("links the flow's documents by full path, with the module's fields, the flow's name, and an empty Request section", async () => {
    class Asked extends Hello {
      readonly id = "asked";
      readonly checker = this.agent({ name: "checker", description: "Checks.", body: "Check." });
      readonly ask = this.flow({ name: "ask", description: "A question.", fields: { greeting: "Hi" }, agents: [this.checker], promises: [this.note] });
    }
    const asked = new Asked();
    const { vault } = await fresh(asked);
    const { path } = await asked.greet.create({ name: "x" });
    const created = await vault.read(path);
    expect(created).toContain('"[[internal/asked/skills/greeting/SKILL|greeting]]"');
    expect(created).toContain('"[[internal/asked/policies/always-say-hello/POLICY|always-say-hello]]"');
    expect(created).toContain("greeting: Hello");
    expect(created).toContain("flow: greet");
    expect(created).not.toContain("template");
    expect(created).toContain("# x\n\n## Request\n\n## Deliverables\n- [ ] [[internal/asked/promises/greeting-note/PROMISE|greeting-note]]\n\n## Progress\n");
    const asking = await readDocument(vault, (await asked.ask.create({ name: "y", fields: { greeting: "Hey" } })).path);
    expect(asking.properties).toMatchObject({ greeting: "Hey", flow: "ask", agents: ["[[internal/asked/agents/checker/AGENT|checker]]"], skills: [] });
  });

  it("writes the request into the Request section", async () => {
    const hello = new Hello();
    const { vault } = await fresh(hello);
    const { path } = await hello.greet.create({ name: "asked", request: "  Greet Ada.\n\nShe likes short lines.\n" });
    const body = (await readDocument(vault, path)).body;
    expect(body).toBe("# asked\n\n## Request\nGreet Ada.\n\nShe likes short lines.\n\n## Deliverables\n- [ ] [[internal/hello/promises/greeting-note/PROMISE|greeting-note]]\n\n## Progress\n");
    expect(sectionText(body, "Request")).toBe("Greet Ada.\n\nShe likes short lines.");
  });

  it("names a session after its flow and the time, makes any name safe, and numbers a name in use", async () => {
    class Long extends Hello {
      readonly id = "long";
      readonly review = this.flow({ name: "code-review", description: "Reviews code." });
    }
    const hello = new Hello();
    const long = new Long();
    await fresh(hello, long);
    expect((await hello.greet.create()).path).toMatch(/^hello\/Greet \d{4}-\d\d-\d\d \d\d-\d\d\.md$/);
    expect((await long.review.create()).path).toMatch(/^long\/Code review \d{4}-\d\d-\d\d \d\d-\d\d\.md$/);
    expect((await hello.greet.create({ name: "C# notes: week [1]" })).path).toBe("hello/C notes week 1.md");
    expect((await hello.greet.create({ name: "C# notes: week [1]" })).path).toBe("hello/C notes week 1 (2).md");
    expect((await hello.greet.create({ name: "..." })).path).toBe("hello/Session.md");
  });

  it("labels a flow's button and command New, with each dash of its name as a space", () => {
    const long = new (class extends Hello {
      readonly review = this.flow({ name: "code-review", description: "Reviews code." });
    })();
    expect(long.greet.label).toBe("New greet");
    expect(long.review.label).toBe("New code review");
    expect(long.acts().map((act) => act.label)).toEqual(["New greet", "New code review"]);
  });

  it("refuses an exact name that is in use or that cannot name one file", async () => {
    const hello = new Hello();
    await fresh(hello);
    await hello.greet.create({ name: "x", exact: true });
    await expect(hello.greet.create({ name: "x", exact: true })).rejects.toThrow("A session named x exists.");
    for (const name of ["train/val split", "a:b", "x#y", " padded", ".hidden", "", "[x]", "a|b", "a^b", "a*b", "a?b", 'a"b', "a<b", "a>b", "a\\b", "Fix\nparser", "tab\there"]) {
      await expect(hello.greet.create({ name, exact: true }), JSON.stringify(name)).rejects.toThrow("cannot name a file");
    }
    expect((await hello.greet.create({ name: "Divide by zero, safely (v2)", exact: true })).path).toBe("hello/Divide by zero, safely (v2).md");
  });

  it("links a document of another module on top of the flow's, once, an agent too", async () => {
    class Other extends Hello {
      readonly id = "other";
      readonly extra = this.policy({ name: "be-brief", description: "One line.", body: "One line." });
      readonly helper = this.agent({ name: "helper", description: "Helps.", body: "Help." });
    }
    const hello = new Hello();
    const other = new Other();
    const { vault } = await fresh(hello, other);
    const { path } = await hello.greet.create({ name: "x", add: [other.extra, hello.polite, other.helper] });
    const { properties } = await readDocument(vault, path);
    expect(properties.policies).toEqual(["[[internal/hello/policies/always-say-hello/POLICY|always-say-hello]]", "[[internal/other/policies/be-brief/POLICY|be-brief]]"]);
    expect(properties.agents).toEqual(["[[internal/other/agents/helper/AGENT|helper]]"]);
  });

  it("refuses fields that the module's schema does not take", async () => {
    const hello = new Hello();
    await fresh(hello);
    await expect(hello.greet.create({ fields: { greeting: 3 } })).rejects.toThrow("greeting must be text");
  });

  it("finds a flow by its name, the first for no name, and none for a name no flow has", () => {
    class Two extends Hello {
      readonly id = "two";
      readonly other = this.flow({ name: "other", description: "Other." });
    }
    const two = new Two();
    expect(two.flowOf("other")).toBe(two.other);
    expect(two.flowOf("greet")).toBe(two.greet);
    for (const none of [undefined, null, ""]) expect(two.flowOf(none)).toBe(two.greet);
    for (const unknown of ["missing", 3, ["other"]]) expect(two.flowOf(unknown)).toBeUndefined();
  });

  it("lists the session documents of the vault, of a module, or of a flow", async () => {
    class Two extends Hello {
      readonly id = "two";
      readonly other = this.flow({ name: "other", description: "Other." });
    }
    const hello = new Hello();
    const two = new Two();
    const { yami, vault } = await fresh(hello, two);
    await hello.greet.create({ name: "a" });
    await two.greet.create({ name: "b" });
    await two.other.create({ name: "c" });
    await vault.write("two/c/notes.md", "---\ntype: session\nmodule: two\n---\nA note in a session's folder.\n");
    await vault.write("two/plain.md", "No properties.\n");
    const paths = async (of?: Parameters<typeof yami.sessions>[0]) => (await yami.sessions(of)).map((s) => s.path);
    expect(await paths()).toEqual(["two/c.md", "two/b.md", "hello/a.md"]);
    expect(await paths(two)).toEqual(["two/c.md", "two/b.md"]);
    expect(await paths(two.greet)).toEqual(["two/b.md"]);
    expect(yami.session("two/b.md")).toBe(yami.session("two/b.md"));
  });
});

describe("the tools and skills of the modules", () => {
  it("serves the tools of every module in one set, named by module, and gives it to the agents with the vault and the skills", async () => {
    class Two extends Hello {
      readonly id = "hello-two";
      readonly name = "Two";
    }
    class None extends YamiModule {
      readonly id = "none";
      readonly name = "None";
    }
    const { yami, agent, root } = await fresh(new Hello(), new Two(), new None());
    const set = yami.tools();
    expect(set.name).toBe("yami");
    expect(set.description).toBe("Tools of Yami. Tools of the Yami modules in this vault: Wiki, Hello world, Two.");
    expect(set.tools.map((tool: AgentTool) => tool.name)).toEqual(["yami_check", "yami_agent", "wiki_search", "wiki_match", "wiki_lint", "wiki_tags", "wiki_neighbors", "wiki_chunks", "wiki_change", "hello_greet_user", "hello_two_greet_user"]);
    expect(await runTool(set.tools.find((tool: AgentTool) => tool.name === "hello_greet_user")!, { name: "Ada" }, new AbortController().signal)).toEqual({ text: "Hello, Ada!", isError: false });
    expect(agent.preferences.cwd).toBe(root);
    expect(agent.preferences.tools?.tools.map((tool) => tool.name)).toEqual(set.tools.map((tool) => tool.name));
    expect(agent.preferences.skills).toEqual([`${root}/internal/yami`, `${root}/internal/wiki`, `${root}/internal/hello`, `${root}/internal/hello-two`]);
  });

  it("names each module's internal folder as a skill set, and each skill by /<module>:<skill>", async () => {
    const { root } = await fresh();
    expect(skillCommand("internal/wiki/skills/ingest/SKILL.md")).toEqual({ command: "wiki:ingest", root: "internal/wiki" });
    expect(skillCommand("notes/SKILL.md")).toBeUndefined();
    expect(setSkills([`${root}/internal/hello`])).toEqual([
      { command: "hello:greeting", set: "hello", name: "greeting", path: `${root}/internal/hello/skills/greeting/SKILL.md`, description: "How to greet a person or a session by name." },
    ]);
    expect(slashCommand("/wiki:ingest the context\nwith lines")).toEqual({ command: "wiki:ingest", rest: "the context\nwith lines" });
    expect(slashCommand("/hello:greeting")).toEqual({ command: "hello:greeting", rest: "" });
    expect(slashCommand("no command")).toBeUndefined();
  });

  it("keeps a module's actions, each id once", () => {
    class Acting extends Hello {
      readonly publish = this.action({ id: "publish", name: "Publish", run: async () => "done" });
      readonly pick = this.action({ id: "pick", name: "Pick one", choose: { items: async () => [1, 2], label: (n) => `${n}`, placeholder: "A number" }, run: async (n) => `${n * 2}` });
      readonly back = this.action({ id: "back", name: "Return", on: this.greet, when: (p) => p.state === "done", run: async (s) => s.path });
    }
    const acting = new Acting();
    expect(acting.actions.map((a) => a.id)).toEqual(["publish", "pick", "back"]);
    expect(
      () =>
        new (class extends Acting {
          readonly again = this.action({ id: "publish", name: "Again", run: async () => undefined });
        })(),
    ).toThrow("The action publish is in the module twice.");
  });

  it("reads a section's text, trimmed, and nothing for a missing one", () => {
    const body = "# T\n\n## Plan\n\n- a\n- b\n\n## Notes\nn\n";
    expect(sectionText(body, "Plan")).toBe("- a\n- b");
    expect(sectionText(body, "Notes")).toBe("n");
    expect(sectionText(body, "Missing")).toBe("");
  });

  it("follows the script of a scripted agent across its sessions", async () => {
    const agent = new ScriptedAgent([() => ({ text: "one" })]).queue(() => ({ text: "two" }));
    const first = await agent.startSession();
    expect((await first.send("a")).text).toBe("one");
    const second = await agent.startSession({ resume: first.id });
    expect(second.id).toBe(first.id);
    expect((await second.send("b")).text).toBe("two");
    expect((await second.send("c")).text).toBe("ok");
    expect(agent.started.map((s) => s.prompts)).toEqual([["a"], ["b", "c"]]);
  });
});
