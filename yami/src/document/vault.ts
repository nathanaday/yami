export type Properties = Record<string, unknown>;

/**
 * The host's access to the vault. Paths are relative to the vault root and
 * use `/`. The host also parses and writes properties, so that Obsidian's
 * own YAML functions handle them in the plugin.
 */
export interface Vault {
  /** Absolute path of the vault root. Harness processes run here. */
  readonly root: string;
  read(path: string): Promise<string>;
  /** Creates missing folders. */
  write(path: string, text: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** Markdown files in a folder and its subfolders. `""` is the whole vault. */
  list(folder: string): Promise<string[]>;
  /** Every file in a folder and its subfolders, whatever its type. `""` is the whole vault. */
  files(folder: string): Promise<string[]>;
  /** Removes a file. In Obsidian, it goes to the trash the user chose. */
  remove(path: string): Promise<void>;
  readBinary(path: string): Promise<Uint8Array>;
  /** Creates missing folders. */
  writeBinary(path: string, data: Uint8Array): Promise<void>;
  parseProperties(yaml: string): Properties;
  stringifyProperties(properties: Properties): string;
}
