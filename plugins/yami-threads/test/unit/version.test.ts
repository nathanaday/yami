import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// The release workflow publishes manifest.json's version; every other file must agree.
it("manifest.json, package.json, package-lock.json, and versions.json name one version", () => {
  const read = (file: string) => JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
  const manifest = read("manifest.json");
  const version = manifest.version as string;
  expect(version, "a release tag has no v in front").toMatch(/^\d+\.\d+\.\d+$/);
  expect(read("package.json").version).toBe(version);
  const lock = read("package-lock.json");
  expect(lock.version).toBe(version);
  expect(lock.packages[""].version).toBe(version);
  expect(read("versions.json")[version], "versions.json maps the version to its minAppVersion").toBe(manifest.minAppVersion);
});
