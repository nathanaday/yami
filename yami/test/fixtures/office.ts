/** Office files built in memory, for the tests of the text that a capture makes of them. */

/** A zip archive of the entries, the first stored and the rest deflated, as Office writes them. */
export async function zip(entries: Record<string, string | Uint8Array>): Promise<Uint8Array> {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [i, [name, content]] of Object.entries(entries).entries()) {
    const data = typeof content === "string" ? new TextEncoder().encode(content) : content;
    const method = i === 0 ? 0 : 8;
    const stored = method === 0 ? data : new Uint8Array(await new Response(new Blob([data.slice().buffer as ArrayBuffer]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
    const file = new TextEncoder().encode(name);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true);
    head.setUint16(8, method, true);
    head.setUint32(18, stored.length, true);
    head.setUint32(22, data.length, true);
    head.setUint16(26, file.length, true);
    local.push(new Uint8Array(head.buffer), file, stored);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(10, method, true);
    entry.setUint32(20, stored.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, file.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), file);
    offset += 30 + file.length + stored.length;
  }
  const size = central.reduce((n, part) => n + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, Object.keys(entries).length, true);
  end.setUint16(10, Object.keys(entries).length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  const parts = [...local, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
export const rel = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
export const rels = (...items: string[]) => `<?xml version="1.0"?><Relationships>${items.join("")}</Relationships>`;
const shape = (ph: string, paragraphs: string) => `<p:sp><p:nvSpPr><p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:txBody>${paragraphs}</p:txBody></p:sp>`;
const para = (text: string, level = 0) => `<a:p>${level ? `<a:pPr lvl="${level}"/>` : ""}<a:r><a:t>${text}</a:t></a:r></a:p>`;

/** A deck of two slides: a title after its body, levels, math with a fallback picture, a slide number, a picture, a table, notes, and a hidden slide with a drawing. */
export function deck() {
  const slide1 = `<?xml version="1.0"?><p:sld><p:cSld><p:spTree>
    ${shape('<p:ph idx="1"/>', `${para("Safety &amp; liveness")}${para("Invariants", 1)}<a:p><a:r><a:t>State </a:t></a:r><a14:m><m:oMath><m:sSub><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sub><m:r><m:t>0</m:t></m:r></m:sub></m:sSub></m:oMath></a14:m></a:p>`)}
    <mc:AlternateContent><mc:Choice Requires="a14">${shape("", para("Chosen"))}</mc:Choice><mc:Fallback><p:pic><p:blipFill><a:blip r:embed="rId9"/></p:blipFill></p:pic></mc:Fallback></mc:AlternateContent>
    ${shape('<p:ph type="title"/>', para("Transition systems"))}
    ${shape('<p:ph type="sldNum" idx="12"/>', '<a:p><a:fld id="{1}" type="slidenum"><a:t>1</a:t></a:fld></a:p>')}
    <p:pic><p:blipFill><a:blip r:embed="rId2"/></p:blipFill></p:pic>
    <p:pic><p:blipFill><a:blip r:embed="rId3"/></p:blipFill></p:pic>
    <p:graphicFrame><a:tbl><a:tr><a:tc><a:txBody>${para("State")}</a:txBody></a:tc><a:tc><a:txBody>${para("Next")}</a:txBody></a:tc></a:tr><a:tr><a:tc><a:txBody>${para("off")}</a:txBody></a:tc><a:tc><a:txBody>${para("on")}</a:txBody></a:tc></a:tr></a:tbl></p:graphicFrame>
  </p:spTree></p:cSld></p:sld>`;
  const slide2 = `<?xml version="1.0"?><p:sld show="0"><p:cSld><p:spTree>${shape('<p:ph type="title"/>', para("A graph"))}<p:sp/><p:sp/><p:cxnSp/></p:spTree></p:cSld></p:sld>`;
  const notes = `<?xml version="1.0"?><p:notes><p:cSld><p:spTree>${shape('<p:ph type="sldImg"/>', "")}${shape('<p:ph type="body" idx="1"/>', para("Say why it matters."))}${shape('<p:ph type="sldNum"/>', para("1"))}</p:spTree></p:cSld></p:notes>`;
  return zip({
    "[Content_Types].xml": "<Types/>",
    "ppt/presentation.xml": '<p:presentation><p:sldIdLst><p:sldId id="256" r:id="rId7"/><p:sldId id="257" r:id="rId8"/></p:sldIdLst></p:presentation>',
    "ppt/_rels/presentation.xml.rels": rels(rel("rId8", "slide", "slides/slide1.xml"), rel("rId7", "slide", "slides/slide2.xml")),
    // The order of the slide list wins over the file names: rId7 is the first slide.
    "ppt/slides/slide2.xml": slide1,
    "ppt/slides/_rels/slide2.xml.rels": rels(rel("rId2", "image", "../media/image1.png"), rel("rId3", "image", "../media/image2.emf"), rel("rId9", "image", "../media/fallback.png"), rel("rId4", "notesSlide", "../notesSlides/notesSlide1.xml")),
    "ppt/slides/slide1.xml": slide2,
    "ppt/notesSlides/notesSlide1.xml": notes,
    "ppt/media/image1.png": PNG,
    "ppt/media/image2.emf": new Uint8Array([1]),
    "ppt/media/fallback.png": PNG,
  });
}

/**
 * A lecture with something to learn, for a live ingest: three slides of content, then `exercises` slides of
 * worked exercises, so its text runs past one chunk.
 */
export function lecture(exercises = 0) {
  const slide = (title: string, ...lines: string[]) => `<?xml version="1.0"?><p:sld><p:cSld><p:spTree>${shape('<p:ph type="title"/>', para(title))}${shape('<p:ph idx="1"/>', lines.map((l) => para(l)).join(""))}</p:spTree></p:cSld></p:sld>`;
  const ids = Array.from({ length: 3 + exercises }, (_, i) => i + 1);
  const exercise = (n: number) =>
    slide(`Exercise ${n}`, `A counter x starts at 0 and adds ${n} at each step while x &lt; ${10 * n}, then resets to 0.`, `Claim: 0 &lt;= x &lt; ${11 * n} is an invariant of the counter.`, `The claim is inductive: the initial state satisfies it, and a step from a state that satisfies it reaches a state that satisfies it.`, `So the reachable states of the counter number ${10 + 1}.`, `A model checker finds the same result by computing the reachable states breadth first.`);
  return zip({
    "[Content_Types].xml": "<Types/>",
    "ppt/presentation.xml": `<p:presentation><p:sldIdLst>${ids.map((n) => `<p:sldId id="${255 + n}" r:id="rId${n}"/>`).join("")}</p:sldIdLst></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": rels(...ids.map((n) => rel(`rId${n}`, "slide", `slides/slide${n}.xml`))),
    "ppt/slides/slide1.xml": slide("Inductive invariants", "An invariant holds in every reachable state of a transition system.", "An inductive invariant holds in the initial states and is preserved by every transition.", "Every inductive invariant is an invariant; the converse is false."),
    "ppt/slides/slide2.xml": slide("Strengthening", "To prove a safety invariant that is not inductive, find a stronger inductive invariant that implies it.", "Example: 0 &lt;= y &lt;= m is not inductive, but (0 &lt;= y &lt;= m) and (x + y = m) is."),
    "ppt/slides/slide3.xml": slide("Kripke structures", "A Kripke structure is a transition system whose states are labeled with the atomic propositions true in them.", "Model checkers such as NuSMV check CTL formulas over Kripke structures."),
    ...Object.fromEntries(ids.slice(3).map((n) => [`ppt/slides/slide${n}.xml`, exercise(n - 3)])),
  });
}
