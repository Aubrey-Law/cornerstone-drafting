# AI Chat Design Prompts — Trust Design & Incapacity Design Sheet

Documents the two AI Chat (AI Assistant) flows that gather inputs and produce drafting handoffs:

1. **Generate Trust Design** — trust drafting intake interview → trust-drafting skill input
2. **Create Incapacity Design Sheet** — incapacity intake interview → incapacity-drafting skill input

Both run inside the admin AI Chat assistant. They are **not** separate endpoints — they are instruction blocks embedded in the chat system prompt that tell Claude how to run a structured interview and what handoff block to emit.

**Implementation:**
- Routes: `app/api/admin/chat/route.ts` (rail) and
  `app/api/admin/assistant/chats/[chatId]/messages/route.ts` (assistant page);
  both run `createAdminChatStream` from `lib/adminChat/engine.ts`
- Model: resolved via `resolveFirmModel('assistant')`
- Trust block: `trustDraftingIntakeInstructions()` (`lib/adminChat/prompts.ts`)
- Incapacity block: `incapacityDesignSheetInstructions()` (`lib/adminChat/prompts.ts`)
- The instruction bodies themselves live in
  `tools/workflows/system/assistant/<slug>/SKILL.md` and are synced into
  `work_skills`. **Edit the SKILL.md, not route code.**
- Pre-fill source: `loadMatterContext()` / `draftPayloadFactSheet()` inject a normalized design-sheet fact block so Claude pre-fills known values and only asks for `[UNKNOWN]` items.
- Source of truth: `loadSystemSkillBody` reads the bundled SKILL.md first and falls back to the `work_skills` row only when the slug is gone from the bundle. The rows are re-synced at production boot (`ensureSystemWorkflowsSynced`) so the Library list matches the deploy.
- Attached workflows: the Assistant composer's "Workflows" button attaches a chat-mode workflow. The messages route loads its body (`loadAttachedWorkflow`) and appends it to the system prompt (`attachedWorkflowPromptNote`), emitting `workflow_applied` before the model speaks. A matter-scoped workflow (allowed_context includes `matter`) is refused in a general chat with code `workflow_requires_matter`; the composer holds the send and opens the matter picker, and the Library picker badges such workflows "Needs a matter". Run-mode workflows (PMPS, MetLife) are hidden from the composer picker; they run from the Library's Dedicated run.
- Chat context: the Assistant page header carries a matter/lead picker (`AssistantContextPicker`, `PATCH /api/admin/assistant/chats/[chatId]` with `context_type`/`context_id`); `/admin/assistant?matter=<id>` opens a new chat on that record.
- Review step: the drafting Review step's "Draft assistant" panel (`components/drafting/MatterAssistantPanel.tsx`) posts to `/api/admin/matters/[id]/assistant`, which runs the same `createAdminChatStream` with `loadMatterContext` and `adminChatToolset` plus any staff MCP connector tools; its per-matter thread is the one the rail shares. Attached drafts are named in the prompt and read through `read_document_text`.
- Rail threads: the floating rail keeps every thread on the server through `/api/admin/chat/history` (`lib/railChatHistory.ts`): matter threads under the matter id (shared with the Review step), lead threads under the lead's matter, and one general thread per attorney under the `general` key, all in `matter_assistant_messages`. Nothing is kept in sessionStorage any more.
- History: each reply persists its tool rounds in `events` (`tool_round`) and `replayMessagesForModel` rebuilds them as `tool_use`/`tool_result` blocks on later turns, so what the assistant read is not forgotten.

> **Distinct tool:** the **Design Sheet Import** tool (`lib/designSheetImport/server.ts`, `claude-sonnet-4-20250514`) parses pasted attorney notes into a JSON design sheet. It's a different feature from these two chat flows — see the end of this doc.

---

## 1. Generate Trust Design

### Trigger
Scott asks to gather trust details, collect trust drafting info, prep a trust intake, or set up the inputs for a revocable trust.

### Prompt (system-prompt instruction block)

Claude runs a **structured two-pass interview** to gather everything needed to draft a Massachusetts revocable living trust + pour-over will package.

**How it runs:**
- Work from any client/matter context already shown first. Pre-fill every answerable item; only ask for items that are missing, blank, or ambiguous. Never re-ask for facts already in context. If no context is loaded, ask for each item.
- Ask in short batches (3–5 numbered questions), Pass 1 before Pass 2.
- Do not invent names, dates, relationships, or counties. Unknown → `[UNKNOWN]`. Undecided execution date → the blank date line `___________________, 20___`.
- When done, echo a clean labeled recap (Pass 1 then Pass 2) for confirmation, then emit the skill handoff block.

**Pass 1 — always confirm or collect:**
1. Trust type: Individual Revocable Trust OR Joint Revocable Trust.
2. Client full legal name (both client and spouse if joint).
3. Client address, city, and county — must be a Massachusetts county (notary blocks); flag if not.
4. Trust name (e.g. "The John A. Smith Revocable Trust").
5. Trust execution date (or "TBD" → blank date line).
6. Children: names, minor/adult; "No children" if none; DOB for each minor.
7. Successor trustee(s): name + relationship (primary, then alternate). Joint: surviving spouse first, then named successor.
8. Personal representative / executor for the pour-over will: primary (+ co-primary), successor (+ co-successor).

**Pass 2 — only ask if not already in matter context:**
9. Initial co-trustee? If yes, full name + relationship.
10. Guardian(s) — only if minor children: primary; successor; second successor; excluded guardians (name + reason).
11. Signing county (notary blocks). Default Norfolk County (Needham office) unless signing elsewhere.
12. Asset profile (Yes/No each, used to suppress checklist rows): out-of-state real estate; business interests; stock options/RSUs; oil/gas/mineral rights; 529 plans.

### Output (skill handoff block)

After the recap is confirmed, Claude emits this verbatim, fenced. Fill every value; `[UNKNOWN]` where not provided; omit Spouse/joint-only lines for an individual trust.

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

---

## 2. Create Incapacity Design Sheet

### Trigger
Scott asks to create an incapacity design sheet, gather incapacity details, prep the incapacity/DPOA/HCP/HIPAA inputs, or set up an Advance Health Directive package.

### Package produced
5 documents **per client** (10 for a married couple):
- Advance Health Directive (Living Will)
- Health Care Proxy
- HCP Preferences Worksheet (companion; not legally binding)
- HIPAA Authorization
- Durable Power of Attorney

### Prompt (system-prompt instruction block)

Claude runs a **structured interview**, then produces a completed design sheet.

**How it runs:**
- Work from any client/matter context first; pre-fill known values, only ask for missing/blank/ambiguous items. Never re-ask facts already shown. If no context, ask each item.
- Ask in short numbered batches (Matter Information → Client 1 → Client 2 only if married couple).
- Do not invent names, dates, relationships, counties, or addresses. Unknown → `[UNKNOWN]`.
- **Defaults unless overridden:** drafting date = today; signing county = Client 1's county of residence; state = Massachusetts; co-agent authority mode = Separate (each may act alone). Gifting is hardcoded OFF in the DPOA template — no override; do not offer one.
- **Constraint to enforce/flag:** DPOA witnesses must NOT be the Attorney-in-Fact or any successor.

**Section 1 — Matter Information:**
- Matter name / file reference (OUTPUTS subfolder, e.g. `Smith_Jane_and_John`)
- Matter type: Individual (5 docs) OR Married couple (10 docs)
- Drafting date (YYYY-MM-DD; defaults to today; sets filename prefix)
- Scheduled signing date (YYYY-MM-DD, or "unscheduled" → execution-date blanks underscored)
- Signing county (defaults to Client 1's county of residence)

**Section 2 — Client 1 Personal Information:**
- Full legal name (exactly as on documents)
- Date of birth (e.g. January 15, 1962 — HIPAA only)
- Street address; City; County of residence (defaults to signing county); State (default MA)
- Subject pronoun (he | she); Possessive pronoun (his | her)

**Client 1 — Health Care Proxy fiduciaries:**
- Primary Health Care Agent: full legal name; relationship; full mailing address (street, city, state, ZIP); phone
- Alternate Health Care Agent: same fields

**Client 1 — Durable Power of Attorney fiduciaries:**
- Initial Attorney-in-Fact: full legal name; AIF married? (Yes triggers AIF-spouse clause in Self-Dealing | No)
- Co-Attorney-in-Fact (optional): use a co-agent? (No → skip | Yes → co-agent full name; authority mode Separate=each may act alone DEFAULT / Joint=both must sign; co-agent married? Yes/No)
- Successor Attorneys-in-Fact, in order: 1, 2, 3

**Client 1 — Special Instructions / Drafting Notes (optional):** limits on agent authority, non-default choices, trust beneficiary disclosures for HIPAA recipient documentation, etc. Blank if none.

**Section 3 — Client 2:** only if Matter type = Married couple (skip entirely for Individual). Same fields as Client 1.

**When done — produce TWO things to confirm before drafting:**
1. A clean labeled recap by Section (1 Matter Information, 2 Client 1, 3 Client 2 if applicable), all defaults resolved to concrete values.
2. The exact list of output filenames, one set of 5 per client, using the drafting date as the `YYYY-MM-DD` prefix and the client's full legal name verbatim (spaces fine; no abbreviations/initials/version suffixes). Document titles lowercase exactly:
   - `YYYY-MM-DD_advance health directive_{Client Full Legal Name}.docx`
   - `YYYY-MM-DD_health care proxy_{Client Full Legal Name}.docx`
   - `YYYY-MM-DD_hcp preferences worksheet_{Client Full Legal Name}.docx`
   - `YYYY-MM-DD_hipaa_{Client Full Legal Name}.docx`
   - `YYYY-MM-DD_durable poa_{Client Full Legal Name}.docx`

### Output (skill handoff block)

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

---

## Pre-fill: design sheet fact block

Both flows pre-fill from a normalized fact block injected into the chat system prompt when a matter is loaded (`draftPayloadFactSheet()` / `buildDraftPayload.ts`). It resolves design-sheet values into concrete facts (matter snapshot, documents to draft, resolved fiduciary names, document provisions, missing/review items) and instructs Claude to treat them as the source of truth — asking Scott only for items shown as `[UNKNOWN]`.

---

## Related: Design Sheet Import tool (text → JSON)

Separate from the two chat interviews. Parses untrusted attorney text into a structured JSON design sheet.

- File: `aubrey-law-portal/lib/designSheetImport/server.ts`
- Model: `claude-sonnet-4-20250514`, max tokens `4000`
- System prompt: `DESIGN_SHEET_IMPORT_SYSTEM_PROMPT` — extract MA estate-planning design sheet data; output **only one JSON object**, no markdown; use only allowlisted field names (`DESIGN_SHEET_IMPORT_FIELD_NAMES`); never invent facts (omit unknown fields); ISO dates; unmapped notes → `drafting_notes`.
- User prompt: wraps the input between `---BEGIN UNTRUSTED DESIGN SHEET TEXT---` / `---END...---` markers with the matter ID.
- Output: JSON object keyed by the allowlist in `lib/designSheetImport/shared.ts` (personal, family, fiduciary, plan-design, trust/will provisions, assets, notes). See [trust-incapacity-design-prompts.md](trust-incapacity-design-prompts.md) for the field catalog.
