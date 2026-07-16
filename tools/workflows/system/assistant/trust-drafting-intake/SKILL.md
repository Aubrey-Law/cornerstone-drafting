---
name: Trust Drafting Intake
description: Structured two-pass interview to gather everything needed to draft a Massachusetts revocable living trust plus pour-over will package.
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

TRUST DRAFTING INTAKE: If Scott asks to gather trust details, collect trust drafting info, prep a trust intake, or set up the inputs for a revocable trust, run a structured two-pass interview to gather everything needed to draft a Massachusetts revocable living trust + pour-over will package.

How to run it:
- Work from any client/matter context already shown above first. Pre-fill every item you can already answer from that context, and ONLY ask Scott for items that are missing, blank, or ambiguous. Never re-ask for facts already shown above. If no context is loaded, ask for each item.
- Ask in short batches (3-5 questions at a time), Pass 1 before Pass 2. Number the questions so Scott can answer inline.
- Do not invent names, dates, relationships, or counties. If Scott says a value is unknown, record it as [UNKNOWN]. For an undecided execution date, record the blank date line exactly as: `___________________, 20___`.
- When done, echo back a clean, labeled recap of all collected values (Pass 1 then Pass 2) for Scott to confirm. After he confirms, emit the trust-drafting skill handoff block described at the end so it can be pasted straight into the trust-drafting skill.

PASS 1 — always confirm or collect:
1. Trust type: Individual Revocable Trust OR Joint Revocable Trust.
2. Client full legal name (free text). If joint, collect BOTH client and spouse full legal names.
3. Client address, city, and county (free text). County must be a Massachusetts county (needed for notary blocks) — flag if it is not.
4. Trust name (e.g. "The John A. Smith Revocable Trust"; joint: "The John A. and Jane B. Smith Revocable Trust").
5. Trust execution date (free text, or "TBD"). If TBD, leave the blank date line `___________________, 20___`.
6. Children: names, and whether each is a minor or adult. If none, record "No children". If any minors, also collect each minor's date of birth.
7. Successor trustee(s): name and relationship — primary successor, then alternate. For a joint trust the surviving spouse is typically first, then the named successor.
8. Personal representative / executor for the pour-over will: primary (and co-primary if any); successor (and co-successor if any).

PASS 2 — only ask if the answer is NOT already in the matter context:
9. Initial co-trustee? Yes/No. If yes, full name and relationship.
10. Guardian(s) — ONLY if minor children exist: primary guardian name; successor guardian name; second successor guardian name; any excluded guardians (name and reason).
11. Signing county (for notary blocks). Default to Norfolk County (Needham office) unless Scott says the client is signing elsewhere.
12. Asset profile (used to suppress checklist rows) — ask Yes/No for each: out-of-state real estate; business interests; stock options / RSUs; oil/gas/mineral rights; 529 plans.

SKILL HANDOFF — after Scott confirms the recap, emit this block verbatim (fenced, exact header and field labels) so it can be pasted directly into the trust-drafting skill. Fill every value; use [UNKNOWN] where not provided; omit the Spouse and joint-only lines for an individual trust.
```
=== TRUST DRAFTING SKILL INPUT ===
Matter type: <Individual | Joint>
Trust type: <Individual Revocable Trust | Joint Revocable Trust>
Client full legal name: <name>
Client address: <street>, <city>, <county> County, <state>
Spouse full legal name: <name | n/a>
Spouse address: <street, city, county, state | same as client | n/a>
Trust name: <e.g. The John A. Smith Revocable Trust>
Trust execution date: <YYYY-MM-DD | TBD -> ___________________, 20___>
Children: <Name (adult/minor; DOB if minor); ... | No children>
Initial co-trustee: <name, relationship | None>
Successor trustees (in order): 1) <name, relationship> 2) <name, relationship>
Pour-over will personal representative(s): primary <name(s)>; successor <name(s)>
Guardian(s) (only if minor children): primary <name>; successor <name>; second successor <name>; excluded <name, reason | none>
Signing county: <MA county>
Asset profile: out-of-state real estate <Y/N>; business interests <Y/N>; stock options/RSUs <Y/N>; oil/gas/mineral rights <Y/N>; 529 plans <Y/N>
Special instructions: <notes | none>
=== END ===
```
