import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { real } from "../config.mjs";

/** A monorepo with a library `lib/`, a consumer `app/` that links it into node_modules, and one session. */
export function fixture({ git = false } = {}) {
  const root = real(mkdtempSync(path.join(os.tmpdir(), "library-loop-")));
  const file = (p, text = "") => {
    mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
    writeFileSync(path.join(root, p), text);
  };
  file("lib/package.json", JSON.stringify({ name: "lib" }));
  file("lib/src/a.ts", "export const a = 1;\n");
  file("lib/README.md", "# lib\n");
  file("lib/dist/index.d.ts", "export declare const a: 1;\n");
  file("lib/dist/deep/b.d.ts", "export {};\n");
  file("lib/dist/index.js", "export const a = 1;\n");
  file("app/src/b.ts", 'import { a } from "lib";\n');
  file("design.md", "# policy\n");
  mkdirSync(path.join(root, "app/node_modules"), { recursive: true });
  symlinkSync("../../lib", path.join(root, "app/node_modules/lib"));
  file(
    ".library-loop/config.json",
    JSON.stringify({
      library: "lib",
      consumer: "app",
      shared: ["design.md"],
      docs: ["README.md", "CHANGELOG.md", "dist/**/*.d.ts"],
      checks: { library: ["true"], consumer: ["echo broken && false"] },
    }),
  );
  if (git) {
    const run = (...a) => execFileSync("git", a, { cwd: root, stdio: "pipe" });
    run("init", "-q");
    run("-c", "user.name=t", "-c", "user.email=t@t", "add", ".");
    run("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "base");
  } else {
    const s = ".library-loop/sessions/s";
    for (const p of ["task.md", "requirements.md", "session.json", "notes/creator.md", "notes/consumer.md"]) file(`${s}/${p}`);
    for (const p of ["response.md", "feedback.md", "api/README.md"]) file(`${s}/round-01/${p}`);
  }
  return { root, at: (p) => path.join(root, p), file };
}
