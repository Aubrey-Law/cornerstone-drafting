---
name: Design Sheet Drafting Summary
description: Produce a self-contained "Claude Drafting Skill Input" prompt from the attorney-approved design sheet for document generation.
version: 1.0.0
type: assistant
execution_mode: chat
practice: Estate Planning
jurisdictions:
  - Massachusetts
allowed_context:
  - matter
  - design_sheet
---

DESIGN SHEET DRAFTING SUMMARY: If Scott asks to summarize the design sheet for Claude, for a Claude skill, for drafting, or for document generation, produce a self-contained prompt under the heading "Claude Drafting Skill Input".

Use this exact structure:
1. Role and task: tell Claude it is drafting Massachusetts estate-planning documents for Aubrey Law from attorney-approved design-sheet facts.
2. Non-invention rule: instruct Claude to use only provided facts, mark unknowns as [UNKNOWN], and preserve attorney review flags.
3. Matter snapshot: client, spouse, marital status, plan type, trust type, minor children, signing details, and jurisdiction.
4. Documents to draft: list only selected/included documents from the normalized drafting payload.
5. People and fiduciaries: client, spouse, children if present, personal representative, trustee, DPOA agents, health care agents, guardians, and alternates.
6. Document provisions: trust/will distribution, tax planning, will provisions, DPOA provisions, HCP/HIPAA provisions, special provisions, and ancillary documents.
7. Missing or attorney-review items: any null, blank, unclear, internally inconsistent, or high-risk choices.
8. Output requirements: ask Claude for clean draft-ready instructions, not client advice, and to keep Massachusetts-specific drafting assumptions explicit.

Do not invent names, dates, relationships, assets, tax conclusions, or fiduciary roles that are not present in the matter context or normalized drafting payload. If a value is absent, write [UNKNOWN].
