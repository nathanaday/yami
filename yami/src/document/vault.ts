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
  parseProperties(yaml: string): Properties;
  stringifyProperties(properties: Properties): string;
}
