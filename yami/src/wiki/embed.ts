import type { Vault } from "../document/vault.js";

/** Turns texts into vectors. One call embeds a batch. */
export interface Embedder {
  /** A name for the cache, so a change of model starts a new cache. */
  readonly id: string;
  embed(texts: string[], kind: "document" | "query"): Promise<Float32Array[]>;
}

export interface VoyageOptions {
  apiKey: string;
  /** Default `voyage-3.5`. */
  model?: string;
  fetch?: typeof fetch;
}

/** Voyage AI over plain `fetch`. Anthropic has no embeddings endpoint and recommends Voyage. */
export class VoyageEmbedder implements Embedder {
  readonly id: string;
  private readonly model: string;
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: VoyageOptions) {
    this.model = options.model ?? "voyage-3.5";
    this.id = `voyage:${this.model}`;
    this.fetcher = options.fetch ?? fetch;
  }

  async embed(texts: string[], kind: "document" | "query"): Promise<Float32Array[]> {
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += 128) {
      const response = await this.fetcher("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.options.apiKey}` },
        body: JSON.stringify({ input: texts.slice(i, i + 128), model: this.model, input_type: kind }),
      });
      if (!response.ok) throw new Error(`Voyage returned ${response.status}: ${(await response.text()).slice(0, 200)}`);
      const json = (await response.json()) as { data: { index: number; embedding: number[] }[] };
      for (const item of json.data.sort((a, b) => a.index - b.index)) out.push(Float32Array.from(item.embedding));
    }
    return out;
  }
}

export interface OllamaOptions {
  /** Where Ollama listens. Default `http://localhost:11434`. */
  host?: string;
  /** Default `nomic-embed-text`. */
  model?: string;
  /**
   * Texts prepended to each document and each query, for a model trained with task prefixes. Default: the
   * prefixes of `nomic-embed-text` for a model whose name starts with `nomic-embed`, none for another.
   */
  prefixes?: { document: string; query: string };
  fetch?: typeof fetch;
}

/** How many texts one request to Ollama embeds. */
export const OLLAMA_BATCH = 32;

/**
 * Ollama on the person's own computer, over `fetch` to its `/api/embed`: an embedder with no key and no
 * network, for a model the person pulled (`ollama pull nomic-embed-text`). An error names what to do: start
 * Ollama, or pull the model.
 */
export class OllamaEmbedder implements Embedder {
  readonly id: string;
  readonly host: string;
  readonly model: string;
  private readonly prefixes: { document: string; query: string };
  private readonly fetcher: typeof fetch;

  constructor(options: OllamaOptions = {}) {
    this.host = (options.host ?? "http://localhost:11434").replace(/\/+$/, "");
    this.model = options.model ?? "nomic-embed-text";
    this.id = `ollama:${this.model}`;
    this.prefixes = options.prefixes ?? (this.model.startsWith("nomic-embed") ? { document: "search_document: ", query: "search_query: " } : { document: "", query: "" });
    this.fetcher = options.fetch ?? fetch;
  }

  async embed(texts: string[], kind: "document" | "query"): Promise<Float32Array[]> {
    const out: Float32Array[] = [];
    const prefix = this.prefixes[kind];
    for (let i = 0; i < texts.length; i += OLLAMA_BATCH) {
      let response: Response;
      try {
        response = await this.fetcher(`${this.host}/api/embed`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: this.model, input: texts.slice(i, i + OLLAMA_BATCH).map((text) => prefix + text) }),
        });
      } catch (error) {
        throw new Error(`Ollama is not answering at ${this.host}: ${error instanceof Error ? error.message : String(error)}. Start Ollama, or turn embeddings off.`);
      }
      if (response.status === 404) throw new Error(`Ollama has no model named ${this.model}. Run \`ollama pull ${this.model}\`, or name a model it has.`);
      if (!response.ok) throw new Error(`Ollama returned ${response.status}: ${(await response.text()).slice(0, 200)}`);
      const json = (await response.json()) as { embeddings?: number[][]; error?: string };
      if (!json.embeddings) throw new Error(`Ollama returned no embeddings${json.error ? `: ${json.error}` : ""}.`);
      for (const vector of json.embeddings) out.push(Float32Array.from(vector));
    }
    return out;
  }
}

/**
 * The embeddings of the chunks, keyed by chunk hash, kept as one JSON file in the vault.
 * Only chunks without an entry are embedded, so a refresh costs only what changed.
 */
export class EmbeddingCache {
  private vectors = new Map<string, Float32Array>();
  private loaded = false;

  constructor(
    private readonly vault: Vault,
    private readonly embedder: Embedder,
    private readonly path: string,
  ) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (!(await this.vault.exists(this.path))) return;
    const data = JSON.parse(await this.vault.read(this.path)) as { embedder: string; vectors: Record<string, number[]> };
    if (data.embedder !== this.embedder.id) return;
    for (const [key, vector] of Object.entries(data.vectors)) this.vectors.set(key, Float32Array.from(vector));
  }

  /** The vectors of these hashes, embedding the missing ones with `texts`. Writes the cache when it grew. */
  async vectorsOf(hashes: string[], texts: string[]): Promise<Map<string, Float32Array>> {
    await this.load();
    const missing = hashes.map((h, i) => [h, texts[i]!] as const).filter(([h]) => !this.vectors.has(h));
    const unique = [...new Map(missing).entries()];
    if (unique.length) {
      const vectors = await this.embedder.embed(
        unique.map(([, text]) => text),
        "document",
      );
      unique.forEach(([h], i) => this.vectors.set(h, vectors[i]!));
      await this.save(new Set(hashes));
    }
    return this.vectors;
  }

  async query(text: string): Promise<Float32Array> {
    return (await this.embedder.embed([text], "query"))[0]!;
  }

  /** Writes the vectors that are still in use. Chunks that are gone leave the cache here. */
  private async save(live: Set<string>): Promise<void> {
    const vectors: Record<string, number[]> = {};
    for (const [key, vector] of this.vectors) if (live.has(key)) vectors[key] = Array.from(vector, (v) => Math.round(v * 1e6) / 1e6);
    await this.vault.write(this.path, JSON.stringify({ embedder: this.embedder.id, vectors }));
  }
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
