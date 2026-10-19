import { Window } from "happy-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => {
  class Scope {
    register() {}
  }
  class Notice {
    static messages: string[] = [];
    constructor(message: string) {
      Notice.messages.push(message);
    }
  }
  return {
    Scope,
    Notice,
    Menu: class {},
    TFile: class {},
    FileSystemAdapter: class {},
    prepareFuzzySearch: () => () => null,
    // Obsidian draws an icon as an SVG child, in place of the element's children.
    setIcon: (el: HTMLElement, icon: string) => {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("data-icon", icon);
      el.replaceChildren(svg);
    },
    setTooltip: (el: HTMLElement, text: string) => el.setAttribute("aria-label", text),
  };
});

vi.mock("../../../src/obsidian/agents.js", async (actual) => ({
  ...(await actual<typeof import("../../../src/obsidian/agents.js")>()),
  Presence: class {
    peer() {
      return { beginTurn() {}, setCursor() {} };
    }
    setStatus() {}
    clear() {}
  },
}));

vi.mock("../../../src/obsidian/collab/region.js", () => ({
  LiveRegion: class {
    set() {}
    settled() {
      return Promise.resolve();
    }
    close() {}
  },
}));

import { Notice, type App, type MarkdownView, type TFile } from "obsidian";
import { applyOps, type TextOp } from "../../../src/document/text-ops.js";
import type { ConversationAgent } from "../../../src/obsidian/agents.js";
import { Composer } from "../../../src/obsidian/conversation/composer.js";
import { ConversationController } from "../../../src/obsidian/conversation/controller.js";
import { ScriptedAgent } from "../../../src/testing/index.js";

const NO_AGENTS = "Test Plugin has no agents. Add one in its settings.";
const notices = () => (Notice as unknown as { messages: string[] }).messages;
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

/** A DOM, with the helpers that Obsidian adds to every element, as Obsidian writes them. */
beforeAll(() => {
  const dom = new Window();
  Object.assign(globalThis, {
    window: globalThis,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    Event: dom.Event,
    KeyboardEvent: dom.KeyboardEvent,
  });
  const proto = HTMLElement.prototype;
  proto.createEl = function <K extends keyof HTMLElementTagNameMap>(this: HTMLElement, tag: K, o?: DomElementInfo | string) {
    const info = typeof o === "string" ? { cls: o } : (o ?? {});
    const el = document.createElement(tag);
    if (info.cls) el.className = Array.isArray(info.cls) ? info.cls.join(" ") : info.cls;
    if (info.text) el.textContent = String(info.text);
    for (const [key, value] of Object.entries(info.attr ?? {})) el.setAttribute(key, String(value));
    this.appendChild(el);
    return el;
  } as never;
  proto.createDiv = function (this: HTMLElement, o?: DomElementInfo | string) {
    return this.createEl("div", o);
  };
  proto.createSpan = function (this: HTMLElement, o?: DomElementInfo | string) {
    return this.createEl("span", o);
  };
  proto.empty = function (this: HTMLElement) {
    while (this.firstChild) this.removeChild(this.firstChild);
  };
  proto.setText = function (this: HTMLElement, text: string | DocumentFragment) {
    this.textContent = String(text);
  };
  proto.addClass = function (this: HTMLElement, ...classes: string[]) {
    this.classList.add(...classes);
  };
  proto.removeClass = function (this: HTMLElement, ...classes: string[]) {
    this.classList.remove(...classes);
  };
  proto.toggleClass = function (this: HTMLElement, classes: string | string[], value: boolean) {
    for (const each of [classes].flat()) value ? this.classList.add(each) : this.classList.remove(each);
  };
  proto.setCssProps = function (this: HTMLElement, props: Record<string, string>) {
    for (const [key, value] of Object.entries(props)) this.style.setProperty(key, value);
  };
});

afterEach(() => {
  notices().length = 0;
});

/** A conversation note open in a view with its composer, over agents that the test changes. */
async function open() {
  const claude = new ScriptedAgent();
  let agents: ConversationAgent[] = [{ name: "claude", color: "#d97757", agent: claude }];
  const frontmatter: Record<string, unknown> = { type: "conversation", agent: "claude", status: "active" };
  let content = "---\ntype: conversation\nagent: claude\nstatus: active\n---\n> [!user]\n> Hello\n\n";
  const note = {
    get content() {
      return content;
    },
    applyOps: (ops: TextOp[]) => void (content = applyOps(content, ops)),
    relative: () => undefined,
  };
  const hub = { acquire: async () => note, release() {}, addWriter: () => () => undefined, prepare: async () => undefined };
  const file = { path: "conversations/Talk.md", basename: "Talk", parent: { path: "conversations" } } as unknown as TFile;
  const app = {
    scope: {},
    keymap: { pushScope() {}, popScope() {} },
    vault: { getMarkdownFiles: () => [] },
    metadataCache: { getFileCache: () => ({ frontmatter }), getFirstLinkpathDest: () => null },
  } as unknown as App;
  const controller = new ConversationController(app, hub as never, file, () => agents, {} as never, {
    animate: () => false,
    idleMinutes: () => 15,
    newConversation: () => undefined,
    onActivity: () => undefined,
    onTurnEnd: () => undefined,
    noAgents: NO_AGENTS,
  });
  const containerEl = document.createElement("div");
  const contentEl = containerEl.createDiv();
  document.body.appendChild(containerEl);
  const view = { containerEl, contentEl, getMode: () => "source", editor: {} } as unknown as MarkdownView;
  const composer = new Composer(app, view, controller);
  await flush();
  const root = contentEl.querySelector<HTMLElement>(".yami-composer")!;
  const input = root.querySelector<HTMLTextAreaElement>(".yami-input")!;
  const send = root.querySelector<HTMLButtonElement>(".yami-send")!;
  const type = (text: string) => {
    input.value = text;
    input.dispatchEvent(new Event("input"));
  };
  const enter = () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  const setAgents = (next: ConversationAgent[]) => {
    agents = next;
    controller.agentsChanged();
  };
  return { claude, controller, composer, root, input, send, type, enter, setAgents, agents: () => agents };
}

/** Records every change to an element and its descendants. */
function watch(el: HTMLElement) {
  const observer = new MutationObserver(() => undefined);
  observer.observe(el, { subtree: true, childList: true, attributes: true, characterData: true });
  return () => observer.takeRecords();
}

describe("Composer", () => {
  // The names of the README table "The message box": a host's styles and tests use them, so a change is a break.
  it("gives each part that a host uses its documented name, in each state", async () => {
    const { claude, controller, composer, root, input, send, type, setAgents, agents } = await open();
    const one = (selector: string) => {
      const el = root.querySelector<HTMLElement>(selector);
      expect(el, selector).not.toBeNull();
      return el!;
    };
    const label = (setting: string) => one(`button.yami-chip[data-setting="${setting}"] .yami-chip-label`).textContent;
    expect(composer.view.containerEl.classList.contains("yami-has-composer")).toBe(true);
    expect(input.matches("textarea.yami-input")).toBe(true);
    expect(label("model")).toBe("Default model");
    expect(label("effort")).toBe("Default effort");
    expect(one('[data-setting="effort"]').classList.contains("is-hidden")).toBe(true);
    expect(label("approval")).toBe("Ask first");
    expect(send.matches("button.yami-send")).toBe(true);
    expect(send.disabled).toBe(true);
    expect(send.getAttribute("aria-label")).toBe("Send (Enter)");
    expect([...root.classList]).toEqual(["yami-composer"]);

    type("/");
    expect(one(".yami-suggest").classList.contains("is-shown")).toBe(true);
    expect(one(".yami-suggest-item.is-selected").textContent).toMatch(/^\/model/);
    type("");
    expect(one(".yami-suggest").classList.contains("is-shown")).toBe(false);

    let release!: () => void;
    let decision: string | undefined;
    claude.queue(async (_prompt, session) => {
      const request = { tool: "Bash", kind: "command" as const, title: "ls", raw: null, signal: new AbortController().signal };
      decision = await session.options.onPermission!(request);
      await new Promise<void>((resolve) => (release = resolve));
    });
    void controller.send("Look around");
    await vi.waitFor(() => expect(root.classList.contains("has-approval")).toBe(true));
    expect(root.classList.contains("is-working")).toBe(true);
    expect(one(".yami-composer-status").textContent).not.toBe("");
    expect(send.classList.contains("is-stop")).toBe(true);
    expect(send.disabled).toBe(false);
    expect(send.getAttribute("aria-label")).toBe("Stop (Esc)");
    expect(one('.yami-approval button[data-decision="allow"]').textContent).toBe("Allow onceY");
    expect(one('.yami-approval button[data-decision="allow-session"]').textContent).toBe("Allow for this conversationA");
    one('.yami-approval button[data-decision="deny"]').click();
    await vi.waitFor(() => expect(decision).toBe("deny"));
    expect(root.classList.contains("has-approval")).toBe(false);
    release();
    await flush();
    expect(root.classList.contains("is-working")).toBe(false);

    const entries = agents();
    setAgents([]);
    expect(root.classList.contains("is-unavailable")).toBe(true);
    expect(one(".yami-unavailable").textContent).toBe(NO_AGENTS);
    setAgents(entries);
    expect(root.classList.contains("is-unavailable")).toBe(false);

    await controller.end();
    expect(root.classList.contains("is-ended")).toBe(true);
    one(".yami-ended button").click();
    await flush();
    expect(root.classList.contains("is-ended")).toBe(false);
    composer.destroy();
    expect(composer.view.containerEl.classList.contains("yami-has-composer")).toBe(false);
  });

  it("writes nothing when the agents change and the note's agent did not", async () => {
    const { root, setAgents, agents, composer } = await open();
    expect(root.style.getPropertyValue("--yami-agent")).toBe("#d97757");
    const changes = watch(root);
    setAgents([...agents(), { name: "work", color: "#112233", agent: new ScriptedAgent() }]);
    expect(changes()).toEqual([]);

    setAgents([{ ...agents()[0]!, color: "#000000" }, agents()[1]!]);
    const recolored = changes();
    expect(recolored.map((record) => [record.type, record.attributeName])).toEqual([["attributes", "style"]]);
    expect(root.style.getPropertyValue("--yami-agent")).toBe("#000000");
    composer.destroy();
  });

  it("says what to do when no agent is left, and takes messages again when one is added", async () => {
    const { claude, controller, root, input, send, type, enter, setAgents, composer } = await open();
    const session = claude.last!;
    const entry = { name: "claude", color: "#d97757", agent: claude };
    expect(() => setAgents([])).not.toThrow();
    expect(root.textContent).toContain(NO_AGENTS);
    type("Are you there?");
    expect(send.disabled).toBe(true);
    enter();
    await flush();
    expect(input.value).toBe("Are you there?");
    expect(session.prompts).toEqual([]);
    expect(session.closed).toBe(true);
    expect(controller.agentName).toBe("claude");

    setAgents([entry]);
    expect(root.textContent).not.toContain(NO_AGENTS);
    expect(send.disabled).toBe(false);
    enter();
    await flush();
    expect(claude.last!.prompts[0]).toMatch(/^Are you there\?/);
    expect(claude.last!.id).toBe(session.id);
    composer.destroy();
  });

  it("lets a turn that runs go on when no agent is left, then closes its session", async () => {
    const { claude, controller, root, input, setAgents, composer } = await open();
    let release!: () => void;
    claude.queue(() => new Promise<void>((resolve) => (release = resolve)));
    void controller.send("Work on it");
    await vi.waitFor(() => expect(controller.phase).toBe("working"));
    expect(() => setAgents([])).not.toThrow();
    expect(root.classList.contains("is-working")).toBe(true);
    expect(input.placeholder).toMatch(/^Message claude /);
    expect(root.textContent).toContain(NO_AGENTS);
    expect(claude.last!.closed).toBe(false);

    release();
    await flush();
    expect(controller.working).toBe(false);
    expect(claude.last!.closed).toBe(true);
    await controller.send("Again");
    expect(notices()).toEqual([NO_AGENTS]);
    expect(claude.started).toHaveLength(1);
    composer.destroy();
  });
});
