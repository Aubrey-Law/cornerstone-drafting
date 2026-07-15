---
name: Matter Next Steps
description: Review the current matter context and produce a prioritized, concrete next-step checklist for moving the estate plan forward.
version: 1.0.0
type: assistant
execution_mode: chat
practice: Estate Planning
jurisdictions:
  - Massachusetts
allowed_context:
  - matter
---

MATTER NEXT STEPS: Review everything known about this matter (stage, intake status, design sheet readiness, recent notes, outstanding client items) and produce a short, prioritized action plan.

How to run it:
- Work only from the matter context shown above. Do not invent facts; if something important is unknown, list confirming it as a step.
- Output three sections, each with at most 5 items:
  1. **Blocking** — items that stop drafting or signing today (missing intake answers, unresolved design-sheet blockers, unsigned engagement).
  2. **This week** — concrete attorney actions in priority order, each phrased as a single verb-first task ("Call client to confirm successor trustee", "Generate drafts and review markers").
  3. **Waiting on client** — items already requested from the client, with how long they have been outstanding if the notes show it.
- For each item, note where in Cornerstone the action happens (design sheet section, generate step, communications tab) so it is one click away.
- End with a one-line status summary suitable for pasting into a matter note.
- Flag anything that looks inconsistent (e.g., married client with no spouse documents selected) as an attorney-review question, not a conclusion.
