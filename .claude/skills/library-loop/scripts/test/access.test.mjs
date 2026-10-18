import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { judge, segments } from "../access.mjs";
import { loadConfig } from "../config.mjs";
import { fixture } from "./fixture.mjs";

const { root, at } = fixture();
const config = loadConfig(root);
after(() => rmSync(root, { recursive: true, force: true }));

const S = ".library-loop/sessions/s";
const call = (side, tool_name, tool_input, cwd = root) => judge(config, side, { tool_name, tool_input, cwd });
const bash = (side, command, cwd = root) => call(side, "Bash", { command }, cwd);
const allowed = (reason) => assert.equal(reason, null);
const denied = (reason, pattern = /./) => {
  assert.ok(reason, "expected a block");
  assert.match(reason, pattern);
};

describe("consumer", () => {
  test("reads its own code, shared policy, its brief, and the round", () => {
    allowed(call("consumer", "Read", { file_path: at("app/src/b.ts") }));
    allowed(call("consumer", "Read", { file_path: at("design.md") }));
    allowed(call("consumer", "Read", { file_path: at(`${S}/task.md`) }));
    allowed(call("consumer", "Read", { file_path: at(`${S}/round-01/api/README.md`) }));
    allowed(call("consumer", "Read", { file_path: at(`${S}/round-01/response.md`) }));
  });

  test("never reads the library, also through the node_modules link", () => {
    denied(call("consumer", "Read", { file_path: at("lib/src/a.ts") }), /lib\/src\/a\.ts is in the library/);
    denied(call("consumer", "Read", { file_path: at("app/node_modules/lib/src/a.ts") }), /is in the library/);
    denied(call("consumer", "Read", { file_path: "../lib/README.md" }, at("app")), /is in the library/);
  });

  test("never reads the creator's brief, notes, or the overseer's files", () => {
    for (const p of [`${S}/requirements.md`, `${S}/notes/creator.md`, `${S}/session.json`, ".library-loop/config.json", ".library-loop/guard.log"]) {
      denied(call("consumer", "Read", { file_path: at(p) }), /belongs to the overseer or to the creator/);
    }
  });

  test("writes its code, feedback.md, and its notes only", () => {
    allowed(call("consumer", "Write", { file_path: at("app/src/c.ts") }));
    allowed(call("consumer", "Edit", { file_path: at(`${S}/round-01/feedback.md`) }));
    allowed(call("consumer", "Write", { file_path: at(`${S}/notes/consumer.md`) }));
    denied(call("consumer", "Write", { file_path: at(`${S}/round-01/response.md`) }), /writes only feedback\.md/);
    denied(call("consumer", "Edit", { file_path: at("design.md") }), /shared policy/);
    denied(call("consumer", "Write", { file_path: at("lib/src/a.ts") }), /is in the library/);
    denied(call("consumer", "Write", { file_path: at("notes.md") }), /writes only in app\//);
  });

  test("searches inside its folder or a round, not above them", () => {
    allowed(call("consumer", "Grep", { pattern: "x", path: at("app") }));
    allowed(call("consumer", "Glob", { pattern: "**/*.ts", path: at("app/src") }));
    allowed(call("consumer", "Grep", { pattern: "x", path: at(`${S}/round-01`) }));
    denied(call("consumer", "Grep", { pattern: "x" }), /Grep over \. also covers lib/);
    denied(call("consumer", "Glob", { pattern: "lib/**/*.ts" }), /is in the library/);
    denied(call("consumer", "Glob", { pattern: `${root}/lib/**` }, at("app")), /is in the library/);
    denied(call("consumer", "Grep", { pattern: "x", path: at(`${S}`) }), /belongs to the overseer/);
  });

  test("runs its build and tests, and searches its folder", () => {
    allowed(bash("consumer", `cd ${at("app")} && npm test 2>&1 | tail -20`));
    allowed(bash("consumer", "grep -rn createYami src", at("app")));
    allowed(bash("consumer", "find . -name '*.ts' -not -path './node_modules/*'", at("app")));
    allowed(bash("consumer", `cat ${at(`${S}/round-01/api/README.md`)}`));
    allowed(bash("consumer", 'node -e "import(\'lib\').then((m) => console.log(Object.keys(m)))"', at("app")));
  });

  test("blocks shell reads of the library", () => {
    denied(bash("consumer", "cat ../lib/src/a.ts", at("app")), /is in the library/);
    denied(bash("consumer", "sed -n 1,20p node_modules/lib/src/a.ts", at("app")), /is in the library/);
    denied(bash("consumer", "ls ../lib/src/*.ts", at("app")), /is in the library/);
    denied(bash("consumer", "cat lib/src/a.ts"), /is in the library/);
    denied(bash("consumer", "cat $(echo ../lib/src/a.ts)", at("app")), /is in the library/);
    denied(bash("consumer", `node -e "require('fs').readFileSync('../lib/src/a.ts')"`, at("app")), /is in the library/);
    denied(bash("consumer", "npm --prefix=../lib test", at("app")), /is in the library/);
    denied(bash("consumer", `cd ${at("lib")} && ls`), /is in the library/);
    denied(bash("consumer", "cat ~/x && cat $PWD/lib/src/a.ts"), /is in the library/);
  });

  test("blocks searches that reach the library", () => {
    denied(bash("consumer", "grep -rn foo"), /also covers lib/);
    denied(bash("consumer", "cd .. && grep -rn foo .", at("app")), /also covers lib/);
    denied(bash("consumer", "rg foo"), /also covers lib/);
    denied(bash("consumer", "ls -R"), /also covers lib/);
    denied(bash("consumer", "grep -Rn foo .", at("app")), /follows links, and app\/node_modules\/lib links into the library/);
    denied(bash("consumer", "rg -L foo", at("app")), /follows links/);
    denied(bash("consumer", "find -L . -name a.ts", at("app")), /follows links/);
  });

  test("runs read-only git on its own folder only", () => {
    allowed(bash("consumer", "git diff -- .", at("app")));
    allowed(bash("consumer", `git -C ${root} log --oneline -- app/src`));
    denied(bash("consumer", "git diff", at("app")), /without a pathspec also shows the library/);
    denied(bash("consumer", "git log -p -- lib"), /is in the library/);
    denied(bash("consumer", "git log -p -- .", root), /pathspec \. is outside app/);
    denied(bash("consumer", "git show HEAD:lib/src/a.ts -- .", at("app")), /is in the library/);
    denied(bash("consumer", "git commit -m x", at("app")), /does not run `git commit`/);
    denied(bash("consumer", "git stash", at("app")), /does not run `git stash`/);
  });
});

describe("creator", () => {
  test("works in the library, reads feedback and its brief, writes response.md", () => {
    allowed(call("creator", "Read", { file_path: at("lib/src/a.ts") }));
    allowed(call("creator", "Write", { file_path: at("lib/CHANGELOG.md") }));
    allowed(call("creator", "Read", { file_path: at(`${S}/round-01/feedback.md`) }));
    allowed(call("creator", "Read", { file_path: at(`${S}/requirements.md`) }));
    allowed(call("creator", "Write", { file_path: at(`${S}/round-01/response.md`) }));
    allowed(bash("creator", `cd ${at("lib")} && npm run build && npm test`));
    allowed(bash("creator", "git diff -- .", at("lib")));
  });

  test("never sees the consumer's code or task", () => {
    denied(call("creator", "Read", { file_path: at("app/src/b.ts") }), /is in the consumer app/);
    denied(call("creator", "Read", { file_path: at(`${S}/task.md`) }), /belongs to the overseer or to the consumer/);
    denied(call("creator", "Read", { file_path: at(`${S}/notes/consumer.md`) }), /belongs to the overseer/);
    denied(call("creator", "Write", { file_path: at(`${S}/round-01/feedback.md`) }), /writes only response\.md/);
    denied(bash("creator", "cd ../app && npm test", at("lib")), /is in the consumer app/);
    denied(bash("creator", "grep -rn foo .", root), /also covers app/);
  });
});

describe("a consumer in another repository", () => {
  test("runs read-only git there with no pathspec, and the guard follows the active session", () => {
    const host = fixture();
    const other = fixture();
    after(() => [host.root, other.root].forEach((p) => rmSync(p, { recursive: true, force: true })));
    mkdirSync(other.at("app/.git"), { recursive: true });
    mkdirSync(host.at(".git"), { recursive: true });
    const settings = JSON.parse(readFileSync(host.at(".library-loop/config.json"), "utf8"));
    settings.sessions = { duo: { consumer: path.relative(host.root, other.at("app")) } };
    writeFileSync(host.at(".library-loop/config.json"), JSON.stringify(settings));
    writeFileSync(host.at(".library-loop/active"), "duo\n");
    const duo = loadConfig(host.root);
    assert.equal(duo.dirs.consumer, other.at("app"));
    const judgeAs = (side, command, cwd) => judge(duo, side, { tool_name: "Bash", tool_input: { command }, cwd });
    allowed(judgeAs("consumer", "git log --oneline", other.at("app")));
    allowed(judgeAs("consumer", "git diff HEAD~1", other.at("app/src")));
    denied(judgeAs("consumer", "git commit -m x", other.at("app")), /does not run `git commit`/);
    denied(judgeAs("creator", "git log", host.at("lib")), /without a pathspec/);
    allowed(judgeAs("creator", "git log -- .", host.at("lib")));
    denied(judge(duo, "creator", { tool_name: "Read", tool_input: { file_path: other.at("app/src/b.ts") }, cwd: host.root }), /is in the consumer app/);
    allowed(judge(duo, "consumer", { tool_name: "Write", tool_input: { file_path: other.at("app/src/c.ts") }, cwd: host.root }));
    settings.sessions.duo.shared = ["design.md", path.relative(host.root, other.at("app/design.md"))];
    other.file("app/design.md", "# app policy\n");
    writeFileSync(host.at(".library-loop/config.json"), JSON.stringify(settings));
    const shared = loadConfig(host.root);
    allowed(judge(shared, "creator", { tool_name: "Read", tool_input: { file_path: other.at("app/design.md") }, cwd: host.root }));
    denied(judge(shared, "creator", { tool_name: "Write", tool_input: { file_path: other.at("app/design.md") }, cwd: host.root }), /is shared policy/);
    denied(judge(shared, "consumer", { tool_name: "Edit", tool_input: { file_path: other.at("app/design.md") }, cwd: host.root }), /is shared policy/);
    denied(judge(shared, "creator", { tool_name: "Read", tool_input: { file_path: other.at("app/src/b.ts") }, cwd: host.root }), /in the consumer app/);
    denied(judge(duo, "consumer", { tool_name: "Write", tool_input: { file_path: host.at("app/src/c.ts") }, cwd: host.root }), /writes only in/);
  });
});

test("segments split commands and keep quoted words whole", () => {
  assert.deepEqual(
    segments(`cd "a b" && grep -rn 'x y' src | head; echo $(cat f)`).map((s) => s.words),
    [["cd", "a b"], ["grep", "-rn", "x y", "src"], ["head"], ["echo"], ["cat", "f"]],
  );
});

describe("guard.mjs", () => {
  const guard = path.join(path.dirname(fileURLToPath(import.meta.url)), "../guard.mjs");
  const run = (side, input, env = {}) =>
    spawnSync(process.execPath, [guard, side], { input: JSON.stringify(input), encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: root, ...env } });

  test("allows a call with no output", () => {
    const result = run("consumer", { tool_name: "Read", tool_input: { file_path: at("app/src/b.ts") }, cwd: root });
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
  });

  test("blocks with exit 2, tells the agent why, and logs the block", () => {
    const result = run("consumer", { tool_name: "Read", tool_input: { file_path: at("lib/src/a.ts") }, cwd: root });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /^library-loop: lib\/src\/a\.ts is in the library/);
    const entry = JSON.parse(readFileSync(at(".library-loop/guard.log"), "utf8").trim().split("\n").at(-1));
    assert.equal(entry.side, "consumer");
    assert.equal(entry.input.file_path, at("lib/src/a.ts"));
  });

  test("fails closed without a side or a config", () => {
    assert.equal(run("both", { tool_name: "Read", tool_input: {} }).status, 2);
    const empty = fixture();
    rmSync(empty.at(".library-loop"), { recursive: true });
    const result = run("consumer", { tool_name: "Read", tool_input: { file_path: empty.at("app/src/b.ts") } }, { CLAUDE_PROJECT_DIR: empty.root });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /no \.library-loop\/config\.json/);
    assert.ok(!existsSync(empty.at(".library-loop/guard.log")));
    rmSync(empty.root, { recursive: true, force: true });
  });
});
