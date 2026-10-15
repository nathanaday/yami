import type { Wiki } from "../wiki.js";
import { bm25 } from "./bm25.js";
import { hop2 } from "./hop2.js";
import { hybrid } from "./hybrid.js";
import { louvain } from "./louvain.js";
import { ppr } from "./ppr.js";

export interface Query {
  text?: string;
  /** Notes to start from, as paths or link targets. For "related notes", give seeds and no text. */
  seeds?: string[];
  /** Keep only notes of these types. */
  types?: string[];
  /** Keep only notes that hold every one of these tags, or a tag below it. */
  tags?: string[];
  /** Keep only notes in this folder. */
  folder?: string;
  /** At most this many hits. Default 20. */
  limit?: number;
  /** A name in `algorithms`. Default: the wiki's default. */
  algorithm?: string;
  /** Knobs of the algorithm, for example `walks` for Monte Carlo PPR. */
  params?: Record<string, number>;
}

/** A ranked note. Scores are in `[0, 1]`, with the best at 1. */
export interface Scored {
  path: string;
  score: number;
  /** One line on why the note ranks: "title match", "linked from Codex harness". */
  why: string;
  snippet?: string;
}

export interface Hit extends Scored {
  snippet: string;
}

/** Ranks every note of the wiki for a query. The wiki filters and cuts the result. */
export type Algorithm = (wiki: Wiki, query: Query) => Promise<Scored[]> | Scored[];

/** The algorithms a query can name. A new ranking is an entry here. */
export const algorithms: Record<string, Algorithm> = { bm25, ppr, hop2, louvain, hybrid };
