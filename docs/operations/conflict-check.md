# Conflict check at lead creation

Every new lead is searched against the people the firm already knows, as soon as it is
created, and the attorney records what the search means.

## What runs

- **When.** Behind the response that creates the lead, on every path: the New lead form, the
  assistant's `lead.create` (including the Retell receptionist), portal signup, a lead made from
  a text thread, and a lead created by a booking (the scheduling page, Calendly, Cal.com,
  Lawmatics). "Run again" on the lead page repeats it after the record changes (a spouse added,
  an email corrected).
- **Who.** The lead under every name and identity the record holds (first and last, preferred
  name, prior names, every email and phone, including the additional ones), plus their spouse
  when a spouse contact is on the lead.
- **Against.** Every intake (leads and clients, with the matter for the label), and every
  contact on any matter (spouses, children, beneficiaries, fiduciaries, with the roles they
  hold). The lead's own intake and own self contact are excluded, since the trigger that opens
  the opportunity writes them.
- **How a match is read** (`lib/conflicts/match.ts`, pure): the same email or phone is strong;
  the same full name is strong; the same surname with the same first initial is possible; a
  surname alone is nothing. Each matched record is listed once, strongest first, with what it
  matched on and where that person appears.

## What is recorded

`conflict_checks` (`20270115090000_conflict_checks.sql`), one row per run, newest current: the
subject searched, the hits, `result` (clear, possible) and `decision` (pending, no conflict,
conflict), who decided and when, and a note. Staff-only. A clear run stores itself as decided.
The three long-unused columns on `matter_details` (`conflict_check_completed`,
`conflict_check_date`, `conflict_cleared`) are mirrored from it, so the matter page's pill agrees.

## What happens with a match

- The lead page's **Conflict check** card (Overview, under the brief) lists the matches with
  links, and offers **No conflict** or **Conflict** (with a note for the file). A recorded
  conflict can be cleared later.
- The match is raised through the **delegation dial** as a `task.create` on the lead ("Conflict
  check: …", high priority, the matches in the description), keyed to the lead and the set of
  records matched, so a re-run that finds the same people does not stack tasks.
- The lead lifecycle gains **`lead.conflict_check`** ("Conflict check clear"), a blocking
  requirement owned by the attorney, evaluated wherever the check's state is supplied (the
  lead page). It is satisfied by a clear search or a recorded "no conflict", and reads
  "Conflict of interest recorded" when the decision is conflict.
- **A lead with a recorded conflict is never hired**, by any path: `createMatterFromIntake`
  refuses before the convert RPC, which covers the manual hire, the status change, and a
  signed engagement arriving from e-sign.

## Not in this slice

The search covers people the firm's records name. Beneficiaries written only as free text on a
design sheet (specific bequests, residuary names) are not yet candidates; the contacts and
roles tables are. Matters opened directly without a lead stage (`create_matter_with_client`,
`open_matter_for_person`) do not run the check. A conflict check on an existing lead when a
new contact is added to it is manual ("Run again").
