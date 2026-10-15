import { normalizePath, parseYaml, stringifyYaml, type App } from "obsidian";
import type { Properties, Vault } from "../document/index.js";

/** The Yami vault interface over the Obsidian API. */
export class ObsidianVault implements Vault {
  constructor(
    private readonly app: App,
    readonly root: string,
  ) {}

  read(path: string): Promise<string> {
    return this.app.vault.adapter.read(normalizePath(path));
  }

  async write(path: string, text: string): Promise<void> {
    path = normalizePath(path);
    const folder = path.slice(0, path.lastIndexOf("/"));
    if (folder && !(await this.app.vault.adapter.exists(folder))) await this.app.vault.adapter.mkdir(folder);
    const file = this.app.vault.getFileByPath(path);
    if (file) await this.app.vault.modify(file, text);
    else if (await this.app.vault.adapter.exists(path)) await this.app.vault.adapter.write(path, text);
    else await this.app.vault.create(path, text);
  }

  exists(path: string): Promise<boolean> {
    return this.app.vault.adapter.exists(normalizePath(path));
  }

  async list(folder: string): Promise<string[]> {
    const prefix = folder ? `${normalizePath(folder)}/` : "";
    return this.app.vault
      .getMarkdownFiles()
      .map((file) => file.path)
      .filter((path) => path.startsWith(prefix));
  }

  parseProperties(yaml: string): Properties {
    return (parseYaml(yaml) as Properties | null) ?? {};
  }

  stringifyProperties(properties: Properties): string {
    return stringifyYaml(properties);
  }
}
