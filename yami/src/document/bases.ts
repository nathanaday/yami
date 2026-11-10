import type { Vault } from "./vault.js";

const SESSION_COLUMNS = ["file.name", "state", "unmet", "met", "iteration", "harness", "created"];
const NEWEST_FIRST = [{ property: "created", direction: "DESC" }];

/** One table of a base, as Obsidian reads it. */
export interface LedgerView {
  type: "table";
  name: string;
  filters?: { and?: string[]; or?: string[] };
  order: string[];
  sort?: { property: string; direction: "ASC" | "DESC" }[];
}

/** The module ledger: the sessions of one module, and the views the module adds, for example its versions. */
export function moduleLedger(vault: Vault, moduleId: string, views: LedgerView[] = []): string {
  return vault.stringifyProperties({
    filters: { and: [`module == "${moduleId}"`, 'type != "module"', 'type != "policy"', 'type != "promise"'] },
    properties: { "file.name": { displayName: "Session" } },
    views: [
      {
        type: "table",
        name: "Open",
        filters: { and: ['type == "session"', 'state != "done"'] },
        order: SESSION_COLUMNS,
        sort: NEWEST_FIRST,
      },
      { type: "table", name: "All", filters: { and: ['type == "session"'] }, order: SESSION_COLUMNS, sort: NEWEST_FIRST },
      ...views,
    ],
  });
}
