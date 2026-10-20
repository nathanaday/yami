import { z } from "../../agent/index.js";
import type { Check } from "../checks.js";
import { moduleLayout } from "../module.js";
import { WIKI } from "../../wiki/folders.js";

/** The most documents one checkout holds. */
export const MAX_DOCUMENTS = 60;
/** The end of a copy's name: `Q-learning (checkout).md`. */
export const COPY = " (checkout)";

/** The folder of the wiki's sessions, where a checkout's reading list and the folder of its copies go. */
const SESSIONS = moduleLayout(WIKI, "internal").sessions;

/** The skill of a checkout session, `/wiki:checkout`. */
export const checkoutSkill = `---
name: checkout
description: "Check out the wiki's material on a subject: choose the documents that serve the request, put them in reading order with a reason each, and make the checkout."
---
# Checkout

A checkout is a reading list and a copy of each document on it, for the user to read and mark up. Code ranks the candidates and writes the copies. You choose the documents, order them, and give each one a reason.

1. **The request.** Take it in the user's words: the message, or, in a checkout session, the session's Request section. Turn the words that name tags into \`tags\` for the search.
2. **Candidates.** Call \`wiki_search\` with the request as \`text\`, \`algorithm: "hop2"\`, \`types: ["topic"]\`, and \`limit: 40\`. Add \`"source"\` to the types when the user asks for the sources themselves. The \`hop2\` ranking adds the documents linked to or from the best hits, up to two links away; \`why\` says which hit led to each.
3. **Choose.** Read each candidate's snippet, and the document with Read when the snippet does not settle it. Keep a document that serves the request; drop one that does not. Judge a linked document on its own content, not on the hit that led to it. When you drop a document, also drop the candidates that only it led to, unless they serve the request on their own. A branch stops where its documents stop serving.
4. **Size.** Aim for a sitting or a week of reading: at most about 30 documents. When more serve, the request is too broad: ask the user once to narrow it, with two or three narrower requests from the tags or subjects of the candidates.
5. **Order.** Foundations first: a definition, an overview, or a concept that the others assume comes before the documents that build on it. Give each document a \`why\`: one line on what it gives the reader for this request.
6. **Make it.** Call \`wiki_checkout\` with \`request\` (the user's words), \`documents\` in reading order with each \`path\` and \`why\`, and \`notes\`: the near subjects you left out, the branches you stopped, and the gaps of the wiki. In a checkout session, give \`session\`: the session document's path, which becomes the reading list. Otherwise give \`name\`: a short name, such as "Reinforcement learning".

End with one line: the reading list as a link, and the count of documents. Never edit a copy: the copies are the user's. The user returns the checkout in Obsidian, and the edits of the copies go back into the wiki then.
`;

/** The promise of a checkout session, which the `checked-out` check holds. */
export const readingListMade = `---
name: reading-list-made
description: The session document is the reading list, with a copy of each document.
check: checked-out
---
The session document is the reading list: \`wiki_checkout\` with this session's path wrote its Reading list section and a copy of each document in the folder of the same name.
`;

/** What a checkout takes: the input of `wiki_checkout`, and of `WikiModule.makeCheckout`. */
export const orderShape = {
  request: z.string().describe("The user's request, in their words."),
  session: z.string().optional().describe("In a checkout session: the session document, as a vault path. It becomes the reading list, and its copies go in the folder of its name."),
  name: z.string().optional().describe(`With no session: a short name. The reading list is ${SESSIONS}/<date> <name>.md, and its copies are in the folder of that name.`),
  documents: z
    .array(z.object({ path: z.string().describe("The note, as a path or a [[link]] name."), why: z.string().describe("One line: what it gives the reader.") }))
    .min(1)
    .max(MAX_DOCUMENTS),
  notes: z.string().optional().describe("What was left out, and why."),
};

/** A checkout to make: the user's request, a session or a name, the documents in reading order with a why each, and notes. */
export type CheckoutOrder = z.infer<z.ZodObject<typeof orderShape>>;

/** A checkout that is out. */
export interface Checkout {
  /** The reading list: the session document. Its copies are in the folder of the same name. */
  session: string;
  /** The copies, in reading order. */
  copies: string[];
}

/** What a return did. */
export interface ReturnedCheckout {
  /** The change that brought the edits into the wiki, when a copy held edits. */
  change?: string;
  /** The originals the change modified. */
  returned: string[];
  /** The copies that stay, each with why: the original changed since the checkout, is gone, or refused the edit. */
  skipped: { copy: string; reason: string }[];
  /** What the return did, in a few lines: the text of the reading list's Return section. */
  summary: string;
}

/** Met when the session is a reading list: a checkout wrote it, and it is out or returned. */
export const checkedOut: Check = async (_promise, context) => {
  const status = context.properties.status;
  return status === "out" || status === "returned"
    ? { status: "met", detail: `the checkout is ${status}` }
    : { status: "unmet", detail: "no checkout yet: call wiki_checkout with this session's path" };
};
