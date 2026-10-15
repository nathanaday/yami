/**
 * The retrieval benchmark: every algorithm against a real vault.
 *
 *   YAMI_BENCH_VAULT=~/Vaults/Notes npm run bench
 *   YAMI_BENCH_VAULT=… YAMI_BENCH_GOLD=bench/gold.json npm run bench
 *   YAMI_BENCH_VAULT=… VOYAGE_API_KEY=… npm run bench       # the hybrid algorithm with embeddings
 *
 * The gold file is a list of `{ "query": "…", "expected": ["path or [[name]]", …] }`. Without one,
 * the benchmark samples notes that have a description and asks for each by its description:
 * the note itself is the one expected hit.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { algorithms, mulberry32, VoyageEmbedder, Wiki } from "../src/wiki/index.js";
import { FsVault } from "../test/fixtures/fs-vault.js";

interface Gold {
  query: string;
  expected: string[];
}

const SAMPLE = 50;
const K = [5, 10];

const vaultPath = process.env.YAMI_BENCH_VAULT;

describe.skipIf(!vaultPath)("retrieval benchmark", () => {
  it("ranks the gold queries with every algorithm", { timeout: 600_000 }, async () => {
    const vault = new FsVault(resolve(vaultPath!.replace(/^~/, homedir())));
    const apiKey = process.env.VOYAGE_API_KEY;
    const wiki = new Wiki(vault, {
      exclude: (process.env.YAMI_BENCH_EXCLUDE ?? "conversations").split(",").filter(Boolean),
      embedder: apiKey ? new VoyageEmbedder({ apiKey }) : undefined,
    });
    const started = performance.now();
    await wiki.refresh();
    const refreshMs = performance.now() - started;
    const gold = process.env.YAMI_BENCH_GOLD ? (JSON.parse(readFileSync(process.env.YAMI_BENCH_GOLD, "utf8")) as Gold[]) : sample(wiki);
    expect(gold.length).toBeGreaterThan(0);

    const rows: string[] = [];
    for (const name of Object.keys(algorithms)) {
      if (name === "hybrid" && wiki.embedder) await wiki.vectors();
      const recall = K.map(() => 0);
      let mrr = 0;
      let misses = 0;
      const begin = performance.now();
      for (const item of gold) {
        const expected = new Set(item.expected.map((target) => wiki.resolve(target) ?? target));
        const hits = await wiki.search(item.query, { algorithm: name, limit: Math.max(...K) });
        const rank = hits.findIndex((hit) => expected.has(hit.path));
        if (rank === -1) misses += 1;
        else mrr += 1 / (rank + 1);
        K.forEach((k, i) => {
          const found = hits.slice(0, k).filter((hit) => expected.has(hit.path)).length;
          recall[i]! += found / expected.size;
        });
      }
      const ms = (performance.now() - begin) / gold.length;
      rows.push(
        `| ${name} | ${K.map((_, i) => (recall[i]! / gold.length).toFixed(3)).join(" | ")} | ${(mrr / gold.length).toFixed(3)} | ${misses} | ${ms.toFixed(1)} |`,
      );
    }
    const report = [
      `Vault: ${vaultPath}, ${wiki.notes.length} notes, ${wiki.graph.size} links, refresh ${refreshMs.toFixed(0)} ms, ${gold.length} queries${process.env.YAMI_BENCH_GOLD ? "" : " (self-retrieval by description)"}${wiki.embedder ? ", with embeddings" : ", no embedder"}.`,
      "",
      `| algorithm | ${K.map((k) => `recall@${k}`).join(" | ")} | MRR | misses | ms/query |`,
      `| --- | ${K.map(() => "---").join(" | ")} | --- | --- | --- |`,
      ...rows,
    ].join("\n");
    console.log(`\n${report}\n`);
  });
});

/** Up to `SAMPLE` notes with a description, each asked for by that description. */
function sample(wiki: Wiki): Gold[] {
  const random = mulberry32(7);
  const candidates = wiki.notes.filter((note) => note.description.split(/\s+/).length >= 4);
  const picked: Gold[] = [];
  const taken = new Set<number>();
  while (picked.length < Math.min(SAMPLE, candidates.length)) {
    const i = Math.floor(random() * candidates.length);
    if (taken.has(i)) continue;
    taken.add(i);
    picked.push({ query: candidates[i]!.description, expected: [candidates[i]!.path] });
  }
  return picked;
}
