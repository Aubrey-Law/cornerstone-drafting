---
name: Estate Plan Draft Review
description: Tabular cross-document review of generated estate-plan drafts, checking names, fiduciaries, dates, and unresolved markers per document.
version: 1.0.0
type: tabular
execution_mode: run
practice: Estate Planning
jurisdictions:
  - Massachusetts
allowed_context:
  - documents
columns_config: [{"index":0,"name":"Document","prompt":"State the document's title and type (trust, will, DPOA, health care proxy, HIPAA, other).","format":"text"},{"index":1,"name":"Client names","prompt":"List every client, spouse, and testator/settlor name exactly as it appears. Flag any spelling inconsistency with the other documents.","format":"bulleted_list"},{"index":2,"name":"Fiduciaries","prompt":"List each fiduciary role (trustee, personal representative, attorney-in-fact, health care agent, guardian) with the named primary and successors in order.","format":"bulleted_list"},{"index":3,"name":"Execution date","prompt":"What execution date does the document use? If it is a blank signing line, answer 'blank line'.","format":"date"},{"index":4,"name":"Unresolved items","prompt":"List any [[ MISSING ]], [UNKNOWN], TODO markers, or obviously incomplete provisions. Answer 'none' if clean.","format":"bulleted_list"}]
---

ESTATE PLAN DRAFT REVIEW: Apply each column prompt to every generated draft in the review set. Report only what the documents actually say — never fill gaps from assumptions. Inconsistencies across documents (name spellings, conflicting fiduciary orders, mismatched dates) are the primary findings; call them out explicitly in the affected cells.
