import { Notice, Plugin } from "obsidian";

export default class YamiPlugin extends Plugin {
  async onload() {

    console.log("Loaded!");

    this.addRibbonIcon("hand", "Say hello", () => this.sayHello());

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
    new Notice("Hello, yami!");
  }
}
