import { describe, expect, it } from "vitest";
import { OLLAMA_BATCH, OllamaEmbedder, Wiki } from "../../src/wiki/index.js";
import { FsVault } from "../../src/testing/index.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const respond = (status: number, body: unknown): Response => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("OllamaEmbedder", () => {
  it("posts batches to /api/embed with the model's prefixes, and reads the vectors back in order", async () => {
    const requests: { url: string; body: { model: string; input: string[] } }[] = [];
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model: string; input: string[] };
      requests.push({ url: String(url), body });
      return respond(200, { embeddings: body.input.map((text, i) => [text.length, i]) });
    }) as typeof fetch;
    const embedder = new OllamaEmbedder({ fetch: fetcher, host: "http://localhost:11434/" });
    expect(embedder.id).toBe("ollama:nomic-embed-text");
    const texts = Array.from({ length: OLLAMA_BATCH + 2 }, (_, i) => `text ${i}`);
    const vectors = await embedder.embed(texts, "document");
    expect(vectors).toHaveLength(OLLAMA_BATCH + 2);
    expect(requests.map((r) => r.body.input.length)).toEqual([OLLAMA_BATCH, 2]);
    expect(requests[0]!.url).toBe("http://localhost:11434/api/embed");
    expect(requests[0]!.body).toMatchObject({ model: "nomic-embed-text" });
    expect(requests[0]!.body.input[0]).toBe("search_document: text 0");
    expect(vectors[0]).toEqual(Float32Array.from(["search_document: text 0".length, 0]));
    await embedder.embed(["a query"], "query");
    expect(requests.at(-1)!.body.input).toEqual(["search_query: a query"]);

    const other = new OllamaEmbedder({ fetch: fetcher, model: "embeddinggemma" });
    expect(other.id).toBe("ollama:embeddinggemma");
    await other.embed(["plain"], "document");
    expect(requests.at(-1)!.body.input).toEqual(["plain"]);
  });

  it("says what to do when Ollama is down, has no such model, or answers badly", async () => {
    const down = new OllamaEmbedder({ fetch: (async () => { throw new TypeError("fetch failed"); }) as typeof fetch });
    await expect(down.embed(["x"], "query")).rejects.toThrow("Ollama is not answering at http://localhost:11434: fetch failed. Start Ollama, or turn embeddings off.");
    const missing = new OllamaEmbedder({ fetch: (async () => respond(404, { error: "model not found" })) as typeof fetch, model: "nope" });
    await expect(missing.embed(["x"], "query")).rejects.toThrow("Ollama has no model named nope. Run `ollama pull nope`, or name a model it has.");
    const broken = new OllamaEmbedder({ fetch: (async () => respond(500, "boom")) as typeof fetch });
    await expect(broken.embed(["x"], "query")).rejects.toThrow("Ollama returned 500: boom");
    const empty = new OllamaEmbedder({ fetch: (async () => respond(200, { error: "odd" })) as typeof fetch });
    await expect(empty.embed(["x"], "query")).rejects.toThrow("Ollama returned no embeddings: odd.");
  });

  it("can be set on a running wiki, and the cache follows the embedder's id", async () => {
    const root = await mkdtemp(join(tmpdir(), "yami-ollama-"));
    try {
      const vault = new FsVault(root);
      await vault.write("wiki/topics/Bread.md", "---\ntype: topic\ndescription: Bread.\n---\nFlour and water.\n");
      const wiki = new Wiki(vault);
      expect(wiki.embedder).toBeUndefined();
      expect(await wiki.vectors()).toBeUndefined();
      const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { input: string[] };
        return respond(200, { embeddings: body.input.map(() => [1, 0]) });
      }) as typeof fetch;
      wiki.setEmbedder(new OllamaEmbedder({ fetch: fetcher }));
      await wiki.refresh();
      expect((await wiki.vectors())!.size).toBe(1);
      expect(JSON.parse(await vault.read("internal/wiki/cache/embeddings.json")).embedder).toBe("ollama:nomic-embed-text");
      wiki.setEmbedder(undefined);
      expect(wiki.embedder).toBeUndefined();
      expect(await wiki.vectors()).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("hybrid with an embedder that fails", () => {
  it("ranks the lexical half alone, says so, and keeps the reason on the wiki", async () => {
    const root = await mkdtemp(join(tmpdir(), "yami-ollama-"));
    try {
      const vault = new FsVault(root);
      await vault.write("wiki/topics/Bread.md", "---\ntype: topic\ndescription: Bread.\n---\nFlour and water make bread.\n");
      const wiki = new Wiki(vault, { embedder: new OllamaEmbedder({ fetch: (async () => { throw new TypeError("fetch failed"); }) as typeof fetch }) });
      const hits = await wiki.search("bread", { algorithm: "hybrid" });
      expect(hits[0]!.why).toContain("lexical (embedder failed)");
      expect(wiki.embedderProblem).toContain("Ollama is not answering");
      wiki.setEmbedder({ id: "fake", embed: async (texts) => texts.map(() => Float32Array.from([1])) });
      await wiki.search("bread", { algorithm: "hybrid" });
      expect(wiki.embedderProblem).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
