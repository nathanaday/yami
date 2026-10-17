import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { fixture } from "./fixture.mjs";

const { root, at, file } = fixture({ git: true });
after(() => rmSync(root, { recursive: true, force: true }));
const loop = path.join(path.dirname(fileURLToPath(import.meta.url)), "../loop.mjs");
const run = (...args) => spawnSync(process.execPath, [loop, ...args], { encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: root } });
const commit = (message) => {
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", message], { cwd: root });
};

test("init refuses a dirty tree, then makes the session", () => {
  file("app/src/dirty.ts", "x");
  const dirty = run("init", "sync");
  assert.equal(dirty.status, 1);
  assert.match(dirty.stderr, /commit or stash these changes first/);
  commit("dirty");

  assert.equal(run("init", "Bad Slug").status, 1);
  const result = run("init", "sync", "--first", "consumer", "--rounds", "4", "--terms", "panel,navigator");
  assert.equal(result.status, 0, result.stderr);
  const session = JSON.parse(readFileSync(at(".library-loop/sessions/sync/session.json"), "utf8"));
  assert.deepEqual([session.first, session.max_rounds, session.consumer_terms], ["consumer", 4, ["panel", "navigator"]]);
  assert.equal(readFileSync(at(".library-loop/.gitignore"), "utf8"), "guard.log\nsessions/*/round-*/api/\n");
  assert.equal(run("init", "sync").status, 1);
});

test("round numbers from 0 when the consumer goes first, and snapshot copies the docs", () => {
  assert.equal(run("round", "sync").stdout.trim(), ".library-loop/sessions/sync/round-00");
  const snapshot = run("snapshot", "sync");
  assert.equal(snapshot.status, 0, snapshot.stderr);
  assert.match(snapshot.stdout, /3 files; nothing matched CHANGELOG\.md/);
  const api = at(".library-loop/sessions/sync/round-00/api");
  assert.ok(existsSync(path.join(api, "README.md")));
  assert.ok(existsSync(path.join(api, "dist/deep/b.d.ts")));
  assert.ok(!existsSync(path.join(api, "dist/index.js")));
  assert.ok(!existsSync(path.join(api, "src")));
  assert.equal(JSON.parse(run("status", "sync").stdout).next, "consumer");
});

test("audit finds consumer terms in the library, internal imports, workarounds, and blocks", () => {
  commit("round 0");
  file("lib/src/panel.ts", "export function panelRows() {}\n");
  file("app/src/c.ts", 'import { a } from "lib/src/a";\nimport { b } from "../../lib/src/a";\n// library-loop: F0.1 until the library sorts\n');
  writeFileSync(at(".library-loop/guard.log"), JSON.stringify({ time: new Date().toISOString(), side: "consumer", tool: "Read", input: {}, reason: "r" }) + "\n");
  const audit = JSON.parse(run("audit", "sync").stdout);
  assert.deepEqual(audit.consumer_terms_in_library, [{ term: "panel", lines: ["export function panelRows() {}"] }]);
  assert.deepEqual(audit.internal_imports, ["app/src/c.ts: lib/src/a", "app/src/c.ts: ../../lib/src/a"]);
  assert.deepEqual(audit.workarounds, ["app/src/c.ts:3: // library-loop: F0.1 until the library sorts"]);
  assert.deepEqual(audit.untracked, ["app/src/c.ts", "lib/src/panel.ts"]);
  assert.equal(audit.blocked.length, 1);
});

test("check runs each side's commands and shows a failure", () => {
  const library = run("check", "library");
  assert.equal(library.status, 0);
  assert.match(library.stdout, /^pass {2}lib: true/);
  const consumer = run("check", "consumer");
  assert.equal(consumer.status, 1);
  assert.match(consumer.stdout, /FAIL {2}app: echo broken && false\nbroken/);
});
