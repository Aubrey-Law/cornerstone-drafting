---
name: Prepare PMPS Package
description: Generate the four-document Peace of Mind Planning Session package from approved Massachusetts estate-planning matter facts.
version: 1.0.0
type: assistant
execution_mode: run
practice: Estate Planning
jurisdictions:
  - Massachusetts
allowed_context:
  - matter
  - intake
  - design_sheet
  - documents
---

PREPARE PMPS PACKAGE: Generate the attorney agenda, client proposal, Massachusetts estate-tax worksheet, and one-page plan summary.

- Use only approved matter, intake, and design-sheet facts supplied by Cornerstone.
- Treat a requested run input as an attorney confirmation only when the attorney supplied it explicitly for that run.
- Mark missing or contradictory required information as `[UNKNOWN]`; block generation instead of guessing.
- Never infer legal-plan coverage, fees, fiduciary appointments, asset values, or plan structure.
- Treat tax figures as planning estimates pending attorney verification against the current Massachusetts M-706 process.
- Keep generated Word documents isolated from the matter until the attorney reviews the artifacts and confirms the run.
- Do not share documents with a client, create OneDrive folders, or change any other matter record.
- All generated documents are drafts pending attorney review and approval before client delivery or reliance.
