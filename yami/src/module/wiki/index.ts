import { defineTool, z } from "../../agent/index.js";
import type { AgentTool } from "../../agent/types.js";
import type { LedgerView } from "../../document/bases.js";
import { WIKI_ID, type Folders } from "../../document/folders.js";
import { basename, checkSection, link, LINK, linkTarget, readDocument, replaceSection, sectionText, updateDocument, writeDocument } from "../../document/document.js";
import { timestamp, type Schema } from "../../document/schema.js";
import { algorithms } from "../../wiki/algorithms/index.js";
import { BUNDLE_SIZES, isRepository, readBundle, selectBundle, selectDocuments, writeBundle, type BundleSelection, type BundleSize, type WrittenBundle } from "../../wiki/bundle.js";
import { bodyHash, InvalidPlan, validatePlan, type ChangePlan, type Write } from "../../wiki/change.js";
import { resolveCitations } from "../../wiki/citations.js";
import { deltaChunks } from "../../wiki/delta.js";
import { isAbsolute } from "../../wiki/source.js";
import { BUILT_IN_TEMPLATES } from "../../wiki/template-texts.js";
import { pageSkeleton, RESERVED_TEMPLATE_NAMES, starterTemplate, templatePath } from "../../wiki/templates.js";
import { normalizeTag } from "../../wiki/wiki.js";
import { WIKI_COLOR } from "../colors.js";
import { checkName, ID, idFromName, YamiModule } from "../module.js";
import { moveLegacyTopics } from "../move.js";
import type { ModuleProblem } from "../vault-module.js";
import { checkedOut, checkoutSkill, COPY, MAX_DOCUMENTS, orderShape, readingListMade, type Checkout, type CheckoutOrder, type ReturnedCheckout } from "./checkout.js";
import { absorbed, drafterAgent, extractorAgent, pageRules, proposed } from "./ingest.js";
import { figures, figuresMade, figuresSkill, illustratorAgent, saveFigure } from "./figures.js";
import { bundleImported, imported, importSkill, stagingFolder, type ImportedBundle, type StagedNote } from "./import.js";
import { claimsVerified, verified, verifierAgent, verifySkill } from "./verify.js";

/** The vault folder where a bundle goes when the export names none: `exports/<name>/`. */
export const EXPORTS = "exports";

/** What an export takes: a page and a size, or the documents, and where to write. */
export interface ExportOptions {
  /** The page to export around, as a path or a link name. */
  topic?: string;
  /** How far to reach from the page. Default `medium`. */
  size?: BundleSize;
  /** Instead of a page and a size: the pages and sources to export. The sources the pages cite come along. */
  documents?: string[];
  /** A vault path, or an absolute path outside the vault. Default `exports/<name>`. */
  folder?: string;
  /** The bundle's name. Default: the topic's, or `Bundle <date>`. */
  name?: string;
  /** Whether the originals come along. Default true. */
  originals?: boolean;
}

/** What an import takes: where the bundle is, and the session's name. */
export interface ImportOptions {
  /** A folder of the vault, an absolute path, or a git repository URL. */
  from: string;
  /** The session's name. Default `Import <bundle> <date>`. */
  name?: string;
}

/**
 * The wiki module, built into every Yami: ingest sessions that turn sources into cited pages through
 * change plans that a person approves, checkouts that give a person copies of the wiki's material to mark
 * up and return, and the wiki tools that every agent in the vault gets. Its folder, `wiki/`, holds the knowledge base for a person
 * to read; its sessions and ledger are under `<internal>/wiki/`. The vault's folder settings say where both are.
 */
export class WikiModule extends YamiModule {
  readonly id = WIKI_ID;
  readonly name = "Wiki";
  readonly description = "The knowledge base of the vault: pages of each template cited to sources, changed through plans that a person approves, with a version for each change.";
  readonly sessionsIn = "internal";
  readonly color = WIKI_COLOR;
  readonly icon = "book-open";
  readonly schema: Schema = {
    /** The changes this session proposed: an ingest's plans, or a checkout's return. */
    changes: { type: "links", default: [] },
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
      order: ["file.name", "status", "reason", "creates", "modifies", "removes", "session", "before", "after", "applied", "rejected"],
      sort: [{ property: "created", direction: "DESC" }],
    },
    {
      type: "table",
      name: "Stubs",
      filters: { and: ['type == "stub"'] },
      order: ["file.name", "description", "becomes", "tags", "created"],
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
  readonly checks = { "checked-out": checkedOut, proposed, absorbed, imported, figures, verified };
  readonly instructions = (f: Folders): string =>
    `This vault has a wiki: pages in ${f.pages}/, each of a template in ${f.templates}/ that its type names (wiki_templates lists them), cited to sources in ${f.sources}/, changed only through wiki_change, which proposes a change document in ${f.changes}/ that a person approves in Obsidian, with a version in ${f.snapshots}/ for each applied change. The wiki tools search every note of the vault. Answer from the wiki with a citation for each claim, as [[links]], and say what the wiki does not cover instead of filling the gap from general knowledge without saying so.`;

  /** The templates of the pages, which the module installs in `<internal>/wiki/templates/`. */
  readonly pageTemplates = Object.values(BUILT_IN_TEMPLATES).map((text) => this.template(text));

  readonly cite = this.policy({
    name: "cite-every-claim",
    description: "Every claim in a page names its source.",
    body: `Every claim in a page names its source, as a link in the sentence or the paragraph, and the page's \`sources\` property lists every source it cites. Never write a claim that a source does not make. When a source and a page disagree, show both and set \`status: contested\`. Your own reasoning stays out of a page.`,
  });
  readonly onePlan = this.policy({
    name: "one-plan",
    description: "Change the wiki only through one change plan.",
    body: (f: Folders) => `Every change to \`${f.pages}/\` and \`${f.sources}/\` goes through \`wiki_change\`, as one plan of creates, modifies, and removes. The tool proposes the plan as a change document; a person approves it in Obsidian, and only then does the wiki change. Your work ends when the plan is proposed: do not wait for the approval, and never ask for it. Never write those notes yourself, never change the original that a source embeds or links, never change a \`## Notes\` section, and never edit the session document.`,
  });
  readonly onePage = this.policy({
    name: "one-page",
    description: "One subject, one page, of the template that fits it.",
    body: `Before a new page, call \`wiki_match\` with the subject's names. A hit means extend that page. A near match means read the neighbors before you decide. Only a new subject gets a new page, and its title is the name the sources use. Its \`type\` is the template that fits the subject: read the template's \`TEMPLATE.md\` before you write the page, and give it the template's properties and sections. A subject that the sources say too little about is a stub. A stub, or a page of the wrong template, becomes the right one with a modify that sets \`type\`.`,
  });
  readonly voice = this.policy({
    name: "encyclopedic-voice",
    description: "A page reads as an encyclopedia article: it states what is known, cites in parentheses, and never narrates its source.",
    body: `A page is an article on its subject that stands on its own, in the voice of an encyclopedia. State what is known, and put the citation in parentheses after the claim: "DINOv2 trains on 142M curated images ([[DINOv2]], p. 3)." Never make the source the subject of a sentence: not "the slides say", "the paper argues", "according to the lecture", "in this document", "the author notes". The source appears in the parentheses and in the Sources section, and nowhere else. Never recap the source in its own order, and never summarize it in a page: the sections of a page follow the subject, and the source note's Summary and Structure are the one place that describes the original, how it is organized, and where it is weak. No first person, no "you", no advice, no commentary of your own. Present tense for what is, past tense for what happened. Use the subject's own terms, and define each at its first use.`,
  });
  readonly protectedText = this.policy({
    name: "protected-text",
    description: "Text that a person protected stays as it is.",
    body: `A person can protect text in a note against change by an agent. Keep every protected text as it is, letter for letter, wherever it stands in the note: do not reword it, move it, cut it, or fold it into other text. Before a modify of a note, call \`yami_protected\` with the note, and keep each text it lists in the new body. \`wiki_change\` refuses a write that drops one, with the text; then put the text back and propose again. Write around protected text: a new claim goes beside it, not in its place.`,
  });
  readonly changeApplied = this.promise({
    name: "change-applied",
    description: "A change plan of the session is proposed, or applied.",
    check: "proposed",
    body: "At least one change plan of this session stands: proposed, for a person to approve, or applied. `wiki_change` links each change from the session. A rejected change does not count: read its reason, and propose a new plan.",
  });
  readonly absorbed = this.promise({
    name: "sources-absorbed",
    description: "Every source of the session is absorbed, or a standing change absorbs it.",
    check: "absorbed",
    body: "Every source of this session has `status: absorbed`, or a change of this session that is proposed or applied sets it, by a modify after its claims are in the pages and its description, tags, Summary, and Structure are filled.",
  });
  readonly clean = this.promise({
    name: "clean-pages",
    description: "The sources and the pages that cite them pass lint once the plan is applied.",
    body: "Once the plan is applied, the sources of this session and every page that cites them pass lint with no error: no dead link, and a description on each. The wiki holds the result only after a person approves, so the review judges this from the change document: `wiki_lint` over the pages that exist, and the warnings that `wiki_change` returned for links to no note and for sections that a page's template asks for.",
  });
  readonly extractor = this.agent(extractorAgent);
  readonly drafter = this.agent(drafterAgent);
  readonly ingestSkill = this.skill({
    name: "ingest",
    description:
      "Absorb the sources of an ingest session into cited pages through one change plan that a person approves: chunk, extract, match, draft, propose. To ingest files from a conversation, call wiki_ingest, which starts an ingest session.",
    body: (f: Folders) => `# Ingest

**In a conversation**, with no ingest session, do not ingest the files yourself. Call \`wiki_ingest\` with the files or the folder that the user names, as vault paths or absolute paths: it captures them as sources and starts an ingest session, which runs this skill. Tell the user the session's name, and that they approve its change in Obsidian when it is proposed. Then end.

**In an ingest session**, the session's \`sources\` property links the source notes to absorb. You cannot write under \`${f.pages}/\` or \`${f.sources}/\` yourself: the session is read-only, and every change to the wiki goes through \`wiki_change\` as one plan. Work map-reduce, so a long document or many documents cost the same care as one.

Two agents of the session do the reading and the drafting, each in a fresh context: \`extractor\` reads one chunk, and \`drafter\` drafts the writes of one slice. Run each with \`yami_agent\`; calls in one turn run at the same time. An agent knows only its brief and your task, so give it everything in the task. \`page-rules.md\`, in this skill's folder \`${f.wikiInternal}/skills/ingest/\`, gives the rules of every page; each page's template, in \`${f.templates}/<type>/TEMPLATE.md\`, gives its properties and its sections, and \`wiki_templates\` lists the templates. Read the rules before you assemble the plan.

1. **Chunks.** Call \`wiki_chunks\` for each source. It names the file to read and its chunks: line ranges, page ranges, or the whole file. Call \`wiki_tags\` once for the tag list, and \`wiki_templates\` once for the templates. A source that **supersedes** an earlier capture of its file says so: with \`delta: true\` its chunks are the changed passages alone, with the lines around them, and \`citations\` lists each citation of the old source in the pages with where it stands (\`kept\` with its locator in the new text as \`moved\`, \`changed\`, or \`unknown\`); with \`delta: false\` (the copies are not texts) the chunks are the whole file and every cited passage is unknown. Extract the chunks it gives and no more; a source with no chunk changed in nothing but form, and its citations move.
2. **Extract.** For each chunk, call \`yami_agent\` with the agent \`extractor\`, in waves of at most eight, also when you could read the chunk yourself: each worker reads with a fresh context, so the last chunk gets the care of the first. Only when the sources hold one chunk in all, extract it yourself from the extractor's brief, \`${f.wikiInternal}/agents/extractor/AGENT.md\`. The task gives the source note's path, the file and the range from \`wiki_chunks\`, the source's tags, the tag list, and the names and descriptions of the templates. Each returns an Item Map. A \`partial\` chunk goes again, narrower.
3. **Match.** Call \`wiki_match\` with every subject's name at once, aliases included, so a subject named in three chunks is one subject.
4. **Slice.** Put every subject that hits or nears one page into the same slice, so two drafters never write one page. At most eight subjects per slice.
5. **Draft.** For each slice, call \`yami_agent\` with the agent \`drafter\`. The task gives the slice (each subject with its items and its match), the source notes, their tags, the tag list, and the templates. Each returns writes. With one or two slices, draft them yourself from the drafter's brief, \`${f.wikiInternal}/agents/drafter/AGENT.md\`.
6. **Assemble.** One plan for \`wiki_change\`: every drafted write, plus a modify of each source with its \`description\`, \`tags\`, \`authority\`, \`## Summary\`, \`## Structure\` (one line per part, linking the pages that grew from it), and \`status: absorbed\`. For a source that supersedes another, also a modify of the old source with \`status: superseded\`, and the citations of the old source move: give each drafter the \`citations\` of its pages, so its modifies point every \`kept\` citation at the new source with its \`moved\` locator, and read each \`changed\` or \`unknown\` claim against the changed passages. A page that cites the old source and gets no other write still gets a modify that moves its citations. Give the plan a short \`title\` ("Ingest the DINOv2 paper"), \`notes\` (what it does, the coverage, each skipped subject with its reason, and the figure markers the drafters left, which a figures session makes later), and \`session\` (this session document's path). Past 25 new pages, keep the ones with the most claims and list the rest in the notes.
7. **Propose.** Call \`wiki_change\`. It validates the plan, writes it as a change document that waits for a person's approval, and links the change from this session. Nothing in the wiki changes until a person approves it in Obsidian. When the tool refuses, fix the writes it names and call it again. When it returns warnings, links to no note or sections that a template asks for, fix those writes and propose the plan again; the person approves the last proposal and rejects the rest.
8. **End.** Your work ends when the plan is proposed and covers every source. Do not wait for the approval, and do not lint the wiki for the plan's effect: the wiki holds it only after the approval. When a change of this session was rejected, the session's feedback holds the reason: read it, and propose a new plan that answers it.

One plan holds at most 100 writes, about ten sources, or forty chunks. More is several plans, one after another.
`,
    files: { "page-rules.md": pageRules },
  });

  /** A session that absorbs its sources into the wiki. Read-only: the agent changes the wiki only through `wiki_change`, and the run ends when the plan is proposed. */
  readonly ingest = this.flow({
    name: "ingest",
    description: "Absorb the session's sources into cited pages through one change plan, which a person approves.",
    access: "read-only",
    command: false,
    schema: {
      /** The source notes this session absorbs. */
      sources: { type: "links", default: [] },
    },
    skills: [this.ingestSkill],
    agents: [this.extractor, this.drafter],
    policies: [this.cite, this.onePlan, this.onePage, this.voice, this.protectedText],
    promises: [this.changeApplied, this.absorbed, this.clean],
  });

  readonly checkoutSkill = this.skill(checkoutSkill);
  readonly readingListMade = this.promise(readingListMade);

  /** A checkout as a session: the person writes the request in its Request section, and a run makes the reading list. */
  readonly checkout = this.flow({
    name: "checkout",
    description: "A reading list of the wiki's material on a subject, with a copy of each document to mark up.",
    schema: {
      /** The checkout's state: out, then returned. None before the checkout is made. */
      status: { type: "text", values: ["out", "returned"] },
      /** When the checkout was returned. */
      returned: { type: "date" },
    },
    skills: [this.checkoutSkill],
    promises: [this.readingListMade],
    maxIterations: 2,
  });

  readonly importSkill = this.skill(importSkill);
  readonly bundleImported = this.promise(bundleImported);

  /**
   * An import as a session: `importBundle` stages the bundle's notes in the folder of the session's name and
   * writes the Import section, and a run merges them into the wiki through one change plan. Read-only, as an
   * ingest. No command creates one empty: Wiki: import a bundle and `wiki_import` stage one.
   */
  readonly import = this.flow({
    name: "import",
    description: "Merge a bundle of pages and sources, staged in the session's folder, into the wiki through one change plan, which a person approves.",
    access: "read-only",
    command: false,
    schema: {
      /** Where the bundle came from: a folder, an absolute path, or a repository URL. */
      from: { type: "text" },
      /** The staged notes of the bundle, in the session's folder. */
      staged: { type: "links", default: [] },
    },
    skills: [this.importSkill],
    agents: [this.drafter],
    policies: [this.cite, this.onePlan, this.onePage, this.voice, this.protectedText],
    promises: [this.changeApplied, this.bundleImported, this.clean],
  });

  readonly illustrator = this.agent(illustratorAgent);
  readonly figuresSkill = this.skill(figuresSkill);
  readonly figuresMade = this.promise(figuresMade);

  /**
   * A figures session: makes the figures that the pages of its `pages` field mark as missing, or of every
   * page with a marker when the field is empty, and proposes one change that puts them in place. Read-only:
   * a figure is saved through `wiki_figure`, and a page changes only through `wiki_change`.
   */
  readonly figures = this.flow({
    name: "figures",
    description: "Draw the figures that pages mark as missing, save them in the wiki's figures folder, and propose one change plan that puts each in its marker's place.",
    access: "read-only",
    schema: {
      /** The pages to make figures for. Empty: every page with a figure marker. */
      pages: { type: "links", default: [] },
    },
    skills: [this.figuresSkill],
    agents: [this.illustrator],
    policies: [this.cite, this.onePlan, this.voice, this.protectedText],
    promises: [this.changeApplied, this.figuresMade],
    instructions: "With no pages in the Request section or the pages field, make the figures of every page that has a marker.",
  });

  readonly verifier = this.agent(verifierAgent);
  readonly verifySkill = this.skill(verifySkill);
  readonly claimsVerified = this.promise(claimsVerified);

  /**
   * A verify session: reads each citation of the pages of its `pages` field, or of the pages most in need
   * when the field is empty, at its locator in the source's copy, and proposes one change that fixes the claims
   * the sources do not support and sets `verified` on each page. Read-only: a page changes only through
   * `wiki_change`.
   */
  readonly verify = this.flow({
    name: "verify",
    description: "Read each citation of the pages at its place in the source, and propose one change plan that fixes the claims the sources do not support and stamps each page verified.",
    access: "read-only",
    schema: {
      /** The pages to verify. Empty: the pages with a bad citation, then the ones verified longest ago. */
      pages: { type: "links", default: [] },
    },
    skills: [this.verifySkill],
    agents: [this.verifier],
    policies: [this.cite, this.onePlan, this.voice, this.protectedText],
    promises: [this.changeApplied, this.claimsVerified],
    instructions: "With no pages in the Request section or the pages field, verify the pages with a bad-citation finding first, then the ones with no verified date or the oldest one.",
  });

  readonly exportSkill = this.skill({
    name: "export",
    description: "Export a bundle of the wiki's notes around a subject, for another vault or another person: choose the pages that serve the request, and write them with their sources and originals as a folder that Wiki: import a bundle reads.",
    body: `# Export

A bundle is a folder of pages and sources in the wiki's own layout, with the originals the sources embed and a README that lists them. Another vault imports it with Wiki: import a bundle or \`wiki_import\`. Code writes the bundle; you choose what goes in.

1. **The request.** Take it in the user's words: a subject, and how far around it to reach.
2. **One page, by size.** When the request is one subject, call \`wiki_export\` with the page as \`topic\` and a \`size\`: \`minimal\` (the page alone), \`small\` (up to 8 pages), \`medium\` (up to 25), or \`extensive\` (up to 80). Code walks the links from the page and takes the best-connected neighbors first, and every source the pages cite comes along. Choose \`small\` for a hand-out, \`medium\` for a week's reading, \`extensive\` for a course.
3. **A chosen set.** When the request names several subjects, or a selection code cannot make ("my midterm topics", "everything on vision but the datasets"), choose the documents as \`/wiki:checkout\` chooses a reading list: \`wiki_search\` for candidates, read the snippets, keep what serves, stop a branch where it stops serving. Then call \`wiki_export\` with \`documents\`: the paths, pages and sources. The sources the pages cite come along either way.
4. **Where.** \`folder\` is a vault path (default \`exports/<name>\`) or an absolute path outside the vault, as the user names it. Give the bundle a \`name\` when the user does.

End with one line: the folder, and the counts of pages and sources. A bundle inside the vault is not knowledge: the index skips its notes.
`,
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
   * `<internal>/wiki/sessions/<date> <name>.md`, done at once. Only notes of the pages and the sources are
   * checked out. It throws, and writes nothing, for an empty request or a request or
   * notes with a line that would start a section, no document or more than 60, a note that is not knowledge,
   * a document twice, a why that is empty or more than one line, no session and no name, and a session that is
   * no checkout session of the wiki or holds a checkout already. `wiki_checkout` calls it, and returns the
   * `Checkout` as JSON text; its `run` throws the same error, which an agent gets as an error result.
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
      if (!found || !vault.folders.inKnowledge(found)) throw new Error(`${path} is not a note of ${vault.folders.pages}/ or ${vault.folders.sources}/; only knowledge is checked out.`);
      if (originals.includes(found)) throw new Error(`The documents hold ${found} twice.`);
      if (!why?.trim() || why.includes("\n")) throw new Error(`Give ${found} a why of one line.`);
      originals.push(found);
    }
    let session: string;
    if (order.session) {
      session = await this.#checkoutSession(order.session);
      if ((await readDocument(vault, session)).properties.status) throw new Error(`${basename(session)} holds a checkout already.`);
    } else {
      // The date keeps the reading list's name apart from a page of the same subject, so a link by name still finds the page.
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
   * with the reason, and holds back no other. One change, `Return <name>`, proposed and approved in one step
   * since the edits are the person's own, applies the rest. Every copy
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
          await validatePlan(wiki, { title: "Return", writes: [write] }, { person: true });
          writes.push(write);
          done.push(copy);
        } catch (error) {
          if (!(error instanceof InvalidPlan)) throw error;
          skipped.push({ copy, reason: `the wiki refused the edit: ${error.problems[0]!.replace(/^write 1 \([^)]*\): /, "")}` });
        }
      }
    }
    // The edits are the person's own, so a protected text they changed in a copy changes in the wiki too.
    const change = writes.length ? (await wiki.change({ title: `Return ${basename(session)}`, session, writes }, { person: true })).path : undefined;
    if (change) await wiki.approve(change, { person: true });
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
   * A new page of a template, the person's act: the page's name, its description, each required property of
   * the template with its default or an empty value, and a heading for each section, created through a change
   * that the person proposes and approves in one step, so it has a version as any change. It throws for a
   * template the wiki does not have, the source template, a name a file cannot take, a name in use, and an
   * empty description. Returns the page's path. The command Wiki: new page calls it.
   * @example
   * const path = await wiki.newPage({ template: "event", name: "NeurIPS 2025", description: "The 2025 NeurIPS conference." });
   */
  async newPage(options: { template: string; name: string; description: string }): Promise<string> {
    const wiki = this.wiki;
    await wiki.refresh();
    const template = wiki.template(options.template);
    if (!template || template.name === "source") throw new Error(`${options.template} is not a template of a page. The templates are ${wiki.templateNames().filter((n) => n !== "source").join(", ")}.`);
    const name = options.name.trim();
    checkName(name);
    const description = options.description.trim();
    if (!description) throw new Error("A page needs a description: one sentence on what its subject is.");
    const path = `${this.vault.folders.pages}/${name}.md`;
    if (wiki.locate(name) || (await this.vault.exists(path))) throw new Error(`A note named ${name} exists. Give the page another name.`);
    const { properties, body } = pageSkeleton(template, description);
    const proposed = await wiki.change({ title: `New page ${name}`, writes: [{ op: "create", path, properties, body, why: `A new ${template.name}, by the person.` }] }, { person: true });
    await wiki.approve(proposed.path, { person: true });
    return path;
  }

  /**
   * A new template of the person's own, in `<internal>/wiki/templates/<id>/TEMPLATE.md`, from a starter that is
   * valid as written. The id comes from the name. It throws for a name that gives no id, the type of Yami's
   * own documents, and a template that exists. Returns the template's path. The command Wiki: new template calls it.
   */
  async newTemplate(name: string): Promise<string> {
    const id = ID.test(name.trim()) ? name.trim() : idFromName(name);
    if (!id) throw new Error(`"${name}" gives no template name: use letters or digits.`);
    if (RESERVED_TEMPLATE_NAMES.includes(id)) throw new Error(`${id} is the type of Yami's own documents, so no template can take it.`);
    const path = templatePath(this.vault.folders, id);
    if (await this.vault.exists(path)) throw new Error(`The template ${id} exists: ${path}.`);
    await this.vault.write(path, starterTemplate(id));
    this.wiki.invalidate();
    return path;
  }

  /**
   * Writes a bundle of the wiki's notes: around a `topic` by `size` (`selectBundle`), or the `documents` given
   * (`selectDocuments`), to `folder`, a vault path (default `exports/<name>`) or an absolute path outside the
   * vault, with the sources the topics cite and the originals they embed. Each note gets the property `bundle`,
   * so the index skips a bundle inside the vault. It throws, and writes nothing, for a topic that is not one,
   * a document that is not knowledge, no topic and no documents, an unknown size, and a folder under `wiki/`.
   * `wiki_export` calls it, and the command Wiki: export a topic.
   * @example
   * const { folder, topics } = await wiki.exportBundle({ topic: "Reinforcement learning", size: "small" });
   */
  async exportBundle(options: ExportOptions): Promise<WrittenBundle> {
    const { wiki } = this;
    await wiki.refresh();
    let selection: BundleSelection;
    if (options.documents?.length) {
      selection = await selectDocuments(wiki, options.documents);
      if (options.topic) selection.topic = wiki.resolve(options.topic) ?? selection.topic;
    } else if (options.topic) {
      selection = await selectBundle(wiki, options.topic, options.size ?? "medium");
    } else throw new Error("Name a page to export around, or the documents to export.");
    const name = options.name?.trim() || (selection.topic ? basename(selection.topic) : `Bundle ${timestamp().slice(0, 10)}`);
    const folder = options.folder?.trim() || `${EXPORTS}/${name.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim()}`;
    return writeBundle(wiki, selection, folder, { name, originals: options.originals });
  }

  /**
   * Imports a bundle: reads it from `from` (a folder of the vault, an absolute path, or a git repository URL,
   * cloned with the person's own git), copies its originals into the originals folder, creates an
   * `import` session, and stages each note in the session's folder with a line in the session's Import
   * section that says where it stands: `new`, `near` a page, or in `conflict` with a note that holds its path
   * or its name. A note the wiki holds already, as it is, is dropped. When every staged note is new and
   * nothing is near one, it proposes the change itself, as creates, and the session is done: a person
   * approves it. Otherwise a run of the session merges them. It throws, and creates nothing, for a bundle it
   * cannot read or that holds no note. `wiki_import` calls it, and the command Wiki: import a bundle.
   * @example
   * const { session, staged, change } = await wiki.importBundle({ from: "exports/Reinforcement learning" });
   */
  async importBundle(options: ImportOptions): Promise<ImportedBundle> {
    const { vault, wiki } = this;
    const from = options.from.trim();
    if (!from) throw new Error("Give the bundle to import: a folder, an absolute path, or a repository URL.");
    const bundle = await readBundle(vault, from);
    for (const { path, data } of bundle.originals) if (!(await vault.exists(path))) await vault.writeBinary(path, data);
    await wiki.refresh();
    const sourceName = (p: string) => p.replace(/\/+$/, "").split(/[\\/]/).filter(Boolean).pop() ?? p;
    // A bundle folder inside the vault is indexed as any folder is, so its own notes are no match for its notes.
    const own = !isAbsolute(from) && !isRepository(from) ? `${from.replace(/\/+$/, "")}/` : undefined;
    const outside = (path: string) => !own || !path.startsWith(own);
    const name = bundle.name ?? sourceName(from.replace(/\.git$/, ""));
    const staged: StagedNote[] = [];
    const dropped: ImportedBundle["dropped"] = [];
    const plan: { note: (typeof bundle.notes)[number]; status: StagedNote["status"]; with: string[]; reason: string }[] = [];
    for (const note of bundle.notes) {
      const existing = wiki.note(note.path);
      if (existing) {
        if ((await bodyHash(existing.body)) === (await bodyHash(note.body)) && existing.description === String(note.properties.description ?? "")) {
          dropped.push({ target: note.path, reason: "the wiki holds it already, as it is" });
          continue;
        }
        plan.push({ note, status: "conflict", with: [existing.path], reason: `a note holds this path with another text: merge into ${link(existing.path)}` });
        continue;
      }
      const names = [basename(note.path), ...(Array.isArray(note.properties.aliases) ? note.properties.aliases.map(String) : [])];
      const matches = await wiki.match(names, { types: [note.type] });
      const hit = matches.find((m) => m.match === "hit" && m.path && m.path !== note.path && outside(m.path));
      if (hit) {
        plan.push({ note, status: "conflict", with: [hit.path!], reason: `${link(hit.path!)} holds the name "${hit.name}": the same subject, or another that needs a name of its own` });
        continue;
      }
      const near = [...new Set(matches.flatMap((m) => (m.match === "near" ? m.neighbors.map((n) => n.path).filter(outside) : [])))];
      if (near.length) {
        plan.push({ note, status: "near", with: near, reason: `near ${near.map(link).join(", ")}: the same subject, or a neighbor to link` });
        continue;
      }
      plan.push({ note, status: "new", with: [], reason: "new to this wiki" });
    }
    const session = (await this.import.create({ name: options.name ?? `Import ${name} ${timestamp().slice(0, 10)}`, request: `Merge the bundle ${from} into the wiki.`, fields: { from } })).path;
    const folder = stagingFolder(session);
    for (const entry of plan) {
      const path = `${folder}/${basename(entry.note.path)}.md`;
      await writeDocument(vault, { path, properties: entry.note.properties, body: entry.note.body });
      staged.push({ staged: path, target: entry.note.path, type: entry.note.type, status: entry.status, with: entry.with, reason: entry.reason });
    }
    const lines = [
      ...staged.map((s) => `- ${link(s.staged)} → \`${s.target}\` · **${s.status}** · ${s.reason}`),
      ...dropped.map((d) => `- \`${d.target}\` · dropped · ${d.reason}`),
      ...bundle.skipped.map((k) => `- \`${k.path}\` · skipped · ${k.reason}`),
    ];
    const direct = staged.length > 0 && staged.every((s) => s.status === "new");
    await updateDocument(vault, session, (doc) => {
      doc.properties.staged = staged.map((s) => link(s.staged));
      doc.body = replaceSection(doc.body, "Import", lines.join("\n") || "The bundle brought nothing that the wiki lacks.");
      if (!staged.length || direct) doc.properties.state = "done";
    });
    let change: string | undefined;
    if (direct) {
      const writes: Write[] = staged.map((s) => {
        const { type: _type, ...properties } = plan.find((p) => p.note.path === s.target)!.note.properties;
        return { op: "create", path: s.target, properties, body: plan.find((p) => p.note.path === s.target)!.note.body, why: `imported from ${name}` };
      });
      change = (await wiki.change({ title: `Import ${name}`, notes: `Every note of the bundle is new to this wiki, so code proposed the plan at once.${dropped.length ? ` Dropped, as the wiki holds them already: ${dropped.map((d) => basename(d.target)).join(", ")}.` : ""}`, session, writes })).path;
    }
    return { session, name, staged, dropped, skipped: bundle.skipped, ...(change && { change }) };
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

  /** Moves the pages of a wiki from before yami 0.24 to the pages folder, then installs the module's documents. */
  async install(): Promise<ModuleProblem[]> {
    await moveLegacyTopics(this.vault);
    return super.install();
  }

  tools(): AgentTool[] {
    const wiki = this.wiki;
    const { pages: PAGES, sources: SOURCES, templates: TEMPLATES, changes: CHANGES, figures: FIGURES, wiki: WIKI } = this.vault.folders;
    return [
      defineTool({
        name: "search",
        readOnly: true,
        description: `Ranked search over every note of the vault. Returns notes with a score in [0, 1], a snippet, and why each ranks. Filter by types (a page's template such as topic or event, page for every page, source, …), tags (a note must hold every one, or a tag below it), and folder. With seeds and no text, it returns the notes related to the seeds through links. Algorithms: ${Object.keys(algorithms).join(", ")}. To answer a question: search, read the best notes with Read, follow a link one hop when needed, then answer with a [[link]] on each claim.`,
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
        description: `Where each name stands in the wiki: hit (a page or a source holds the name or an alias, with its path), near (notes above the similarity threshold, as neighbors), or new. Call it with every subject of a source at once, before you draft.`,
        input: {
          names: z.array(z.string()).min(1).describe("The names to match, each with its aliases joined by a space when useful."),
          types: z.array(z.string()).optional().describe("The note types to match against: a template's name, page for every page, or source. Default: page and source."),
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
        description: "The health of the notes: dead links, duplicate names, missing descriptions, pages that their template does not fit (bad-property, missing-section, unknown-template, and the template's checks), stubs to write, uncited sources, orphan pages, figures still to make, pages in the voice of a report, citations that lead nowhere, and citations of a superseded source. Each finding names its fix. Errors fail the clean-pages promise; warnings are worth a look; info is a to-do. Reads only.",
        input: {
          paths: z.array(z.string()).optional().describe("Check only these notes, as paths or [[link]] names."),
          folder: z.string().optional().describe(`Check only this folder, for example ${PAGES}.`),
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
        description: "The tags of the vault's notes with the count of notes that hold each, most used first. The vocabulary for new pages.",
        input: {},
        title: () => "List the wiki's tags",
        run: async () => {
          await wiki.refresh();
          return JSON.stringify({ tags: wiki.tags() });
        },
      }),
      defineTool({
        name: "templates",
        readOnly: true,
        description: `The templates of the wiki's pages: the vault's own in ${TEMPLATES}/, and the built-in ones it has no copy of. Each with its name, which is the type of its pages, its description, the path of its TEMPLATE.md (read it before you write a page of it: it says when to use the template and how to write each section), its own properties, its sections in order, whether its pages cite sources, and its checks. Problems names the templates that do not read, and why.`,
        input: {},
        title: () => "List the wiki's templates",
        run: async () => {
          await wiki.refresh();
          const templates = (await wiki.templates()).map(({ body: _body, ...template }) => template);
          return JSON.stringify({ templates, problems: wiki.templateProblems });
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
        description: `Splits a source's original for the workers of an ingest: a text file into runs of at most 800 lines, a PDF into 20 pages at a time, any other file whole. A source with a text, such as the slides of a .pptx, is split as that text. Returns the file to read and each chunk's range and locator. Workers read a range with their Read tool. For a source that supersedes an earlier capture of its file (both texts), the chunks are the changed passages alone, with delta true, the removed runs of the old text, and each citation of the old source in the pages with where it stands: kept with its new locator, changed, or unknown.`,
        input: {
          source: z.string().describe("The source note, as a path or a [[link]] name."),
        },
        title: ({ source }) => `Chunk ${source.slice(0, 60)}`,
        run: async ({ source }) => {
          await wiki.refresh();
          return JSON.stringify(await deltaChunks(wiki.vault, wiki, source));
        },
      }),
      defineTool({
        name: "citations",
        readOnly: true,
        description: `The citations of a page, each with the claim it ends, the source note, the file to read (the frozen copy, or its text), and the lines or pages its locator names, so a verifier reads the source at that place. A citation that code can see leads nowhere, a locator past the file or a note that is not a source, says so in problem. A verify session calls it for each page.`,
        input: {
          topic: z.string().describe("The page, as a path or a [[link]] name."),
        },
        title: ({ topic }) => `Citations of ${topic.slice(0, 60)}`,
        run: async ({ topic }) => {
          await wiki.refresh();
          const path = wiki.resolve(topic);
          const note = path ? wiki.note(path) : undefined;
          if (!note || !wiki.isPage(note)) throw new Error(`${topic} is not a page of the wiki.`);
          const resolved = await resolveCitations(wiki.vault, wiki, note);
          return JSON.stringify({ topic: note.path, verified: note.properties.verified ?? null, citations: resolved.map(({ from: _from, to: _to, ...rest }) => rest) });
        },
      }),
      defineTool({
        name: "change",
        description: `The only way the wiki changes: proposes one plan, which a person approves in Obsidian before anything is written. Takes a title, notes, the session document's path, and writes (create: path, properties, body; modify: path, the properties that change with null to remove one, and the whole new body or none; remove: path), each with a why. Validates the plan (paths under ${PAGES}/ or ${SOURCES}/, a description on every note, and the properties of each page's template, which its type names: topic when it names none), writes the change document to ${CHANGES}/ with status proposed, and links it from the session. Returns the change document's path, the counts, and warnings for links to no note and for sections that a page's template asks for. Refuses an invalid plan with the write and the rule, and writes nothing. Nothing in ${PAGES}/ or ${SOURCES}/ changes until the person approves; do not wait for that.`,
        input: {
          title: z.string().describe("A short name: the file name of the change document."),
          notes: z.string().optional().describe("What the change does and why, the coverage, and each skipped subject with its reason."),
          session: z.string().optional().describe("The session document, as a vault path. The change links from it."),
          writes: z
            .array(
              z.object({
                op: z.enum(["create", "modify", "remove"]),
                path: z.string().describe(`The note, under ${PAGES}/ or ${SOURCES}/.`),
                properties: z.record(z.string(), z.unknown()).optional().describe("create: every property, type first: the page's template. modify: the properties that change; null removes one. A modify that sets type moves the page to another template."),
                body: z.string().optional().describe("create: the body. modify: the whole new body, or none to keep it."),
                why: z.string().optional().describe("One line on why the change makes this write."),
              }),
            )
            .min(1),
        },
        title: ({ title, writes }) => `Propose a change to the wiki: ${title.slice(0, 50)} (${writes.length} writes)`,
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
        name: "ingest",
        description: `Ingests files into the wiki: captures each file as a source, creates an ingest session that links the sources, and starts its run, which reads them with workers and ends when it proposes one change plan for a person to approve. Name the files as vault paths or as absolute paths, also of files outside the vault, or name one folder, whose every file it takes. A .pptx or a .docx is captured with its text, so the run can read it. Returns the session's path and its sources at once: the run goes on in its own session, so do not wait for it, and do not read or ingest the files yourself. Refuses a file it cannot read, and creates nothing then.`,
        input: {
          files: z.array(z.string()).optional().describe("The files: vault paths, or absolute paths."),
          folder: z.string().optional().describe("A folder instead of files: a vault path, or an absolute path."),
          name: z.string().optional().describe("The session's name. Default: Ingest <what> <date>."),
        },
        title: ({ files, folder }) => `Ingest ${folder ?? (files ?? []).map((f) => f.slice(f.lastIndexOf("/") + 1)).join(", ").slice(0, 60)}`,
        run: async ({ files, folder, name }) => {
          if (!folder === !files?.length) return { text: "Name the files, or one folder.", isError: true };
          const session = await this.yami.ingest({ files, folder, name });
          const sources = (await session.read()).properties.sources;
          void session.start().catch((error: unknown) => console.error(`yami: the run of ${session.path} failed`, error));
          return JSON.stringify({ session: session.path, sources, run: "started" });
        },
      }),
      defineTool({
        name: "figure",
        description: `Saves a figure for a page under ${FIGURES}/<page>/<name>.svg or .png, and returns its path and the line that embeds it. Give the figure as svg text (one <svg> with a viewBox, no script, no event handler, no reference outside itself) or as png bytes in base64. Refuses a page that is not one, a bad SVG or PNG, a file over 1 MB (SVG) or 4 MB (PNG), and a name in use unless replace is set. The page embeds the figure through wiki_change, as any write.`,
        input: {
          topic: z.string().describe("The page the figure is for, as a path or a [[link]] name."),
          name: z.string().describe("The file name without its extension, such as encoder-decoder."),
          svg: z.string().optional().describe("The figure as SVG text."),
          png: z.string().optional().describe("The figure as PNG bytes in base64, when it was rendered or cropped with a tool."),
          replace: z.boolean().optional().describe("Replace a figure of that name. Default false."),
        },
        title: ({ topic, name }) => `Save the figure ${name.slice(0, 40)} for ${topic.slice(0, 40)}`,
        run: async (figure) => {
          await wiki.refresh();
          const path = wiki.resolve(figure.topic);
          const topic = path && wiki.isPage(path) ? path : undefined;
          return JSON.stringify(await saveFigure(wiki.vault, topic, figure));
        },
      }),
      defineTool({
        name: "export",
        description: `Writes a bundle of the wiki's notes for another vault or another person: a folder in the wiki's layout with the pages, the sources they cite, the originals the sources embed, and a README. Give a page as topic and a size (${BUNDLE_SIZES.join(", ")}: the page alone, up to 8 pages, 25, or 80, the best-connected neighbors first), or the documents to export as paths. The folder is a vault path (default ${EXPORTS}/<name>) or an absolute path outside the vault. The skill /wiki:export says how to choose. Returns the folder and what it holds, with the pages as topics; refuses a page that is not one, a document that is not knowledge, or a folder under ${WIKI}/.`,
        input: {
          topic: z.string().optional().describe("The page to export around, as a path or a [[link]] name."),
          size: z.enum(BUNDLE_SIZES).optional().describe("How far to reach from the page. Default medium."),
          documents: z.array(z.string()).optional().describe("Instead of a page and a size: the pages and sources to export, as paths or [[link]] names."),
          folder: z.string().optional().describe(`Where to write: a vault path, or an absolute path. Default ${EXPORTS}/<name>.`),
          name: z.string().optional().describe("The bundle's name. Default: the page's."),
        },
        title: ({ topic, documents, size }) => `Export ${topic ? `${topic.slice(0, 50)} (${size ?? "medium"})` : `${documents?.length ?? 0} documents`}`,
        run: async (options) => JSON.stringify(await this.exportBundle(options)),
      }),
      defineTool({
        name: "import",
        description: `Imports a bundle of pages and sources into the wiki: reads it from a folder of the vault, an absolute path, or a git repository URL (cloned with the person's git), copies its originals, stages its notes in an import session, and says where each stands against the wiki. When every note is new and nothing is near one, it proposes the change at once; otherwise it starts the session's run, which merges them and proposes one plan. Nothing in the wiki changes until a person approves. Returns the session, the staged notes with their status, the notes dropped as already held, and the change when one was proposed; do not merge the notes yourself. Refuses a folder it cannot read or that holds no page or source.`,
        input: {
          from: z.string().describe("The bundle: a vault folder, an absolute path, or a repository URL such as https://github.com/owner/repo or …/tree/<branch>/<folder>."),
          name: z.string().optional().describe("The session's name. Default: Import <bundle> <date>."),
        },
        title: ({ from }) => `Import ${from.slice(from.lastIndexOf("/") + 1).slice(0, 60) || from.slice(0, 60)}`,
        run: async (options) => {
          const result = await this.importBundle(options);
          const session = this.yami.session(result.session);
          const run = result.change || !result.staged.length ? "not needed" : "started";
          if (run === "started") void session.start().catch((error: unknown) => console.error(`yami: the run of ${session.path} failed`, error));
          return JSON.stringify({ ...result, run });
        },
      }),
      defineTool({
        name: "checkout",
        description: `Makes a checkout: a reading list, and a copy of each document in the folder of the list's name, for the user to read and mark up. In a checkout session, the session document becomes the reading list; otherwise the reading list is ${this.layout.sessions}/<date> <name>.md. Takes the user's request, the documents in reading order (each a note of ${PAGES}/ or ${SOURCES}/, with a why of one line), and notes on what was left out. At most ${MAX_DOCUMENTS} documents. The skill /wiki:checkout says how to choose and order them. Returns the reading list's path as session and the copies' paths in reading order as copies; refuses an order with the reason, and writes nothing.`,
        input: orderShape,
        title: ({ name, session, documents }) => `Check out ${name ?? (session ? basename(session) : "")} (${documents.length} documents)`,
        run: async (order) => JSON.stringify(await this.makeCheckout(order)),
      }),
    ];
  }
}
