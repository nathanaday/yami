import { defineTool, z } from "../../agent/index.js";
import type { AgentTool } from "../../agent/types.js";
import type { LedgerView } from "../../document/bases.js";
import { basename, checkSection, link, LINK, linkTarget, readDocument, replaceSection, sectionText, updateDocument, writeDocument } from "../../document/document.js";
import { timestamp, type Schema } from "../../document/schema.js";
import { algorithms } from "../../wiki/algorithms/index.js";
import { bodyHash, InvalidPlan, validatePlan, type ChangePlan, type Write } from "../../wiki/change.js";
import { CHANGES, inKnowledge, SNAPSHOTS, SOURCES, TOPICS, WIKI } from "../../wiki/folders.js";
import { sourceChunks } from "../../wiki/source.js";
import { normalizeTag } from "../../wiki/wiki.js";
import { WIKI_COLOR } from "../colors.js";
import { YamiModule } from "../module.js";
import { checkedOut, checkoutSkill, COPY, MAX_DOCUMENTS, orderShape, readingListMade, type Checkout, type CheckoutOrder, type ReturnedCheckout } from "./checkout.js";
import { drafterBrief, extractorBrief, INGEST, pageForms } from "./ingest.js";

/**
 * The wiki module, built into every Yami: ingest sessions that turn sources into cited topics through
 * change plans, checkouts that give a person copies of the wiki's material to mark up and return, and the
 * wiki tools that every agent in the vault gets. Its folder, `wiki/`, holds the knowledge base for a person
 * to read; its sessions and ledger are under `internal/wiki/`.
 */
export class WikiModule extends YamiModule {
  readonly id = WIKI;
  readonly name = "Wiki";
  readonly description = "The knowledge base of the vault: topics cited to sources, changed through plans, with a version for each change.";
  readonly sessionsIn = "internal";
  readonly color = WIKI_COLOR;
  readonly icon = "book-open";
  readonly schema: Schema = {
    /** The source notes this session absorbs. */
    sources: { type: "links", default: [] },
    /** The changes this session applied: an ingest's plans, or a checkout's return. */
    changes: { type: "links", default: [] },
    /** A checkout's state: out, then returned. None before the checkout is made. */
    status: { type: "text", values: ["out", "returned"] },
    /** When a checkout was returned. */
    returned: { type: "date" },
  };
  readonly ledgerViews: LedgerView[] = [
    {
      type: "table",
      name: "Versions",
      filters: { and: ['type == "snapshot"'] },
      order: ["version", "created", "notes", "change", "restored"],
      sort: [{ property: "version", direction: "DESC" }],
    },
    {
      type: "table",
      name: "Changes",
      filters: { and: ['type == "change"'] },
      order: ["file.name", "status", "before", "after", "creates", "modifies", "removes", "session", "applied"],
      sort: [{ property: "created", direction: "DESC" }],
    },
    {
      type: "table",
      name: "Checkouts",
      filters: { and: ['type == "session"', 'flow == "checkout"'] },
      order: ["file.name", "status", "created", "returned"],
      sort: [{ property: "created", direction: "DESC" }],
    },
  ];
  readonly checks = { "checked-out": checkedOut };
  readonly instructions = `This vault has a wiki: topics in ${TOPICS}/ cited to sources in ${SOURCES}/, changed only through wiki_change, with a version in ${SNAPSHOTS}/ for each change and the change documents in ${CHANGES}/. The wiki tools search every note of the vault. Answer from the wiki with a citation for each claim, as [[links]], and say what the wiki does not cover instead of filling the gap from general knowledge without saying so.`;

  readonly cite = this.policy({
    name: "cite-every-claim",
    description: "Every claim in a topic names its source.",
    body: `Every claim in a topic names its source, as a link in the sentence or the paragraph, and the topic's \`sources\` property lists every source it cites. Never write a claim that a source does not make. When a source and a topic disagree, show both and set \`status: contested\`. Your own reasoning stays out of a topic.`,
  });
  readonly onePlan = this.policy({
    name: "one-plan",
    description: "Change the wiki only through one change plan.",
    body: `Every change to \`${TOPICS}/\` and \`${SOURCES}/\` goes through \`wiki_change\`, as one plan of creates, modifies, and removes. Never write those notes yourself, never change the original that a source embeds or links, never change a \`## Notes\` section, and never edit the session document.`,
  });
  readonly oneTopic = this.policy({
    name: "one-topic",
    description: "One subject, one topic.",
    body: `Before a new topic, call \`wiki_match\` with the subject's names. A hit means extend that topic. A near match means read the neighbors before you decide. Only a new subject gets a new topic, and its title is the name the sources use.`,
  });
  readonly changeApplied = this.promise({
    name: "change-applied",
    description: "At least one change plan of the session is applied.",
    check: "property",
    field: "changes",
    property: "status",
    value: "applied",
    atLeast: 1,
    body: "At least one change plan of this session is applied. `wiki_change` links each applied change from the session.",
  });
  readonly absorbed = this.promise({
    name: "sources-absorbed",
    description: "Every source of the session is absorbed.",
    check: "property",
    field: "sources",
    property: "status",
    value: "absorbed",
    body: "Every source of this session has `status: absorbed`, set by a modify in the plan after its claims are in the topics and its description, tags, Summary, and Structure are filled.",
  });
  readonly clean = this.promise({
    name: "clean-topics",
    description: "The sources and the topics that cite them pass lint.",
    check: "lint",
    field: "sources",
    body: "The sources of this session, and every topic that cites them, pass lint with no error: no dead link, and a description on each. `wiki_lint` shows what is left.",
  });
  readonly ingestSkill = this.skill({
    name: "ingest",
    description:
      "Absorb the sources of a session into cited topics through one change plan: chunk, extract, match, draft, change.",
    body: `# Ingest

The session's \`sources\` property links the source notes to absorb. You cannot write under \`${TOPICS}/\` or \`${SOURCES}/\` yourself: the session is read-only, and every change to the wiki goes through \`wiki_change\` as one plan. Work map-reduce, so a long document or many documents cost the same care as one.

This skill's folder, \`${INGEST}/\`, holds three files. Workers read them themselves, so give each worker the path, never the text:

- \`extractor.md\`: the brief of an extraction worker.
- \`drafter.md\`: the brief of a drafting worker.
- \`page-forms.md\`: the properties and sections of a topic and a source. Read it before you assemble the plan.

1. **Chunks.** Call \`wiki_chunks\` for each source. It names the original file and its chunks: line ranges, page ranges, or the whole file. Call \`wiki_tags\` once for the tag list.
2. **Extract.** For each chunk, send one worker with your subagent tool, in waves of at most eight. Tell it to read \`${INGEST}/extractor.md\` first, and give it the source path, the file, the range, the source's tags, and the tag list. Without a subagent tool, read \`extractor.md\` yourself and extract each chunk in turn, writing its Item Map in your reply before the next. A \`partial\` chunk goes again, narrower.
3. **Match.** Call \`wiki_match\` with every subject's name at once, aliases included, so a subject named in three chunks is one subject.
4. **Slice.** Put every subject that hits or nears one topic into the same slice, so two drafters never write one topic. At most eight subjects per slice.
5. **Draft.** Send one worker per slice. Tell it to read \`${INGEST}/drafter.md\` first, and give it the slice, the sources, their tags, and the tag list. Draft yourself, from \`drafter.md\`, when there are one or two slices. Each returns writes.
6. **Assemble.** One plan for \`wiki_change\`: every drafted write, plus a modify of each source with its \`description\`, \`tags\`, \`authority\`, \`## Summary\`, \`## Structure\` (one line per part, linking the topics that grew from it), and \`status: absorbed\`. Give the plan a short \`title\` ("Ingest the DINOv2 paper"), \`notes\` (what it does, the coverage, each skipped subject with its reason), and \`session\` (this session document's path). Past 25 new topics, keep the ones with the most claims and list the rest in the notes.
7. **Change.** Call \`wiki_change\`. It validates the plan, snapshots the wiki, applies every write, snapshots again, and links the change from this session. When it refuses, fix the writes it names and call it again. When it returns warnings, fix them with a second, small plan.
8. **Check.** Call \`wiki_lint\` with the sources' paths. Fix every error with another plan.

One plan holds at most 100 writes, about ten sources, or forty chunks. More is several plans, one after another.
`,
    files: { "extractor.md": extractorBrief, "drafter.md": drafterBrief, "page-forms.md": pageForms },
  });

  /** A session that absorbs its sources into the wiki. Read-only: the agent changes the wiki only through `wiki_change`. */
  readonly ingest = this.flow({
    name: "ingest",
    description: "Absorb the session's sources into cited topics through one change plan.",
    access: "read-only",
    command: false,
    skills: [this.ingestSkill],
    policies: [this.cite, this.onePlan, this.oneTopic],
    promises: [this.changeApplied, this.absorbed, this.clean],
  });

  readonly checkoutSkill = this.skill(checkoutSkill);
  readonly readingListMade = this.promise(readingListMade);

  /** A checkout as a session: the person writes the request in its Request section, and a run makes the reading list. */
  readonly checkout = this.flow({
    name: "checkout",
    description: "A reading list of the wiki's material on a subject, with a copy of each document to mark up.",
    skills: [this.checkoutSkill],
    promises: [this.readingListMade],
    maxIterations: 2,
  });

  /** Returns the checkout open in the editor, the person's act. It applies while the checkout is out. */
  readonly returnAction = this.action({
    id: "return",
    name: "Return this checkout",
    on: this.checkout,
    when: (properties) => properties.status === "out",
    run: async (session) =>
      (await this.returnCheckout(session.path)).summary.replace(/^- /gm, "").replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1"),
  });

  /**
   * Makes a checkout: the session document holds the reading list, in reading order with a why each, and the
   * folder of its name a copy of each document. A copy keeps the original's body, with `copy_of` and
   * `sha256`, the hash of that body, so the return can tell the user's edits from the original's. With
   * `session`, that checkout session becomes the reading list; with `name`, it creates the session
   * `internal/wiki/sessions/<date> <name>.md`, done at once. Only notes of `wiki/topics/` and
   * `wiki/sources/` are checked out. It throws, and writes nothing, for an empty request or a request or
   * notes with a line that would start a section, no document or more than 60, a note that is not knowledge,
   * a document twice, a why that is empty or more than one line, no session and no name, and a session that is
   * no checkout session of the wiki or holds a checkout already. `wiki_checkout` calls it.
   * @example
   * const { session, copies } = await wiki.makeCheckout({ request: "the basics of RL", name: "RL", documents: [{ path: "Reinforcement learning", why: "the overview" }] });
   */
  async makeCheckout(order: CheckoutOrder): Promise<Checkout> {
    const { vault, wiki } = this;
    await wiki.refresh();
    if (!order.request?.trim()) throw new Error("The request is empty: give the user's words.");
    if (!order.documents?.length) throw new Error("A checkout needs one document or more.");
    if (order.documents.length > MAX_DOCUMENTS) throw new Error(`A checkout holds at most ${MAX_DOCUMENTS} documents; ask the user to narrow the request.`);
    if (!order.session && !order.name?.trim()) throw new Error("Give the session of the checkout, or a name for a new one.");
    checkSection("Request", order.request);
    checkSection("Notes", order.notes ?? "");
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
      session = await this.#checkoutSession(order.session);
      if ((await readDocument(vault, session)).properties.status) throw new Error(`${basename(session)} holds a checkout already.`);
    } else {
      // The date keeps the reading list's name apart from a topic of the same subject, so a link by name still finds the topic.
      session = (await this.checkout.create({ name: `${timestamp().slice(0, 10)} ${order.name!.trim()}`, request: order.request.trim() })).path;
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
      // The person's own words in the Request section stay; an empty one takes the request of the order.
      if (!sectionText(doc.body, "Request").trim()) doc.body = replaceSection(doc.body, "Request", order.request.trim());
      doc.properties.status = "out";
      // A run of the session records its own state; a checkout from a conversation is done when it is made.
      if (!order.session) doc.properties.state = "done";
      doc.body = replaceSection(doc.body, "Reading list", list);
      if (order.notes?.trim()) doc.body = replaceSection(doc.body, "Notes", order.notes.trim());
    });
    return { session, copies };
  }

  /**
   * Returns a checkout, the person's act. A copy whose body changed returns its edits to its original, unless
   * the original changed too since the checkout, or is gone: then the copy stays. A link to another copy
   * points back at its original. Each edit is checked alone, so an edit the wiki refuses stays in its copy
   * with the reason, and holds back no other. One change, `Return <name>`, applies the rest. Every copy
   * that returned or had no edit is removed. The session gets `status: returned`, `returned`, and a
   * Return section that says what happened. It throws for a session that is no checkout session of the wiki,
   * or a checkout that is not out. The action Return this checkout calls it.
   * @example
   * const { change, returned, skipped } = await wiki.returnCheckout("internal/wiki/sessions/2026-10-06 RL.md");
   */
  async returnCheckout(session: string): Promise<ReturnedCheckout> {
    const { vault, wiki } = this;
    session = await this.#checkoutSession(session);
    const doc = await readDocument(vault, session);
    if (doc.properties.status !== "out") throw new Error(`${basename(session)} is not out; ${doc.properties.status === "returned" ? "it was returned already" : "it holds no checkout"}.`);
    await wiki.refresh();
    const folder = session.slice(0, -3);
    const writes: Write[] = [];
    const done: string[] = [];
    const skipped: ReturnedCheckout["skipped"] = [];
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
        const write: Write = { op: "modify", path: original, body: await this.#towardOriginals(body), base: properties.sha256, why: "the user's edits of the checkout copy" };
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

  /** The path of a checkout session of this module, or an error that says what it is instead. */
  async #checkoutSession(path: string): Promise<string> {
    const doc = await this.yami.session(path).read();
    if (doc.properties.type !== "session" || doc.properties.module !== this.id || this.flowOf(doc.properties.flow) !== this.checkout) throw new Error(`${path} is not a checkout session of the ${this.id} module.`);
    return path;
  }

  /**
   * Points each link to a checkout copy at the copy's original, so no returned note links a copy that the
   * return removes. A link with no alias gets the original's name as its alias, so it reads as before.
   */
  async #towardOriginals(body: string): Promise<string> {
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

  tools(): AgentTool[] {
    const wiki = this.wiki;
    return [
      defineTool({
        name: "search",
        readOnly: true,
        description: `Ranked search over every note of the vault. Returns notes with a score in [0, 1], a snippet, and why each ranks. Filter by types (topic, source, …), tags (a note must hold every one, or a tag below it), and folder. With seeds and no text, it returns the notes related to the seeds through links. Algorithms: ${Object.keys(algorithms).join(", ")}. To answer a question: search, read the best notes with Read, follow a link one hop when needed, then answer with a [[link]] on each claim.`,
        input: {
          text: z.string().optional().describe("The query. May be empty when seeds are given."),
          seeds: z.array(z.string()).optional().describe("Notes to start from, as paths or [[link]] names."),
          algorithm: z.string().optional().describe(`One of ${Object.keys(algorithms).join(", ")}. Default: the vault's default.`),
          types: z.array(z.string()).optional().describe("Keep only notes of these types."),
          tags: z.array(z.string()).optional().describe("Keep only notes that hold every one of these tags."),
          folder: z.string().optional().describe("Keep only notes in this folder."),
          limit: z.number().int().positive().optional().describe("At most this many hits. Default 20."),
        },
        title: ({ text, seeds }) => (text ? `Search the wiki for "${text.slice(0, 60)}"` : `Notes related to ${(seeds ?? []).join(", ").slice(0, 60)}`),
        run: async ({ text, ...query }) => {
          await wiki.refresh();
          const hits = await wiki.search(text ?? "", query);
          return JSON.stringify({ algorithm: query.algorithm ?? wiki.defaultAlgorithm, hits });
        },
      }),
      defineTool({
        name: "match",
        readOnly: true,
        description: `Where each name stands in the wiki: hit (a topic or source holds the name or an alias, with its path), near (notes above the similarity threshold, as neighbors), or new. Call it with every subject of a source at once, before you draft.`,
        input: {
          names: z.array(z.string()).min(1).describe("The names to match, each with its aliases joined by a space when useful."),
          types: z.array(z.string()).optional().describe("The note types to match against. Default: topic and source."),
        },
        title: ({ names }) => `Match ${names.length} name(s) against the wiki`,
        run: async ({ names, types }) => {
          await wiki.refresh();
          return JSON.stringify({ matches: await wiki.match(names, { types }) });
        },
      }),
      defineTool({
        name: "lint",
        readOnly: true,
        description: "The health of the notes: dead links, duplicate names, missing descriptions, uncited sources, and orphan topics. Each finding names its fix. Errors fail the clean-topics promise; warnings are worth a look. Reads only.",
        input: {
          paths: z.array(z.string()).optional().describe("Check only these notes, as paths or [[link]] names."),
          folder: z.string().optional().describe(`Check only this folder, for example ${TOPICS}.`),
        },
        title: ({ paths, folder }) => `Lint ${paths ? `${paths.length} note(s)` : folder ?? "the vault"}`,
        run: async ({ paths, folder }) => {
          await wiki.refresh();
          return JSON.stringify({ findings: await wiki.lint({ paths, folder }) });
        },
      }),
      defineTool({
        name: "tags",
        readOnly: true,
        description: "The tags of the vault's notes with the count of notes that hold each, most used first. The vocabulary for new topics.",
        input: {},
        title: () => "List the wiki's tags",
        run: async () => {
          await wiki.refresh();
          return JSON.stringify({ tags: wiki.tags() });
        },
      }),
      defineTool({
        name: "neighbors",
        readOnly: true,
        description:
          "Where a note or a tag sits in the tag hierarchy, where ml/vision is below ml. For a note: its own tags, the tags above them, and the tags one level below them. For a tag: the tags above it, the tags one level below it, and the notes that hold it. Each tag comes with the count of notes under it. With neither, the top tags. Use it to walk a large wiki by subject: from a note to its tags, from a tag to the notes and tags under it.",
        input: {
          note: z.string().optional().describe("A note, as a path or a [[link]] name."),
          tag: z.string().optional().describe("A tag, such as ml/vision."),
          limit: z.number().int().positive().optional().describe("At most this many notes of a tag. Default 50."),
        },
        title: ({ note, tag }) => (note ? `Neighbors of ${note.slice(0, 60)}` : tag ? `The tag ${tag.slice(0, 60)}` : "The top tags"),
        run: async ({ note, tag, limit = 50 }) => {
          if (note && tag) return { text: "Give a note or a tag, not both.", isError: true };
          if (tag !== undefined && !normalizeTag(tag)) return { text: `"${tag}" is not a tag. Leave tag out for the top tags.`, isError: true };
          await wiki.refresh();
          if (note) {
            const neighbors = await wiki.neighbors(note);
            return neighbors ? JSON.stringify(neighbors) : { text: `${note} is not a note of the wiki.`, isError: true };
          }
          const view = await wiki.tag(tag);
          if (!view) return { text: `No note holds the tag ${tag}. wiki_tags lists every tag.`, isError: true };
          return JSON.stringify({ ...view, notes: view.notes.slice(0, limit), ...(view.notes.length > limit && { more: view.notes.length - limit }) });
        },
      }),
      defineTool({
        name: "chunks",
        readOnly: true,
        description: `Splits a source's original for the workers of an ingest: a text file into runs of at most 800 lines, a PDF into 20 pages at a time, any other file whole. Returns the file and each chunk's range and locator. Workers read a range with their Read tool.`,
        input: {
          source: z.string().describe("The source note, as a path or a [[link]] name."),
        },
        title: ({ source }) => `Chunk ${source.slice(0, 60)}`,
        run: async ({ source }) => {
          await wiki.refresh();
          return JSON.stringify(await sourceChunks(wiki.vault, wiki, source));
        },
      }),
      defineTool({
        name: "change",
        description: `The only way the wiki changes. Takes one plan: a title, notes, the session document's path, and writes (create: path, properties, body; modify: path, the properties that change with null to remove one, and the whole new body or none; remove: path), each with a why. Validates the plan (paths under ${TOPICS}/ or ${SOURCES}/, a description on every note, the schema), snapshots the wiki when its state is not captured, writes the change document to ${CHANGES}/, applies every write, snapshots again, and links the change from the session. Returns the change document, the versions before and after, and warnings for links to no note. Refuses an invalid plan with the write and the rule, and changes nothing. A failed write puts the wiki back at the version before.`,
        input: {
          title: z.string().describe("A short name: the file name of the change document."),
          notes: z.string().optional().describe("What the change does and why, the coverage, and each skipped subject with its reason."),
          session: z.string().optional().describe("The session document, as a vault path. The change links from it."),
          writes: z
            .array(
              z.object({
                op: z.enum(["create", "modify", "remove"]),
                path: z.string().describe(`The note, under ${TOPICS}/ or ${SOURCES}/.`),
                properties: z.record(z.string(), z.unknown()).optional().describe("create: every property. modify: the properties that change; null removes one."),
                body: z.string().optional().describe("create: the body. modify: the whole new body, or none to keep it."),
                why: z.string().optional().describe("One line on why the change makes this write."),
              }),
            )
            .min(1),
        },
        title: ({ title, writes }) => `Change the wiki: ${title.slice(0, 50)} (${writes.length} writes)`,
        run: async (plan) => {
          try {
            return JSON.stringify(await wiki.change(plan as ChangePlan));
          } catch (error) {
            if (error instanceof InvalidPlan) return { text: error.message, isError: true };
            throw error;
          }
        },
      }),
      defineTool({
        name: "checkout",
        description: `Makes a checkout: a reading list, and a copy of each document in the folder of the list's name, for the user to read and mark up. In a checkout session, the session document becomes the reading list; otherwise the reading list is ${this.layout.sessions}/<date> <name>.md. Takes the user's request, the documents in reading order (each a note of ${TOPICS}/ or ${SOURCES}/, with a why of one line), and notes on what was left out. At most ${MAX_DOCUMENTS} documents. The skill /wiki:checkout says how to choose and order them.`,
        input: orderShape,
        title: ({ name, session, documents }) => `Check out ${name ?? (session ? basename(session) : "")} (${documents.length} documents)`,
        run: async (order) => JSON.stringify(await this.makeCheckout(order)),
      }),
    ];
  }
}
