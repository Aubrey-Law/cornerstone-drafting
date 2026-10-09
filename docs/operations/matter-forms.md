# Multiple forms per matter

A matter can ask its clients to fill in more than one thing. Everything shows
in the **Forms** card on the lead page and in the matter's Overview sidebar, and
clients see all of it at **/forms** in the portal.

## Linked questionnaires (e.g. College Prep alongside an estate plan)

- The matter's **primary intake** (`matters.client_intake_id`) is unchanged. It is
  the household drafting reads, and its controls stay on the existing Intake card.
- **Add questionnaire** creates a separate `client_intake` row for another
  person, with its own track, link, status and lock. It is joined to the matter
  through `matter_linked_intakes`.
- The College Prep questionnaire treats **the student as the client**. It
  writes the student's name, date of birth and contact details into the client
  columns, which is why it cannot share the parents' row.
- Linked rows are created with `lead_status` NULL, so `ensure_lead_matter()`
  does not open a separate opportunity for them.
- To let a parent fill in the student's questionnaire, use the parent's email
  for the link. One portal account then holds both questionnaires, and
  `/intake?id=` switches between them.
- **Email link**, **Copy link** and **Download answers (Word)** work per
  questionnaire.
- **Remove from matter** works as follows:
  - a questionnaire nobody has touched is deleted outright;
  - anything that was sent or started is only unlinked, so no answers are lost.

### Drafting a linked College Prep questionnaire

Drafting reads only a matter's primary intake, and drafting internals are left
alone (see `AGENTS.md`). So the student's package is drafted on a **companion
matter** whose primary intake *is* the student's questionnaire.

1. Once the student's College Prep questionnaire is submitted and the family
   matter is hired, the Forms card shows **Draft College Prep package** on that
   row. Before then the button is disabled and its tooltip says why.
2. Confirming opens a hired College Prep matter for the student through the
   same path as any hired lead (`createMatterFromIntake` →
   `convert_lead_to_matter`). That gives it:
   - the CP practice area and a CP matter number in the student's name;
   - the design-sheet seed (`seedCollegePrep`) and the CP task plan;
   - the conflict-check gate every hire goes through.
3. It then takes you to `/admin/drafting/[matterId]` for the companion. POA, health care
   proxy, HIPAA, FERPA and living will draft there exactly as on any College
   Prep matter.

How the two matters stay connected:

- The link row on the family matter stays and records the companion
  (`matter_linked_intakes.companion_matter_id`). The family matter's Forms card
  shows **Drafting on** followed by the companion's matter number, and **Open drafting** for that row.
- The companion's Forms card says which family matter it was opened from.
- Both matters log a `college_prep_companion_opened` activity.
- The action is idempotent: running it again returns the same companion.

What changes for the student's questionnaire:

- It becomes the companion's primary intake. Its `lead_status` becomes
  `hired`, and an unlock request from the portal now routes to the companion.
- Edit it from the companion matter. The family matter's Forms card keeps
  **Email link**, **Copy link** and **Download answers**.
- **Remove from matter** on the family matter only drops the cross-link. It
  never deletes the questionnaire.
- Billing is not copied. The companion opens without an engagement fee; bill
  it there or on the family matter as agreed.

The guard on `matter_linked_intakes` still stops one matter's primary intake
being linked to an unrelated matter. The only exception is a link whose
`companion_matter_id` is the matter that intake is primary on.

## Client forms (custom questions)

1. In **Settings → Intake forms**, create a new form with the purpose
   **Client form**.
2. Add sections and questions. The answer types are:
   - short answer, paragraph, single choice, multiple choice;
   - yes/no, date, email, phone, number.
3. Publish the form.
4. On a matter, use **Send form**: pick the form and someone on the matter. The
   recipient gets a `client_form_request` email.
   - A recipient without a portal account gets their standing intake link with
     `next=/forms/<id>`. It signs them up and opens the form.

How it behaves once sent:

- **Pinned version:** each send creates a `client_form_assignments` row pinned to
  the published version, so later edits to the form never change one already sent.
- **Answers:** stored on that row only, keyed by question id. They are never
  copied into the household record or drafting.
- **Staff actions:** **View answers**, **Resend email**, **Withdraw** (before
  submit) and **Reopen for changes** (after submit).
- **Locking:** clients autosave against a revision. A second tab or a staff
  reopen in between turns the save into a "reload" prompt instead of an
  overwrite.

## Deploying

The migration `20270201090000_multiple_forms_per_matter.sql`:

- widens the template `purpose` check;
- adds `matter_linked_intakes` and `client_form_assignments`, both service-role
  only.

`20270202090000_linked_intake_companion_matter.sql` adds
`matter_linked_intakes.companion_matter_id` and relaxes the link guard for that
one case. Push it together with the first one.

The migrations must be pushed deliberately (`npx supabase db push` from the
linked main checkout). Merging does not apply them.
