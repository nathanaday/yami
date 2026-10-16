// A markdown file imported as its text, as `yami/esbuild` and `markdownText` in `yami/testing` load it.
// Add "yami/markdown" to `types` in the plugin's tsconfig.json.
declare module "*.md" {
  const text: string;
  export default text;
}
