/**
 * An ingest asked for in a conversation, with a real Claude Code: the conversation calls `wiki_ingest` on a
 * deck outside the vault, the ingest session reads the deck's text through its extractor and drafter agents
 * with `yami_agent`, and proposes one change. It takes some minutes and costs a real run, so it runs only on
 * request:
 *
 *   YAMI_LIVE_INGEST=1 npm run test:live
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ClaudeAgent } from "../../src/agent/claude.js";
import { FileConversations } from "../../src/conversation/index.js";
import { linksOf, readDocument } from "../../src/document/index.js";
import { Yami } from "../../src/index.js";
import { FsVault } from "../../src/testing/index.js";
import { lecture } from "../fixtures/office.js";

describe.runIf(process.env.YAMI_LIVE_INGEST)("an ingest with a real agent", () => {
  it("goes from a conversation to a proposed change, through wiki_ingest and the extractor and drafter agents", { timeout: 1_800_000 }, async () => {
    const root = mkdtempSync(path.join(tmpdir(), "yami-ingest-"));
    const course = path.join(root, "course");
    mkdirSync(course);
    const deck = path.join(course, "Verification.pptx");
    // Enough exercises that the text runs past one chunk of 800 lines, so the lead sends extractors.
    writeFileSync(deck, await lecture(120));
    const vault = new FsVault(path.join(root, "vault"));
    mkdirSync(vault.root);
    const agent = new ClaudeAgent({ preferences: { effort: "low" } });
    const yami = new Yami({ vault, agents: [agent], conversations: new FileConversations(vault, async () => "allow") });
    await yami.enable();
    expect(yami.problems).toEqual([]);

    const conversation = await agent.startSession({ onPermission: async () => "allow" });
    const reply = await conversation.send(`Ingest "${deck}" into the knowledge base.`);
    await conversation.close();
    expect(reply.status).toBe("completed");

    const sessions = await yami.sessions(yami.module("wiki")!);
    expect(sessions).toHaveLength(1);
    const session = sessions[0]!;
    await vi.waitFor(async () => expect(["done", "failed", "stopped", "needs-attention"]).toContain(await session.status()), { timeout: 1_500_000, interval: 5_000 });
    const details = await session.details();
    await yami.close();

    const doc = await session.read();
    console.log(`state ${await session.status()}; changes ${JSON.stringify(doc.properties.changes)}; runs ${details.agentRuns.map((r) => `${r.agent} ${r.status}`).join(", ")}`);
    expect(await session.status()).toBe("done");
    const [source] = linksOf(doc.properties.sources);
    const note = await readDocument(vault, `${source}.md`);
    expect(note.properties.from).toBe(deck);
    expect(String(note.properties.text)).toMatch(/^\[\[internal\/wiki\/originals\/[0-9a-f]{16}\.md\]\]$/);
    expect(linksOf(doc.properties.changes).length).toBeGreaterThan(0);
    expect(details.agentRuns.filter((run) => run.agent === "wiki:extractor" && run.status === "done").length).toBeGreaterThan(1);
    for (const run of details.agentRuns) expect(run.status, run.agent).toBe("done");
  });
});
