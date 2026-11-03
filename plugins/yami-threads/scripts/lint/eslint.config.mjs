// Obsidian's review rules, as the community directory scan reads them.
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  ...obsidianmd.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: { parserOptions: { project: "tsconfig.json", tsconfigRootDir: `${import.meta.dirname}/../..` } },
  },
]);
