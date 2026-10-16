import { defineTool, z } from "../../agent/index.js";
import { basename, link, LINK, linkTarget, readDocument, replaceSection, updateDocument, writeDocument } from "../../document/document.js";
import { timestamp } from "../../document/schema.js";
import type { Vault } from "../../document/vault.js";
import { createSession, freeSessionName, readSession, skill, type Module } from "../../module/module.js";
import { bodyHash, InvalidPlan, validatePlan, type Write } from "../../wiki/change.js";
import { inKnowledge, SOURCES, TOPICS } from "../../wiki/folders.js";
import type { Wiki } from "../../wiki/wiki.js";

/** The most documents one checkout holds. */
export const MAX_DOCUMENTS = 60;
const COPY = " (checkout)";

/** What a checkout takes: the tool's input, and the SDK's. */
export const orderShape = {
  request: z.string().describe("The user's request, in their words."),
  name: z.string().describe("A short name. The reading list is librarian/<date> <name>.md, and its copies are in the folder of that name."),
  documents: z
    .array(z.object({ path: z.string().describe("The note, as a path or a [[link]] name."), why: z.string().describe("One line: what it gives the reader.") }))
    .min(1)
    .max(MAX_DOCUMENTS),
  notes: z.string().optional().describe("What was left out, and why."),
};
export type Order = z.infer<z.ZodObject<typeof orderShape>>;

export interface Checkout {
  /** The reading list: the session document. Its copies are in the folder of the same name. */
  session: string;
  copies: string[];
}

/**
 * Makes a checkout: the session document `librarian/<date> <name>.md` holds the reading list, and
 * the folder of that name a copy of each document. A copy keeps the original's body, with `copy_of` and
 * `sha256`, the hash of that body, so the return can tell the user's edits from the original's.
 */
export async function checkout(vault: Vault, wiki: Wiki, order: Order): Promise<Checkout> {
  await wiki.refresh();
  if (!order.request?.trim()) throw new Error("The request is empty: give the user's words.");
  if (!order.documents?.length) throw new Error("A checkout needs one document or more.");
  if (order.documents.length > MAX_DOCUMENTS) throw new Error(`A checkout holds at most ${MAX_DOCUMENTS} documents; ask the user to narrow the request.`);
  const originals: string[] = [];
  for (const { path, why } of order.documents) {
    const found = wiki.resolve(path);
    if (!found || !inKnowledge(found)) throw new Error(`${path} is not a note of ${TOPICS}/ or ${SOURCES}/; only knowledge is checked out.`);
    if (originals.includes(found)) throw new Error(`The documents hold ${found} twice.`);
    if (!why?.trim() || why.includes("\n")) throw new Error(`Give ${found} a why of one line.`);
    originals.push(found);
  }
  // The date keeps the reading list's name apart from a topic of the same subject, so a link by name still finds the topic.
  const name = await freeSessionName(vault, librarian, `${timestamp().slice(0, 10)} ${order.name}`);
  const session = await createSession(vault, librarian, name, { request: order.request.trim(), status: "out" });
  const folder = session.slice(0, -3);
  const copies: string[] = [];
  for (const original of originals) {
    const doc = await readDocument(vault, original);
    let copy = `${folder}/${basename(original)}${COPY}.md`;
    for (let n = 2; copies.includes(copy); n++) copy = `${folder}/${basename(original)}${COPY} ${n}.md`;
    await writeDocument(vault, { path: copy, properties: { copy_of: link(original), sha256: await bodyHash(doc.body), checkout: link(session) }, body: doc.body });
    copies.push(copy);
  }
  const list = order.documents.map(({ why }, i) => `${i + 1}. ${link(copies[i]!)} · ${why.trim()}`).join("\n");
  await updateDocument(vault, session, (doc) => {
    doc.properties.state = "done";
    doc.body = replaceSection(doc.body, "Reading list", list);
    if (order.notes?.trim()) doc.body = replaceSection(doc.body, "Notes", order.notes.trim());
  });
  return { session, copies };
}

export interface Returned {
  /** The change that brought the edits into the wiki, when a copy held edits. */
  change?: string;
  /** The originals the change modified. */
  returned: string[];
  /** The copies that stay, each with why: the original changed since the checkout, is gone, or refused the edit. */
  skipped: { copy: string; reason: string }[];
  /** What the return did, in a few lines: the text of the reading list's Return section. */
  summary: string;
}

/**
 * Returns a checkout, the user's act. A copy whose body changed returns its edits to the original as
 * one change, unless the original changed too since the checkout; then the copy stays. A link to
 * another copy points back at its original. Every copy that returned or had no edit is removed.
 */
export async function returnCheckout(vault: Vault, wiki: Wiki, session: string): Promise<Returned> {
  const doc = await readSession(vault, librarian, session);
  if (doc.properties.status !== "out") throw new Error(`${basename(session)} is not out; it was returned already.`);
  await wiki.refresh();
  const folder = session.slice(0, -3);
  const writes: Write[] = [];
  const done: string[] = [];
  const skipped: Returned["skipped"] = [];
  for (const copy of await vault.list(folder)) {
    const { properties, body } = await readDocument(vault, copy);
    const original = wiki.resolve(String(properties.copy_of ?? ""));
    if (typeof properties.sha256 !== "string") continue;
    if ((await bodyHash(body)) === properties.sha256) {
      done.push(copy);
    } else if (!original) {
      skipped.push({ copy, reason: "its original is gone" });
    } else if ((await bodyHash(wiki.note(original)!.body)) !== properties.sha256) {
      skipped.push({ copy, reason: "its original changed since the checkout" });
    } else {
      const write: Write = { op: "modify", path: original, body: await towardOriginals(vault, wiki, body), base: properties.sha256, why: "the user's edits of the checkout copy" };
      // One edit the wiki refuses must not hold back the others: it stays in its copy, with the reason.
      try {
        await validatePlan(wiki, { title: "Return", writes: [write] });
        writes.push(write);
        done.push(copy);
      } catch (error) {
        if (!(error instanceof InvalidPlan)) throw error;
        skipped.push({ copy, reason: `the wiki refused the edit: ${error.problems[0]!.replace(/^write 1 \([^)]*\): /, "")}` });
      }
    }
  }
  const change = writes.length ? (await wiki.change({ title: `Return ${basename(session)}`, session, writes })).path : undefined;
  for (const copy of done) await vault.remove(copy);
  const summary = [
    change ? `- Returned the edits of ${writes.length} cop${writes.length === 1 ? "y" : "ies"} in ${link(change)}.` : "- No copy held an edit.",
    ...skipped.map(({ copy, reason }) => `- Kept ${link(copy)}: ${reason}. Its edits stay in the copy.`),
  ].join("\n");
  await updateDocument(vault, session, (d) => {
    d.properties.status = "returned";
    d.properties.returned = timestamp();
    d.body = replaceSection(d.body, "Return", summary);
  });
  return { ...(change && { change }), returned: writes.map((write) => write.path), skipped, summary };
}

/**
 * Points each link to a checkout copy at the copy's original, so no returned note links a copy that the
 * return removes. A link with no alias gets the original's name as its alias, so it reads as before.
 */
async function towardOriginals(vault: Vault, wiki: Wiki, body: string): Promise<string> {
  const originals = new Map<string, string>();
  for (const [, target] of body.matchAll(LINK)) {
    const path = wiki.locate(target!);
    const original = path && (await readDocument(vault, path)).properties.copy_of;
    if (typeof original === "string") originals.set(target!, linkTarget(original));
  }
  return body.replace(LINK, (whole, target: string, rest: string) => {
    const original = originals.get(target);
    if (!original) return whole;
    return `${whole.startsWith("!") ? "!" : ""}[[${original}${rest || `|${basename(original)}`}]]`;
  });
}

const checkoutSkill = skill(
  "checkout",
  "Check out the wiki's material on a subject: choose the documents that serve the request, put them in reading order with a reason each, and make the checkout.",
  `# Checkout

A checkout is a reading list and a copy of each document on it, for the user to read and mark up. Code ranks the candidates and writes the copies. You choose the documents, order them, and give each one a reason.

1. **The request.** Take it in the user's words. Turn the words that name tags into \`tags\` for the search.
2. **Candidates.** Call \`wiki_search\` with the request as \`text\`, \`algorithm: "hop2"\`, \`types: ["topic"]\`, and \`limit: 40\`. Add \`"source"\` to the types when the user asks for the sources themselves. The \`hop2\` ranking adds the documents linked to or from the best hits, up to two links away; \`why\` says which hit led to each.
3. **Choose.** Read each candidate's snippet, and the document with Read when the snippet does not settle it. Keep a document that serves the request; drop one that does not. Judge a linked document on its own content, not on the hit that led to it. When you drop a document, also drop the candidates that only it led to, unless they serve the request on their own. A branch stops where its documents stop serving.
4. **Size.** Aim for a sitting or a week of reading: at most about 30 documents. When more serve, the request is too broad: ask the user once to narrow it, with two or three narrower requests from the tags or subjects of the candidates.
5. **Order.** Foundations first: a definition, an overview, or a concept that the others assume comes before the documents that build on it. Give each document a \`why\`: one line on what it gives the reader for this request.
6. **Make it.** Call \`librarian_checkout\` with \`request\` (the user's words), \`name\` (a short name, such as "Reinforcement learning"), \`documents\` in reading order with each \`path\` and \`why\`, and \`notes\`: the near subjects you left out, the branches you stopped, and the gaps of the wiki.

End with one line: the reading list as a link, and the count of documents. Never edit a copy: the copies are the user's. The user returns the checkout in Obsidian, and the edits of the copies go back into the wiki then.
`,
);

/** The librarian module: reading lists with copies of the wiki's documents, which the user reads, marks up, and returns. */
export const librarian: Module = {
  id: "librarian",
  name: "Librarian",
  description: "Checkouts of the wiki's material on a subject: a reading list in reading order, and a copy of each document for the user to read and mark up.",
  schema: {
    /** The user's request, in their words. */
    request: { type: "text" },
    status: { type: "text", values: ["out", "returned"] },
    returned: { type: "date" },
    /** The change of a return, when a copy held edits. */
    changes: { type: "links", default: [] },
  },
  documents: [checkoutSkill],
  tools: ({ vault, wiki }) => [
    defineTool({
      name: "checkout",
      description: `Makes a checkout: the reading list librarian/<date> <name>.md, and a copy of each document in the folder of that name for the user to read and mark up. Takes the user's request, a short name, the documents in reading order (each a note of ${TOPICS}/ or ${SOURCES}/, with a why of one line), and notes on what was left out. At most ${MAX_DOCUMENTS} documents.`,
      input: orderShape,
      title: ({ name, documents }) => `Check out ${name} (${documents.length} documents)`,
      run: async (order) => JSON.stringify(await checkout(vault, wiki, order)),
    }),
  ],
  ledgerViews: [
    {
      type: "table",
      name: "Checkouts",
      filters: { and: ['type == "session"'] },
      order: ["file.name", "status", "request", "created", "returned"],
      sort: [{ property: "created", direction: "DESC" }],
    },
  ],
};

