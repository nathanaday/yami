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
    await this.ensureFolder(path);
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

  async files(folder: string): Promise<string[]> {
    const prefix = folder ? `${normalizePath(folder)}/` : "";
    return this.app.vault
      .getFiles()
      .map((file) => file.path)
      .filter((path) => path.startsWith(prefix));
  }

  async remove(path: string): Promise<void> {
    path = normalizePath(path);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file) await this.app.fileManager.trashFile(file);
    else if (await this.app.vault.adapter.exists(path)) await this.app.vault.adapter.remove(path);
  }

  async readBinary(path: string): Promise<Uint8Array> {
    return new Uint8Array(await this.app.vault.adapter.readBinary(normalizePath(path)));
  }

  async writeBinary(path: string, data: Uint8Array): Promise<void> {
    path = normalizePath(path);
    await this.ensureFolder(path);
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    const file = this.app.vault.getFileByPath(path);
    if (file) await this.app.vault.modifyBinary(file, buffer);
    else if (await this.app.vault.adapter.exists(path)) await this.app.vault.adapter.writeBinary(path, buffer);
    else await this.app.vault.createBinary(path, buffer);
  }

  parseProperties(yaml: string): Properties {
    return (parseYaml(yaml) as Properties | null) ?? {};
  }

  stringifyProperties(properties: Properties): string {
    return stringifyYaml(properties);
  }

  /** Creates the folder of a path. A path at the vault root has none. */
  private async ensureFolder(path: string): Promise<void> {
    const slash = path.lastIndexOf("/");
    if (slash === -1) return;
    const folder = path.slice(0, slash);
    if (!(await this.app.vault.adapter.exists(folder))) await this.app.vault.adapter.mkdir(folder);
  }
}
