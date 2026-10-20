---
name: checkout
description: "Check out the wiki's material on a subject: choose the documents that serve the request, put them in reading order with a reason each, and make the checkout."
---
# Checkout

A checkout is a reading list and a copy of each document on it, for the user to read and mark up. Code ranks the candidates and writes the copies. You choose the documents, order them, and give each one a reason.

1. **The request.** Take it in the user's words: the message, or, in a checkout session, the session's Request section. Turn the words that name tags into `tags` for the search.
2. **Candidates.** Call `wiki_search` with the request as `text`, `algorithm: "hop2"`, `types: ["topic"]`, and `limit: 40`. Add `"source"` to the types when the user asks for the sources themselves. The `hop2` ranking adds the documents linked to or from the best hits, up to two links away; `why` says which hit led to each.
3. **Choose.** Read each candidate's snippet, and the document with Read when the snippet does not settle it. Keep a document that serves the request; drop one that does not. Judge a linked document on its own content, not on the hit that led to it. When you drop a document, also drop the candidates that only it led to, unless they serve the request on their own. A branch stops where its documents stop serving.
4. **Size.** Aim for a sitting or a week of reading: at most about 30 documents. When more serve, the request is too broad: ask the user once to narrow it, with two or three narrower requests from the tags or subjects of the candidates.
5. **Order.** Foundations first: a definition, an overview, or a concept that the others assume comes before the documents that build on it. Give each document a `why`: one line on what it gives the reader for this request.
6. **Make it.** Call `librarian_checkout` with `request` (the user's words), `documents` in reading order with each `path` and `why`, and `notes`: the near subjects you left out, the branches you stopped, and the gaps of the wiki. In a checkout session, give `session`: the session document's path, which becomes the reading list. Otherwise give `name`: a short name, such as "Reinforcement learning".

End with one line: the reading list as a link, and the count of documents. Never edit a copy: the copies are the user's. The user returns the checkout in Obsidian, and the edits of the copies go back into the wiki then.
