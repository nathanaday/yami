import type { Folders } from "../document/folders.js";

/**
 * The texts of the templates that the wiki module installs, by name. A vault without its own copy of one,
 * such as one with no wiki module, reads the library's text instead. `topic` is the template of a page with no
 * type, and the wiki needs `source` and `stub` for its own work, so neither can go.
 */
export const BUILT_IN_TEMPLATES: Readonly<Record<string, (folders: Folders) => string>> = {
  topic: (_f) => `---
name: topic
description: The article on one subject, an idea or a named thing, that states what is known of it with citations.
properties: {}
sections: [Definition, Explanation, Related, Sources, Notes]
cites: true
checks: []
---
# Topic

A topic is the article on one subject: an idea, a method, a pattern, or a named thing such as a tool, a person, or a dataset. It is the page that no other template fits.

## When to use

- The subject is one thing, and it has a name that the sources use.
- The sources say what the subject is, how it works, or how it relates to other subjects.

## When not to use

- A dated happening that is a subject in itself: an **event**.
- Many terms of one field, each with a short definition: a **glossary**.
- A set of things that a rule defines: a **list**. Dated entries in order: a **timeline**.
- Links to the pages of a tag, with no claims: a **portal**.
- A subject that the sources name but say too little about: a **stub**.

## Sections

- **Definition**: two or three sentences on what the subject is.
- **Explanation**: what is known of the subject, in the order of the subject, not of a source. Add \`###\` subsections as the subject needs.
- **Related**: links to related pages, each with a few words on how it relates.
- **Sources**: each cited source, with one line on what it gives.
- **Notes**: the person's own. An agent never changes it.

## Skeleton

\`\`\`markdown
---
type: topic
description: One sentence on what the subject is.
tags: [ml/self-supervised]
aliases: [SSL]
sources: ["[[DINOv2 (source)]]"]
status: draft
---
## Definition

Self-supervised learning trains a model on data with no labels ([[DINOv2 (source)]], p. 3).

## Explanation

## Related

- [[Contrastive learning]]: one family of self-supervised methods.

## Sources

- [[DINOv2 (source)]]: the training recipe and the results.

## Notes
\`\`\`
`,
  event: (_f) => `---
name: event
description: A dated happening that is a subject in itself, such as a conference, a talk, a report, a release, or an incident.
properties:
  date: {type: date, required: true}
  end: {type: date}
  location: {type: text}
  people: {type: list}
  series: {type: link}
sections: [Summary, Proceedings, Related, Sources, Notes]
cites: true
checks: []
---
# Event

An event is the article on one happening with a date: a conference, a lecture, a meeting, a published report, a release, an incident.

## When to use

- The happening itself is a subject: a reader would look it up by its name or its date.
- The sources say when it happened, and what happened at it.

## When not to use

- The material of the happening is a source, not an event: the slides of a talk, the text of a report, the recording of a lecture. Capture it as a source. Write an event too only when the happening itself is a subject, and cite the source from it.
- An idea that the happening introduced is a **topic** of its own. The event links it.
- Many events in order are a **timeline**, which links each event.

## Properties

- \`date\`: when it happened, or when it started: \`2026-03-14\`. A year or a month alone is allowed: \`2026\`, \`2026-03\`.
- \`end\`: the last day of an event of more than one day.
- \`location\`: where it happened, as text.
- \`people\`: the speakers, the authors, or the organizers, as links where they have pages.
- \`series\`: the recurring event or the timeline that it belongs to, as a link.

## Sections

- **Summary**: two or three sentences: what happened, when, where, and why it matters.
- **Proceedings**: what happened, in order. Add \`###\` subsections for the parts of a long event.
- **Related**: links to the topics it introduced or discussed, and to the events before and after it.
- **Sources**: each cited source, with one line on what it gives.
- **Notes**: the person's own. An agent never changes it.

Other sections may go between them, as the event needs: **Background** (what led to it), **Outcomes** (what it decided or changed), **Quotes** (exact words, each cited with its locator), **Media** (pictures, each with an italic caption line that cites its source).

## Skeleton

\`\`\`markdown
---
type: event
description: One sentence on what happened, and when.
tags: [conferences/ml]
sources: ["[[NeurIPS 2025 keynote slides (source)]]"]
date: 2025-12-02
end: 2025-12-07
location: San Diego
people: ["[[Jane Doe]]"]
series: "[[NeurIPS]]"
status: draft
---
## Summary

## Proceedings

## Related

## Sources

## Notes
\`\`\`
`,
  glossary: (_f) => `---
name: glossary
description: The vocabulary of one subject, each term with a short definition and its citation.
properties:
  subject: {type: link}
sections: [Terms, Related, Sources, Notes]
cites: true
checks: []
---
# Glossary

A glossary gives the terms of one subject, each with a short definition. A reader comes to it to look up a word.

## When to use

- A subject has many terms that a reader must know, and most of them need a sentence or two, not a page.
- The sources define the terms, or use them in a way that defines them.

## When not to use

- A term that needs an explanation, examples, or a history has its own **topic**. The glossary gives the short definition and links the topic.
- A set of things that are not terms, such as tools or devices: a **list**.

## Properties

- \`subject\`: the page whose vocabulary the glossary gives, as a link, when the wiki has one.

## Sections

- **Terms**: one \`###\` heading for each term, in alphabetical order, with its definition below in one to three sentences and the citation in parentheses. The heading is the term, so \`[[Glossary of reinforcement learning#Return]]\` links one term. Give an alias or an abbreviation in the definition: "Also called …". When the term has its own page, end the definition with a link to it.
- **Related**: links to the subject's page and to related glossaries.
- **Sources**: each cited source, with one line on what it gives.
- **Notes**: the person's own. An agent never changes it.

## Skeleton

\`\`\`markdown
---
type: glossary
description: The terms of reinforcement learning, each with a short definition.
tags: [ml/rl]
sources: ["[[Sutton and Barto (source)]]"]
subject: "[[Reinforcement learning]]"
status: draft
---
## Terms

### Policy

A mapping from the states of an environment to the actions an agent takes in them ([[Sutton and Barto (source)]], p. 6).

### Return

The sum of the rewards from a time step on, often discounted ([[Sutton and Barto (source)]], p. 55). See [[Return (reinforcement learning)]].

## Related

## Sources

## Notes
\`\`\`
`,
  list: (_f) => `---
name: list
description: A set of things that one rule defines, such as the devices a product supports, each item with its citation.
properties:
  subject: {type: link}
sections: [Criteria, Items, Related, Sources, Notes]
cites: true
checks: []
---
# List

A list gives the members of one set: the devices a product supports, the datasets of a benchmark, the releases of a library. A rule says what belongs on it.

## When to use

- The set has a rule that decides each member, and a reader wants to see the members together.
- The sources name the members, or give the facts that put each one on the list.

## When not to use

- Members in the order of their dates, where the order is the point: a **timeline**.
- Terms with definitions: a **glossary**.
- Links to every page of a tag, with no rule but the tag: a **portal**.

## Properties

- \`subject\`: the page that the set belongs to, as a link, when the wiki has one.

## Sections

- **Criteria**: the rule that puts a member on the list, in one to three sentences, with its citation when a source gives it.
- **Items**: one line for each member: its link when it has a page, or its name, then what puts it on the list, and the citation. Use a table when each member has the same few facts.
- **Related**: links to the subject's page and to related lists.
- **Sources**: each cited source, with one line on what it gives.
- **Notes**: the person's own. An agent never changes it.

## Skeleton

\`\`\`markdown
---
type: list
description: The devices that run the plugin's mobile build.
tags: [obsidian/mobile]
sources: ["[[Mobile test report (source)]]"]
subject: "[[Duet]]"
status: draft
---
## Criteria

A device is on the list when the mobile build passed its test suite on it ([[Mobile test report (source)]], p. 1).

## Items

- [[iPad Pro]]: iPadOS 18, all tests passed ([[Mobile test report (source)]], p. 2).
- Pixel 8: Android 15, all tests passed ([[Mobile test report (source)]], p. 3).

## Related

## Sources

## Notes
\`\`\`
`,
  portal: (_f) => `---
name: portal
description: The entrance to the pages of one tag, which groups and links them and makes no claims of its own.
properties:
  tag: {type: text, required: true}
sections: [Introduction]
cites: false
checks: [coverage]
---
# Portal

A portal is the entrance to one area of the wiki: the pages of one tag, grouped and linked, so a reader finds where to start. It links pages and makes no claims, so it cites no sources.

## When to use

- A tag holds enough pages that a reader needs a map of them.
- One portal for each tag. The tag navigator walks the tags too; a portal adds the groups and the order that a reader needs.

## When not to use

- An article on the subject of the tag: a **topic**, which the portal links first.
- A set that a rule defines, other than the tag: a **list**.

## Properties

- \`tag\`: the tag that the portal opens, such as \`ml/vision\`. Lint (the check \`coverage\`) lists the pages under the tag that the portal does not link, so a portal that falls behind its tag says so.

## Sections

- **Introduction**: two or three sentences on the area, and a link to the topic of the tag's subject when the wiki has one.

Then one \`##\` section for each group of pages, named for the group, such as "Methods" or "Datasets". Under each, one line for each page: its link, and a few words on what it gives. Order the groups and the pages from the basics to the details. End with **Notes**, the person's own, when the person wants one.

## Skeleton

\`\`\`markdown
---
type: portal
description: The entrance to the pages on computer vision.
tags: [ml/vision]
tag: ml/vision
status: draft
---
## Introduction

Computer vision is the area of machine learning that works with images and video. [[Computer vision]] is the place to start.

## Methods

- [[Vision transformer]]: images as sequences of patches.

## Datasets

- [[ImageNet]]: the benchmark of image classification.
\`\`\`
`,
  stub: (_f) => `---
name: stub
description: A subject planted before its kind of page is known, which becomes a page of any other template.
properties:
  becomes: {type: text}
sections: []
cites: false
checks: []
---
# Stub

A stub plants a subject in the wiki before anyone knows what kind of page it will be. It holds a name, a description, and what is known so far. Lint lists the stubs, so they are the wiki's to-do list.

## When to use

- A person wants to note a subject now and write it later.
- The sources name a subject, and other pages link it, but the sources say too little to fill the sections of any other template.

## When not to use

- The kind of page is clear and the sources say enough: write that page, with \`status: draft\` when it is thin. A stub has no template chosen yet; a draft has one.

## Properties

- \`becomes\`: the template that the stub is expected to become, such as \`event\`, when it is known.

## Becoming a page

A stub becomes a page with one modify: set \`type\` to the template, add the template's properties, and write its sections. The name and the links to it stay.

## Sections

None is required. Write what is known in a few lines, with a citation for each claim, and links to the pages it relates to.

## Skeleton

\`\`\`markdown
---
type: stub
description: One sentence on what the subject is.
tags: [ml/rl]
becomes: topic
---
Temporal-difference learning updates an estimate from other estimates ([[Sutton and Barto (source)]], p. 119).
\`\`\`
`,
  timeline: (_f) => `---
name: timeline
description: The history of one subject as dated entries in order, each linking its event where the wiki has one.
properties:
  subject: {type: link}
sections: [Overview, Entries, Related, Sources, Notes]
cites: true
checks: [chronological]
---
# Timeline

A timeline gives the history of one subject as a list of dated entries, oldest first: the releases of a library, the meetings of a project, the events of a field.

## When to use

- The order in time is the point: a reader wants to see what came before what.
- The sources give a date for each entry.

## When not to use

- One happening that is a subject in itself: an **event**, which the timeline links.
- A set whose order does not matter: a **list**.

## Properties

- \`subject\`: the page whose history the timeline gives, as a link, when the wiki has one.

## Sections

- **Overview**: two or three sentences on the span that the timeline covers, and what holds it together.
- **Entries**: one line for each entry, oldest first: the date in bold, a colon, what happened, and the citation. The date is a year, a month, or a day: \`**2024**\`, \`**2024-03**\`, \`**2024-03-14**\`. Link the entry's event when it has a page. Lint (the check \`chronological\`) says when an entry is out of order or has no date it can read.
- **Related**: links to the subject's page and to related timelines.
- **Sources**: each cited source, with one line on what it gives.
- **Notes**: the person's own. An agent never changes it.

The span of the timeline is the dates of its first and last entries, so it has no property for them.

## Skeleton

\`\`\`markdown
---
type: timeline
description: The releases of the yami library.
tags: [yami]
sources: ["[[Yami changelog (source)]]"]
subject: "[[Yami]]"
status: draft
---
## Overview

## Entries

- **2026-10-15**: [[Yami 0.20]] adds the wiki's checkouts ([[Yami changelog (source)]], line 40).
- **2026-11-04**: Yami 0.23 adds protected text ([[Yami changelog (source)]], line 12).

## Related

## Sources

## Notes
\`\`\`
`,
  source: (f) => `---
name: source
description: The note that stands for one captured original, such as a paper, slides, or a text, and describes it as a thing.
properties: {}
sections: [Summary, Structure, Notes]
cites: false
checks: []
---
# Source

A source note stands for one original that the wiki learned from: a file, a pasted text, a page. It is the one page that is about the original as a thing: what it is, who made it and for whom, how it is organized, what it covers well, and where it is thin or wrong. The pages state what is known and cite the source; they never describe it.

## Capture

Capture copies the file into the wiki's originals folder, named by its content hash, and writes the source note \`<name> (source).md\` with \`type: source\`, \`status: pending\`, \`file\` (the frozen copy, which the note embeds), \`from\` (where the file was captured from), and \`sha256\`. For a file that a reader cannot open, such as a \`.pptx\` or a \`.docx\`, capture also writes its text beside the copy, which \`text\` links and the note embeds in place of the copy. Read and cite the copy, or its text: the file in \`from\` can change later, and the copy is what the source says. Never change the copy, or the file it came from.

A later capture of a file that has a source is a new source note with \`supersedes\`, a link to the earlier one. The ingest of the new source moves the citations to it, and the earlier source gets \`status: superseded\`.

## Properties

The ingest sets these in a modify:

- \`description\`: one sentence on what the original is.
- \`tags\`: the tags of what it covers, and of its kind, such as \`paper\`.
- \`authority\`: \`official\`, \`primary\`, \`secondary\`, \`community\`, \`synthetic\`, or \`unknown\`.
- \`status\`: \`absorbed\` when every claim worth keeping is in the pages.

## Sections

The body starts with the embed of the copy or its text. Then:

- **Summary**: what the original says, in a paragraph or two, and what it is: who made it, for whom, and how well it covers its subject.
- **Structure**: one line for each part of the original, linking the pages that grew from it.
- **Notes**: the person's own. An agent never changes it.

Cite a source by its note, \`[[Dart Manipulation Tutorials (source)]]\`, never by the file it came from.

## Skeleton

\`\`\`markdown
---
type: source
description: The DINOv2 paper, on self-supervised training of vision transformers.
tags: [paper, ml/vision]
file: "[[${f.originals}/3f2a91c0/DINOv2.pdf]]"
authority: primary
status: absorbed
---
![[${f.originals}/3f2a91c0/DINOv2.pdf]]

## Summary

## Structure

- Section 3, the data: [[LVD-142M]].

## Notes
\`\`\`
`,
};
