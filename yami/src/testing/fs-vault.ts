import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import YAML from "yaml";
import type { Properties, Vault } from "../document/index.js";

/** A vault on the file system, for tests and the benchmark. */
export class FsVault implements Vault {
  constructor(readonly root: string) {}
  private abs(path: string) {
    return join(this.root, path);
  }
  read(path: string) {
    return readFile(this.abs(path), "utf8");
  }
  async write(path: string, text: string) {
    await mkdir(dirname(this.abs(path)), { recursive: true });
    await writeFile(this.abs(path), text);
  }
  async exists(path: string) {
    return existsSync(this.abs(path));
  }
  async list(folder: string) {
    return (await this.files(folder)).filter((path) => path.endsWith(".md"));
  }
  async files(folder: string) {
    const dir = this.abs(folder);
    if (!existsSync(dir)) return [];
    const entries = await readdir(dir, { withFileTypes: true, recursive: true });
    return entries
      .filter((e) => e.isFile() && !relative(this.root, join(e.parentPath, e.name)).split("/").some((part) => part.startsWith(".")))
      .map((e) => relative(this.root, join(e.parentPath, e.name)))
      .sort();
  }
  async remove(path: string) {
    await rm(this.abs(path), { force: true });
  }
  async readBinary(path: string) {
    return new Uint8Array(await readFile(this.abs(path)));
  }
  async writeBinary(path: string, data: Uint8Array) {
    await mkdir(dirname(this.abs(path)), { recursive: true });
    await writeFile(this.abs(path), data);
  }
  parseProperties(yaml: string): Properties {
    return (YAML.parse(yaml) as Properties | null) ?? {};
  }
  stringifyProperties(properties: Properties) {
    return YAML.stringify(properties);
  }
}
