import { Window } from "happy-dom";

/**
 * A DOM over happy-dom in the node environment, with the helpers that Obsidian adds to every element and to
 * the window, as Obsidian writes them. Run it before the code under test makes an element.
 */
export function installDom(): void {
  const dom = new Window();
  Object.assign(globalThis, {
    window: globalThis,
    Window,
    document: dom.document,
    Node: dom.Node,
    Element: dom.Element,
    HTMLElement: dom.HTMLElement,
    Text: dom.Text,
    Range: dom.Range,
    NodeFilter: dom.NodeFilter,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    Event: dom.Event,
    KeyboardEvent: dom.KeyboardEvent,
    MouseEvent: dom.MouseEvent,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    getSelection: dom.getSelection.bind(dom),
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0),
    cancelAnimationFrame: (handle: number) => clearTimeout(handle),
  });
  const proto = HTMLElement.prototype;
  proto.createEl = function <K extends keyof HTMLElementTagNameMap>(this: HTMLElement, tag: K, o?: DomElementInfo | string) {
    const info = typeof o === "string" ? { cls: o } : (o ?? {});
    const el = document.createElement(tag);
    if (info.cls) el.className = Array.isArray(info.cls) ? info.cls.join(" ") : info.cls;
    if (info.text) el.textContent = String(info.text);
    for (const [key, value] of Object.entries(info.attr ?? {})) el.setAttribute(key, String(value));
    if (info.type) el.setAttribute("type", info.type);
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
  const detached = (el: HTMLElement) => (el.remove(), el);
  const scratch = document.createElement("div");
  Object.assign(globalThis, {
    createEl: (tag: keyof HTMLElementTagNameMap, o?: DomElementInfo | string) => detached(scratch.createEl(tag, o)),
    createDiv: (o?: DomElementInfo | string) => detached(scratch.createDiv(o)),
  });
}
