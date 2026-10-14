import { Notice, Plugin } from "obsidian";
import { createYami } from "yami_sdk";

export default class YamiPlugin extends Plugin {
  private yami = createYami();

  async onload() {

    console.log("Loaded!");

    this.addRibbonIcon("hand", "HeelllooOOoOoOOOOoooo", () => this.sayHello());

    this.addCommand({
      id: "say-hello",
      name: "Say hello",
      callback: () => this.sayHello(),
    });
  }

  onunload() {
    // Release any resources configured by the plugin.
  }

  private sayHello() {
    new Notice(this.yami.sayHello());
  }
}
