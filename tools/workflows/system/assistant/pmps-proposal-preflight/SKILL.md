---
name: PMPS Proposal Preflight
description: Extract every fact the Estate Plan Proposal and One-Page Summary need from a lead or matter, and report what is confirmed, what is missing, and what must be verified before the package is generated.
version: 1.0.0
type: assistant
execution_mode: chat
practice: Estate Planning
jurisdictions:
  - Massachusetts
allowed_context:
  - matter
  - intake
  - design_sheet
  - documents
---

PMPS PROPOSAL PREFLIGHT: Read the firm's record for a lead or matter and fill in the pre-flight checklist for the Estate Plan Proposal and One-Page Summary. Report what the record already answers, what is still open, and what has to be decided — before anyone runs the package.

This is an extraction and reporting task. It changes nothing. It does not generate the proposal: "Prepare PMPS Package" in the Library does that, from the design sheet, and it refuses to run while required facts are missing. The point of this workflow is to find those gaps while they are still cheap to fix, and to surface the ones the generator's own preflight does not check at all.

## How to run it

- Work from the client/matter context already shown above first. If this chat is not opened on a record, call `find_matter` with the client or matter name, then `read_matter_record` for that id — `overview`, `people`, `notes` at minimum, plus `documents`, `tasks` and `billing` when the checklist sends you there. If several records match, ask which one. If no client was named, ask which matter this is for before anything else.
- On a matter, call `read_design_sheet_status` as well. It reports exactly which design-sheet items are still open, which is the fastest read on Sections B–H.
- On a **lead**, there is no design sheet. Say so once, then run the checklist against the intake questionnaire and the lead's notes and communications, and mark every design-sheet-only item as not yet captured rather than missing.
- Read before asking. Never ask Scott to retype a fact the record already holds. Ask only about items the record genuinely does not answer, in short numbered batches so he can answer inline.

## Non-invention rule

Anything genuinely unknown gets a `[VERIFY: what is unknown]` tag — never a plausible-looking value. A silent plausible number is the exact failure this checklist exists to prevent, and these tags print inline in the client-facing draft so they have to be stripped before delivery, which is the point. Do not infer fees, legal-plan coverage, fiduciary appointments, asset values, citizenship, county, or plan structure. If two sources disagree, report both figures and their sources; do not pick one.

## What to extract, and where it lives

**A. Matter setup** — mostly automatic, do not ask for it. The run derives the filename prefix from the client and spouse last names (different surnames hyphenate) and stamps the proposal date itself. Confirm only that the last names on the record are the ones that should appear.

**B. Clients** — couple or individual; each client's first name as they go by it, full legal name, date of birth, age, U.S. citizenship, residence city/state, and **county**. Couples also need the date of marriage. County drives the Registry of Deeds language in the fee-exclusion bullets, so a wrong county puts the wrong registry in a client document. A non-citizen spouse kills the unlimited marital deduction — flag it in its own line, never as a bare "No".

**C. Children** — per child: full name, **exact date of birth** (a birth year alone forces an approximate age into the Children table), age, and minor-or-adult, which drives the guardian rows and the guardian document. Son/daughter is optional and defaults to "Child". Separately note any child from a prior relationship, any child with special needs, and any deceased child with descendants: none are schema fields, and each one changes the plan.

**D. Assets** — every line needs a number. A blank is not zero; it stops the gross estate reconciling, and the tax figures then come out wrong rather than merely incomplete. The design sheet carries assets by category — real property, financial, retirement, life insurance, business, other — each with description, institution, estimated value, current owner, target owner and beneficiary designation. The gross estate is the sum of the estimated values, so the value recorded must be the one the estate should carry; there is no separate mortgage field, so a property's gross value and mortgage balance belong in the notes with the **net** figure as the value. Capture real property one line per property, retirement and brokerage one line per account, and business interests with entity, percent owned and valuation basis. Note any anticipated inheritance with its source and expected amount.

**Policy ownership is the one people skip and the one that matters most.** For each life-insurance line, record the carrier, the death benefit, term or whole, **and who owns the policy** — that is the `current_owner` field, and it is asked per policy, not per client. A policy the insured owns is pulled into their taxable estate at the full death benefit. On a mid-size estate the insurance is often the only reason there is a tax at all, so ownership can be the whole difference between a taxable and a non-taxable estate.

**E. Tax questions to settle before computing** — ask these before any value is treated as final:
- Are the intake asset values **per-spouse or combined**? Silently doubling or halving the estate is the single largest error available here.
- Any conflicting figures on the intake? Resolve them first — one asset can move the estate a bracket.
- Is either spouse a **disabled veteran**? Massachusetts offers an exemption the standard intake does not ask about.
- Any prior taxable gifts? They add back into the Massachusetts computation.
- Any real property **outside Massachusetts**? MA apportions, and out-of-state realty is not taxed the same way.

**F. Fiduciaries, per spouse** — initial trustee, successor trustees in order, personal representative, financial POA (primary, and successor if named), health care agent (primary, and successor if named), and a guardian plus alternate when there are minor children. **Say explicitly whether the spouses serve as co-trustees**: if they do, the default "Settlor is sole trustee" line has to be overridden or the proposal contradicts its own fiduciary table. One successor name is thin for a trust that may run twenty-five years or more. Flag alongside these any fiduciary who is **not a U.S. resident** (banking access, tax filing, possible court bonding), any fiduciary named **as a married couple** — the firm's position is to name the individual with authority to retain an advisor, rather than two people who may later divorce — and any fiduciary **under about 25**, where a minimum service age is worth considering.

**G. Plan design and client wishes** — trust-based or will-based; for a couple, a single joint trust or dual separate mirror trusts; whether credit-shelter/bypass planning applies (couples over $2M); whether there is a QTIP marital share or remarriage protection; the **distribution framework** as ages and percentages (for example 50% at 25 / 50% at 35); the **discretionary standard before those ages**, meaning HEMS and whether college is called out; **asset-protection requirements** covering divorce, creditors and spendthrift; the **full contingent beneficiary chain in full legal names** if a child predeceases; and pets, with name, pronoun and intended caregiver.

> **Trap.** None of those bolded items are data-driven. The Key Trust Provisions section of the proposal renders generic boilerplate — creditor protection, financial maturity, lifestyle disability — and never mentions the client's actual ages, percentages, or beneficiary chain. Nothing in the document list supplies a per-document `description`, so the template falls back to its standard descriptions. Those facts have to be written into the trust document's `description` field or they are silently dropped from the proposal. Collect them in the client's own words and say plainly, in the gaps list, that they will not appear unless someone puts them there.

**H. Document list** — which documents the plan includes, and for each one whether it is **joint** (one document covering both, such as a quitclaim deed or guardian appointment), **per spouse** (an identical copy each, such as the DPOA or health care proxy), or **spouse-specific** (unique terms per spouse, such as two mirror trusts).

**I. Billing** — whether a legal insurance plan applies and which one (MetLife, LegalEASE, ARAG or CLC), what that plan **covers** and what it **does not** (always include deed recording fees, which no Aubrey Law engagement covers), the flat fee if there is no legal plan, and any optional-services fees for advanced estate-tax planning, real property transfer, or supervised signing. The matter record carries the legal plan and flat fee; a lead usually carries neither. **Never guess a fee — ask.** Then ask the question the checklist exists for: **has a fee been quoted to this client yet?** If not, the Optional Services table is the first written number they will see, so it gets confirmed deliberately rather than left to a firm default.

**J. End-of-life directives** — capture per spouse, because they frequently differ: prolong life versus comfort care only; organ donation and for what purpose (transplant, research, none); burial or cremation; any preference about dying at home; and service or celebration-of-life wishes. The design sheet records the advance-directive choice and the anatomical-gift preference per client; burial, home and service wishes are not schema fields, so look for them in notes and record them there.

**K. Provenance** — for each figure and each name, say where it came from: intake form, uploaded questionnaire, planning-session notes, or verbal. Cite the source and flag anything whose source is unclear. This is what lets Scott tell a client-confirmed number from one that was inferred six weeks ago.

## Conditional sections — what turns them on

| Section | Renders when |
|---|---|
| Credit shelter analysis | Couple **and** gross estate > $2M |
| Federal Estate Tax + Trust Protector | Gross estate ≥ **$7M** |
| Young Adult Estate Plans | Any child is an adult **and** under 30 |
| Pet Trust Provisions | Trust plan **and** a pet description is supplied |
| Anticipated Inheritance | An inheritance note is supplied |
| Guardian rows and documents | Any minor child |
| Real Estate Transfer | Real property present |
| Legal Plan Coverage + Optional Services | Legal plan, no flat fee |
| Engagement Fee bullets | Flat fee set (suppresses Optional Services entirely) |

Say which of these will render for this record, and which are one missing fact away from rendering.

## Decisions only Scott can make

Put these in one batch at the end rather than asking them one at a time:

1. Which value to use where the intake conflicts.
2. Whether to plug a reconciliation gap or show the line as TBD.
3. The fee for any advanced planning not yet quoted.
4. Whether a deferred appointment is named with a flag or left as `[To be determined]`.
5. Whether an unconfirmed life insurance policy is treated as includable.

## What to produce

1. **The filled checklist**, section by section (A–K), showing the value found and its source, and `[VERIFY: ...]` where the record has nothing. Keep the section letters and names so it can be read against the paper checklist.
2. **Blocking gaps** — the items that stop the package from generating correctly, each with the one question that would close it. Separate these from items that merely weaken the document.
3. **Run inputs** — the four choices the Library run asks for and cannot derive: whether a legal plan applies and which, the flat fee if not, the plan structure (`joint_outright`, `joint_disclaimer`, `separate_clayton`, or `individual_single`), and which of the four documents to produce. Recommend a plan structure with your reasoning; do not select one silently.
4. **A readiness call.** With client type, names, DOBs, county, children with minor status, asset values sufficient to total a gross estate, legal plan or flat fee, and trust-versus-will, the package will produce a coherent draft with everything else flagged. Say so when that floor is met. But say just as plainly that the fiduciary table and the trust terms are the substance of the document: a record without Section F or Section G produces a shell, not a proposal.

Then stop. Do not generate the documents, do not claim anything was saved, and do not change the design sheet. Point Scott to Library → Prepare PMPS Package → Dedicated run when the gaps are closed.
