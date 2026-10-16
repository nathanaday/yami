# Reviewing yami + obsidian_plugin

Yami should contain all the library tools you need to build the plugin. The only Yami built-in module is the wiki. All other modules are created in the obsidian plugin by interfacing with the Yami library and the tools it exposes (which is what we are working on)

The pseudocode below is meant to illustrate the intended plugin developer experience. It is intentionally high level and non-exhaustive.


### Imports

Let's keep the imports simple...

```ts
import { MarkdownView, Notice, Plugin, type TFile } from "obsidian";
import { createYami } from "yami";


// The entire agent library is located in one module
import type { Agent } from "yami/agent";

// The entire wiki library is located in another module
import {Wiki} from "yami/wiki"

```

### Plugin Class

Focus on the main library entities that we work with. when in doubt, the underlying library should carry everything you need

```ts
export default class YamiPlugin extends Plugin {
  private yami = createYami();
  private agent!: Agent;
  private vault!: ObsidianVault;
  private wiki!: Wiki;
  ...
}
```


### On Load

```ts
async onload() {
    const cwd = vaultRoot(this.app);
    this.vault = new ObsidianVault(this.app, cwd);

    this.agent = new Agent.ClaudeAgent({ preferences: {
        conversations: "/conversations",

        // and other config settings
    }});

    CONVERSATIONS_PATH = this.agent.conversationsPath();
    this.wiki = new Wiki(this.vault, { exclude: CONVERSATIONS_PATH);


    

    // Add commands

    ...
}
```

### Creating Modules

The modules like librarian, threads, etc. are built using the Yami library tools, but these are built on the plugin side, not built into Yami library directly

The Yami tools exposes everything you need to build an agent work loop using your markdown files and wiki...



```ts
export default class Librarian extends YamiModules {
  
    USER_FACING_DIR = this.moduleUserDirectory; // default is `/<module>`
    INTERNAL_DIR = this.moduleInternalDirectory; // default is `/tools/<module>`

    // Define where the session doc is located
    // (default is the module base path)
    this.sessionDocLocation = USER_FACING_DIR;

    // Define where the module ledger is located...
    // (default is the tool/<module> internal path)
    this.moduleLederLocation = INTERNAL_DIR;

    this.skillsLocation = INTERNAL_DIR;

    // Skills describe how the agent should work
    // Now these will automatically show up in the skills directory and are available to use in the module
    checkoutSkill = this.addSkill("/path/to/skill/SKILL.md");
    returnSkill = this.addSkill("/path/to/skill/SKILL.md");

    // Policies describe what the workflow needs to obey
    // These will show up in policies and are available to use in the module
    checkoutPolicy = this.addPolicy("/path/to/policy/POLICY.md")

    // Promises describe what the workflow needs to deliver
    checkoutPromise = this.addPromise("/path/to/policy/PROMISE.md")

    // Add MCP Tools (I don't have a strong opinion about the best way to do this, either write the function elsewhere or bind it here)

    // Design the session entity
    // These are just templates to use that makes it easier to auto-run certain agent workflows that the plugin designs
    checkoutSession = new YamiSession({
        id: "librarian-checkout",
        name: "Librarian Checkout"
        skills: [checkoutSkill],
        policies: [checkoutPolicy],
        promises: [checkoutPromise],
        maxIterations: 3 // optional
    });

}
```


### Using the module

When the module is defined, it can just be imported into the main.ts or whatever part of the obsidian plugin you want

```ts

private librarian = Librarian.createModule();

const sessionFile = this.yami.getSelectedSessionFile();
const session = this.yami.createSession(sessionFile);

this.addCommand({
      id: librarian.checkoutSession.id
      name: librarian.checkoutSession.name
      callback: () => session.start(),
    });
```


### Working with sessions

I don't fully know how this should work, but basically the Yami library helps you manage the session states while you agent is executing.

This will help the plugin develop create responsive UI's to customize how the sessions are displayed and watching the status.

```ts

agent.allSessions(); // list all active agent sessions or similar; they will point particular session files they are running

session.getStatus(); // not started, working, validating, done, failed, etc.

// session actions
session.start();
session.resume();

// force cancellations
session.stop();
session.kill();
```
