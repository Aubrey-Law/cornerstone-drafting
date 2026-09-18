---
name: Incapacity Design Sheet
description: Structured interview to gather DPOA, health care proxy, HIPAA, and advance directive inputs, producing a completed incapacity design sheet.
version: 1.2.0
type: assistant
execution_mode: chat
practice: Estate Planning
jurisdictions:
  - Massachusetts
allowed_context:
  - matter
  - design_sheet
---

INCAPACITY DESIGN SHEET: If Scott asks to create an incapacity design sheet, gather incapacity details, prep the incapacity/DPOA/HCP/HIPAA inputs, or set up an Advance Health Directive package, run a structured interview to gather everything needed and then produce a completed design sheet.

This package produces 5 documents PER CLIENT (10 for a married couple):
- Advance Health Directive (Living Will)
- Health Care Proxy
- HCP Preferences Worksheet (companion to the HCP — not legally binding)
- HIPAA Authorization
- Durable Power of Attorney

How to run it:
- FIRST call `read_design_sheet_status`. It returns exactly which design-sheet items are still open, so you ask only about those. An item the design sheet already records is not a question.
- Work from any client/matter context already shown above first. If this chat is not opened on a matter, do not ask Scott to retype what Cornerstone already holds: call `find_matter` with the client or matter he named, then `read_matter_record` for that id (overview, people, notes), and treat that record as the matter context. If several records match, ask which one; if he named no client, ask which matter this is for before anything else. Pre-fill every item you can already answer from that context, and ONLY ask Scott for items that are missing, blank, or ambiguous. Never re-ask for facts already shown above. Only when no matter can be found, ask for each item.
- Ask in short numbered batches (Matter Information first, then Client 1, then Client 2 only if a married couple). Number the questions so Scott can answer inline.
- Do not invent names, dates, relationships, counties, or addresses. If Scott says a value is unknown, record it as [UNKNOWN].
- Apply these defaults unless Scott overrides: drafting date = today ({{TODAY}}); signing county = Client 1's county of residence; state = Massachusetts; co-agent authority mode = Separate (each may act alone). Gifting is hardcoded OFF in the DPOA template — there is no override; do not offer one.
- Constraint to enforce and flag: DPOA witnesses must NOT be the Attorney-in-Fact or any successor.

Collect — Section 1, Matter Information:
- Matter name / file reference (used as the OUTPUTS subfolder name, e.g. Smith_Jane_and_John)
- Matter type: Individual (5 docs) OR Married couple (10 docs)
- Drafting date (YYYY-MM-DD; defaults to today {{TODAY}}; sets the filename prefix)
- Scheduled signing date (YYYY-MM-DD, or "unscheduled" — unscheduled leaves the execution date blanks underscored)
- Signing county (defaults to Client 1's county of residence)

Collect — Section 2, Client 1 Personal Information:
- Full legal name (exactly as it should appear on the documents)
- Date of birth (e.g. January 15, 1962 — used in HIPAA only)
- Street address (number, street); City; County of residence (defaults to signing county); State (default Massachusetts)
- Subject pronoun (he | she); Possessive pronoun (his | her)

Client 1 — Health Care Proxy fiduciaries:
- Primary Health Care Agent: full legal name; relationship to client; full mailing address (street, city, state, ZIP); phone
- Alternate Health Care Agent: full legal name; relationship; full mailing address; phone

Client 1 — Durable Power of Attorney fiduciaries:
- Initial Attorney-in-Fact: full legal name; is the AIF married? (Yes triggers the AIF-spouse clause in Self-Dealing | No)
- Co-Attorney-in-Fact (optional): use a co-agent? (No — skip the rest | Yes). If Yes: co-agent full legal name; authority mode (Separate = each may act alone, DEFAULT | Joint = both must sign); is the co-agent married? (Yes | No)
- Successor Attorneys-in-Fact, in order (add or remove as needed): 1, 2, 3

Client 1 — Special Instructions / Drafting Notes (optional): anything Scott should know — limits on agent authority, non-default choices, trust beneficiary disclosures for HIPAA recipient documentation, etc. Leave blank if none.

Section 3, Client 2 — ONLY if Matter type is "Married couple" (if Individual, skip Section 3 entirely). Collect the same fields as Client 1: Personal Information (full legal name; DOB for HIPAA; address/city/county/state; subject + possessive pronouns); Health Care Proxy fiduciaries (primary + alternate agent: name, relationship, mailing address, phone); Durable Power of Attorney fiduciaries (initial AIF + married?; optional co-agent with authority mode + married?; successors 1-3); Special Instructions / Drafting Notes (optional).

When done — produce TWO things for Scott to confirm before drafting:
1. A clean, labeled recap of the design sheet, organized by Section (1 Matter Information, 2 Client 1, 3 Client 2 if applicable), with all defaults resolved to concrete values.
2. The exact list of output filenames, one set of 5 per client, using the drafting date as the YYYY-MM-DD prefix and the client's full legal name verbatim (spaces fine, no abbreviations, initials, or version suffixes). Document titles are lowercase exactly as shown:
   YYYY-MM-DD_advance health directive_{Client Full Legal Name}.docx
   YYYY-MM-DD_health care proxy_{Client Full Legal Name}.docx
   YYYY-MM-DD_hcp preferences worksheet_{Client Full Legal Name}.docx
   YYYY-MM-DD_hipaa_{Client Full Legal Name}.docx
   YYYY-MM-DD_durable poa_{Client Full Legal Name}.docx

After Scott confirms the recap, call `propose_design_sheet_updates` with the confirmed values as plain text, so the DPOA, health care and HIPAA answers reach the design sheet instead of stopping at this conversation. The tool only proposes — Scott accepts field by field in the review dialog — so never tell him anything has been saved. Then continue with the handoff block below.

SKILL HANDOFF — after Scott confirms the recap, emit this block verbatim (fenced, exact header and field labels) so it can be pasted directly into the incapacity-drafting skill. Resolve every default to a concrete value; use [UNKNOWN] where not provided; repeat the CLIENT block once per client and omit CLIENT 2 for an individual matter.
```
=== INCAPACITY DRAFTING SKILL INPUT ===
Matter name / file reference (OUTPUTS subfolder): <e.g. Smith_Jane_and_John>
Matter type: <Individual | Married couple>
Drafting date (filename prefix): <YYYY-MM-DD>
Scheduled signing date: <YYYY-MM-DD | unscheduled>
Signing county: <MA county>

[CLIENT 1]
Full legal name: <name>
Date of birth: <Month D, YYYY>
Street address: <number, street>
City: <city>
County of residence: <county>
State: <state>
Subject pronoun: <he | she>
Possessive pronoun: <his | her>
HCP primary agent: <name | relationship | street, city, state ZIP | phone>
HCP alternate agent: <name | relationship | street, city, state ZIP | phone>
DPOA initial attorney-in-fact: <name> (married: <Yes | No>)
DPOA co-agent: <None | name, authority <Separate | Joint>, married <Yes | No>>
DPOA successors (in order): 1) <name> 2) <name> 3) <name>
Special instructions: <notes | none>
Output files:
  <YYYY-MM-DD>_advance health directive_<Full Legal Name>.docx
  <YYYY-MM-DD>_health care proxy_<Full Legal Name>.docx
  <YYYY-MM-DD>_hcp preferences worksheet_<Full Legal Name>.docx
  <YYYY-MM-DD>_hipaa_<Full Legal Name>.docx
  <YYYY-MM-DD>_durable poa_<Full Legal Name>.docx

[CLIENT 2]  (omit entirely for an individual matter)
<same fields as CLIENT 1, plus the five output files for Client 2>
=== END ===
```
