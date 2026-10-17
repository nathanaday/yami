import { afterEach, describe, expect, it } from "vitest";
import { runTool, setSkills, slashCommand } from "../../src/agent/index.js";
import { readDocument, sectionText } from "../../src/document/index.js";
import { MODULE_ICON, skillCommand, Yami, YamiModule, type AgentTool, type Place } from "../../src/index.js";
import { FsVault, ScriptedAgent, testYami, type TestYami } from "../../src/testing/index.js";
import { GREETING_SKILL, Hello } from "../fixtures/hello.js";

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
  it("installs the ledgers, the module document, and its documents, with the ledger out of the sessions' way", async () => {
    const { vault } = await fresh();
    for (const file of ["Yami.base", "internal/hello/sessions.base", "internal/hello/hello.md", "internal/hello/policies/Always say hello.md", "internal/hello/skills/greeting/SKILL.md"]) {
      expect(await vault.exists(file), file).toBe(true);
    }
    expect(await vault.exists("hello/sessions.base")).toBe(false);
    expect(await vault.read("internal/hello/skills/greeting/SKILL.md")).toBe(GREETING_SKILL);
    expect(await vault.read("internal/hello/promises/Greeting note.md")).toBe(
      "---\ntype: promise\nmodule: hello\ncheck: exists\npath: greetings/{{session}}.md\n---\nCreate this note. Its content is one line: the greeting, addressed to the session by name.",
    );
    expect(await vault.read("internal/hello/hello.md")).toContain("[[internal/hello/sessions.base|Hello world sessions]]");
  });

  it("keeps edited documents and bases on a second enable", async () => {
    const { vault, yami } = await fresh();
    await vault.write("internal/hello/policies/Always say hello.md", "---\ntype: policy\nmodule: hello\n---\nEdited by the user.\n");
    await vault.write("internal/hello/sessions.base", "views:\n  - type: table\n    name: Mine\n");
    await yami.enable();
    expect(await vault.read("internal/hello/policies/Always say hello.md")).toContain("Edited by the user.");
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

  it("installs a skill's files beside its SKILL.md, and keeps edited ones", async () => {
    class Files extends Hello {
      readonly id = "files";
      readonly toned = this.skill({ name: "toned", description: "Greets in a tone.", body: "Read tone.md first.", files: { "tone.md": "Warm and short." } });
    }
    const { vault, yami } = await fresh(new Files());
    expect(await vault.read("internal/files/skills/toned/tone.md")).toBe("Warm and short.");
    expect(await vault.read("internal/files/skills/toned/SKILL.md")).toBe("---\nname: toned\ndescription: Greets in a tone.\n---\nRead tone.md first.");
    await vault.write("internal/files/skills/toned/tone.md", "Edited.");
    await yami.enable();
    expect(await vault.read("internal/files/skills/toned/tone.md")).toBe("Edited.");
  });

  it("installs an agent in its harness's own form, from its parts or from markdown", async () => {
    class Agents extends Hello {
      readonly id = "agents";
      readonly checker = this.agent({ name: "checker", description: "Checks the greeting. Edits nothing.", tools: ["Read", "Grep"], body: "Read the greeting note." });
      readonly reviewer = this.agent("---\nname: reviewer\ndescription: Reviews.\ntools: Read\n---\nReview it.\n");
    }
    const { vault } = await fresh(new Agents());
    expect(await vault.read("internal/agents/agents/checker.md")).toBe("---\nname: checker\ndescription: Checks the greeting. Edits nothing.\ntools: Read, Grep\n---\nRead the greeting note.");
    expect(await vault.read("internal/agents/agents/reviewer.md")).toBe("---\nname: reviewer\ndescription: Reviews.\ntools: Read\n---\nReview it.\n");
  });

  it("refuses a skill with no name, a document or a template twice, and an id a folder cannot take", () => {
    expect(
      () =>
        new (class extends Hello {
          readonly nameless = this.skill("# No frontmatter\n");
        })(),
    ).toThrow("has no name in its frontmatter");
    expect(
      () =>
        new (class extends Hello {
          readonly again = this.policy("Always say hello", "x");
        })(),
    ).toThrow("The policy Always say hello is in the module twice.");
    expect(
      () =>
        new (class extends Hello {
          readonly again = this.template({ id: "greet", name: "Again" });
        })(),
    ).toThrow("The template greet is in the module twice.");
    expect(
      () =>
        new (class extends Hello {
          readonly bad = this.template({ id: "Not an id", name: "Bad" });
        })(),
    ).toThrow("cannot be a template id");
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

describe("creating a session from a template", () => {
  it("links the template's documents by full path, with the module's fields, the template, and a body to fill in", async () => {
    class Asked extends Hello {
      readonly id = "asked";
      readonly ask = this.template({ id: "ask", name: "Question", fields: { greeting: "Hi" }, body: "## Question\n\nWrite it here.", promises: [this.note] });
    }
    const asked = new Asked();
    const { vault } = await fresh(asked);
    const { path } = await asked.greet.create({ name: "x" });
    const created = await vault.read(path);
    expect(created).toContain('"[[internal/asked/skills/greeting/SKILL|greeting]]"');
    expect(created).toContain('"[[internal/asked/policies/Always say hello|Always say hello]]"');
    expect(created).toContain("greeting: Hello");
    expect(created).toContain("template: greet");
    expect(created).toContain("# x\n\n## Deliverables\n- [ ] [[internal/asked/promises/Greeting note|Greeting note]]\n\n## Progress\n");
    const asking = await vault.read((await asked.ask.create({ name: "y", fields: { greeting: "Hey" } })).path);
    expect(asking).toContain("greeting: Hey");
    expect(asking).toContain("template: ask");
    expect(asking).toContain("# y\n\n## Question\n\nWrite it here.\n\n## Deliverables\n");
    expect((await readDocument(vault, `asked/y.md`)).properties.skills).toEqual([]);
  });

  it("names a session after its template and the time, makes any name safe, and numbers a name in use", async () => {
    const hello = new Hello();
    await fresh(hello);
    expect((await hello.greet.create()).path).toMatch(/^hello\/Greeting \d{4}-\d\d-\d\d \d\d-\d\d\.md$/);
    expect((await hello.greet.create({ name: "C# notes: week [1]" })).path).toBe("hello/C notes week 1.md");
    expect((await hello.greet.create({ name: "C# notes: week [1]" })).path).toBe("hello/C notes week 1 (2).md");
    expect((await hello.greet.create({ name: "..." })).path).toBe("hello/Session.md");
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

  it("links a document of another module on top of the template's, once", async () => {
    class Other extends Hello {
      readonly id = "other";
      readonly extra = this.policy("Be brief", "One line.");
    }
    const hello = new Hello();
    const other = new Other();
    const { vault } = await fresh(hello, other);
    const { path } = await hello.greet.create({ name: "x", add: [other.extra, hello.polite] });
    expect((await readDocument(vault, path)).properties.policies).toEqual(["[[internal/hello/policies/Always say hello|Always say hello]]", "[[internal/other/policies/Be brief|Be brief]]"]);
  });

  it("refuses fields that the module's schema does not take", async () => {
    const hello = new Hello();
    await fresh(hello);
    await expect(hello.greet.create({ fields: { greeting: 3 } })).rejects.toThrow("greeting must be text");
  });

  it("lists the session documents of the vault, of a module, or of a template", async () => {
    class Two extends Hello {
      readonly id = "two";
      readonly other = this.template({ id: "other", name: "Other" });
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
    const set = yami.tools()!;
    expect(set.name).toBe("yami");
    expect(set.description).toBe("Tools of the Yami modules in this vault: Wiki, Hello world, Two.");
    expect(set.tools.map((tool: AgentTool) => tool.name)).toEqual(["wiki_search", "wiki_match", "wiki_lint", "wiki_tags", "wiki_neighbors", "wiki_chunks", "wiki_change", "hello_greet_user", "hello_two_greet_user"]);
    expect(await runTool(set.tools.find((tool: AgentTool) => tool.name === "hello_greet_user")!, { name: "Ada" }, new AbortController().signal)).toEqual({ text: "Hello, Ada!", isError: false });
    expect(agent.preferences.cwd).toBe(root);
    expect(agent.preferences.tools?.tools.map((tool) => tool.name)).toEqual(set.tools.map((tool) => tool.name));
    expect(agent.preferences.skills).toEqual([`${root}/internal/wiki`, `${root}/internal/hello`, `${root}/internal/hello-two`]);
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
