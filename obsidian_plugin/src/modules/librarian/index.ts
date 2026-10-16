import { defineTool, YamiModule, z, type AgentTool, type Check, type LedgerView, type Schema } from "yami";
import { basename, link, LINK, linkTarget, readDocument, replaceSection, timestamp, updateDocument, writeDocument } from "yami/document";
import { bodyHash, inKnowledge, InvalidPlan, SOURCES, TOPICS, validatePlan, type Write } from "yami/wiki";
import madePromise from "./promises/Reading list made.md";
import checkoutSkill from "./skills/checkout/SKILL.md";

/** The most documents one checkout holds. */
export const MAX_DOCUMENTS = 60;
const COPY = " (checkout)";

/** What a checkout takes: the tool's input, and the SDK's. */
export const orderShape = {
  request: z.string().describe("The user's request, in their words."),
  session: z.string().optional().describe("In a checkout session: the session document, as a vault path. It becomes the reading list, and its copies go in the folder of its name."),
  name: z.string().optional().describe("With no session: a short name. The reading list is librarian/<date> <name>.md, and its copies are in the folder of that name."),
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

/** Met when the session is a reading list: a checkout wrote it, and it is out or returned. */
const checkedOut: Check = async (_promise, context) => {
  const status = context.properties.status;
  return status === "out" || status === "returned"
    ? { status: "met", detail: `the checkout is ${status}` }
    : { status: "unmet", detail: "no checkout yet: call librarian_checkout with this session's path" };
};

/** Checkouts: a reading list of the wiki's material on a subject, with copies to mark up and return. */
export class Librarian extends YamiModule {
  readonly id = "librarian";
  readonly name = "Librarian";
  readonly description = "Checkouts of the wiki's material on a subject: a reading list in reading order, and a copy of each document for the user to read and mark up.";
  /** The color of `librarian/` in the file explorer. The other modules of this plugin take a default color. */
  readonly color = "#a0522d";
  readonly schema: Schema = {
    /** The user's request, in their words. */
    request: { type: "text" },
    status: { type: "text", values: ["out", "returned"] },
    returned: { type: "date" },
    /** The change of a return, when a copy held edits. */
    changes: { type: "links", default: [] },
  };
  readonly ledgerViews: LedgerView[] = [
    {
      type: "table",
      name: "Checkouts",
      filters: { and: ['type == "session"'] },
      order: ["file.name", "status", "request", "created", "returned"],
      sort: [{ property: "created", direction: "DESC" }],
    },
  ];
  readonly checks = { "checked-out": checkedOut };

  readonly checkoutSkill = this.skill(checkoutSkill);
  readonly made = this.promise("Reading list made", madePromise);

  /** A checkout as a session: the person writes the request in the document, and a run makes the reading list. */
  readonly checkout = this.template({
    id: "checkout",
    name: "Checkout",
    body: "## Request\n\nWhat you want to read about, in your words.",
    skills: [this.checkoutSkill],
    promises: [this.made],
    maxIterations: 2,
  });

  readonly returnAction = this.action({
    id: "return",
    name: "Return this checkout",
    on: this.checkout,
    when: (properties) => properties.status === "out",
    run: async (session) =>
      (await this.returnCheckout(session.path)).summary.replace(/^- /gm, "").replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1"),
  });

  tools(): AgentTool[] {
    return [
      defineTool({
        name: "checkout",
        description: `Makes a checkout: a reading list, and a copy of each document in the folder of the list's name, for the user to read and mark up. In a checkout session, the session document becomes the reading list; otherwise the reading list is librarian/<date> <name>.md. Takes the user's request, the documents in reading order (each a note of ${TOPICS}/ or ${SOURCES}/, with a why of one line), and notes on what was left out. At most ${MAX_DOCUMENTS} documents.`,
        input: orderShape,
        title: ({ name, session, documents }) => `Check out ${name ?? (session ? basename(session) : "")} (${documents.length} documents)`,
        run: async (order) => JSON.stringify(await this.makeCheckout(order)),
      }),
    ];
  }

  /**
   * Makes a checkout: the session document holds the reading list, and the folder of its name a copy of
   * each document. A copy keeps the original's body, with `copy_of` and `sha256`, the hash of that body, so
   * the return can tell the user's edits from the original's.
   */
  async makeCheckout(order: Order): Promise<Checkout> {
    const { vault, wiki } = this;
    await wiki.refresh();
    if (!order.request?.trim()) throw new Error("The request is empty: give the user's words.");
    if (!order.documents?.length) throw new Error("A checkout needs one document or more.");
    if (order.documents.length > MAX_DOCUMENTS) throw new Error(`A checkout holds at most ${MAX_DOCUMENTS} documents; ask the user to narrow the request.`);
    if (!order.session && !order.name?.trim()) throw new Error("Give the session of the checkout, or a name for a new one.");
    const originals: string[] = [];
    for (const { path, why } of order.documents) {
      const found = wiki.resolve(path);
      if (!found || !inKnowledge(found)) throw new Error(`${path} is not a note of ${TOPICS}/ or ${SOURCES}/; only knowledge is checked out.`);
      if (originals.includes(found)) throw new Error(`The documents hold ${found} twice.`);
      if (!why?.trim() || why.includes("\n")) throw new Error(`Give ${found} a why of one line.`);
      originals.push(found);
    }
    let session: string;
    if (order.session) {
      session = await this.ownSession(order.session);
      if ((await readDocument(vault, session)).properties.status) throw new Error(`${basename(session)} holds a checkout already.`);
    } else {
      // The date keeps the reading list's name apart from a topic of the same subject, so a link by name still finds the topic.
      session = (await this.checkout.create({ name: `${timestamp().slice(0, 10)} ${order.name!.trim()}` })).path;
    }
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
      doc.properties.request = order.request.trim();
      doc.properties.status = "out";
      // A run of the session records its own state; a checkout from a conversation is done when it is made.
      if (!order.session) doc.properties.state = "done";
      doc.body = replaceSection(doc.body, "Reading list", list);
      if (order.notes?.trim()) doc.body = replaceSection(doc.body, "Notes", order.notes.trim());
    });
    return { session, copies };
  }

  /**
   * Returns a checkout, the user's act. A copy whose body changed returns its edits to the original as
   * one change, unless the original changed too since the checkout; then the copy stays. A link to
   * another copy points back at its original. Every copy that returned or had no edit is removed.
   */
  async returnCheckout(session: string): Promise<Returned> {
    const { vault, wiki } = this;
    session = await this.ownSession(session);
    const doc = await readDocument(vault, session);
    if (doc.properties.status !== "out") throw new Error(`${basename(session)} is not out; ${doc.properties.status === "returned" ? "it was returned already" : "it holds no checkout"}.`);
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
        const write: Write = { op: "modify", path: original, body: await this.towardOriginals(body), base: properties.sha256, why: "the user's edits of the checkout copy" };
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

  /** The path of a session document of this module, or an error that says what it is instead. */
  private async ownSession(path: string): Promise<string> {
    const doc = await this.yami.session(path).read();
    if (doc.properties.type !== "session" || doc.properties.module !== this.id) throw new Error(`${path} is not a session of the ${this.id} module.`);
    return path;
  }

  /**
   * Points each link to a checkout copy at the copy's original, so no returned note links a copy that the
   * return removes. A link with no alias gets the original's name as its alias, so it reads as before.
   */
  private async towardOriginals(body: string): Promise<string> {
    const originals = new Map<string, string>();
    for (const [, target] of body.matchAll(LINK)) {
      const path = this.wiki.locate(target!);
      const original = path && (await readDocument(this.vault, path)).properties.copy_of;
      if (typeof original === "string") originals.set(target!, linkTarget(original));
    }
    return body.replace(LINK, (whole, target: string, rest: string) => {
      const original = originals.get(target);
      if (!original) return whole;
      return `${whole.startsWith("!") ? "!" : ""}[[${original}${rest || `|${basename(original)}`}]]`;
    });
  }
}
