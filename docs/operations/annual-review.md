# Annual review outreach

A year after a plan is signed, the client hears from the firm. The email names the life
changes that make a plan stale (a marriage, a birth, a child turning 18, a move, a new
account, a death among the people the plan names), offers a booking link for a short
review call, and says a one-line "nothing changed" reply is enough. The firm learns what
changed; the client is reminded the plan exists and who to call.

## What runs

- **When.** Each weekday at 8:20 AM Eastern (`/api/cron/annual-review-outreach`, system
  automation `annual-review-outreach`, paused or dry-run from the Automation center like
  the rest). Off until an administrator turns it on in **Settings → Workflow → Annual
  reviews**.
- **Who.** Every hired matter that is not archived, whose plan is signed (stage
  `signing_complete`, `post_execution`, `funding` or `closed`, or status closed), with a
  client email, that is estate planning (`practice_area` EP or blank), and not opted out.
- **Anchor.** The execution date on the matter details, else the matter's
  `documents_executed_at`, else its signing date. No anchor means the matter is listed as
  "no signing date on file" in the preview and never asked.
- **Which review.** The first is the anchor plus *months after signing* (default 12). After
  one cycle has been drafted or sent, each *months between reviews* (default 12) after it. A
  plan signed years ago is caught up to its next review, not every one it missed: an
  anniversary more than about two months past is skipped forward to the next one.
- **Notice.** The invitation goes out *days of notice* before the due date (default 14) and
  keeps being due until a row exists for that cycle.

The pure rules are in `lib/annualReview/model.ts`; `lib/annualReview/server.ts` reads the
records, drafts, and offers the send.

## What is recorded

`annual_review_outreach` (`20270116090000_annual_review_outreach.sql`), one row per matter per
review due date: the email as drafted (subject, text, HTML, booking link), `status`
(drafted, sent, skipped, failed), who sent it and when, the portal message that carried the
same words, and any error. `unique (matter_id, cycle_due_on)` is what stops a second run,
or a re-run after a crash, from asking twice. Staff-only.

The four campaign settings live on `firm_settings`
(`annual_review_outreach_enabled`, `annual_review_months_after_signing`,
`annual_review_cadence_months`, `annual_review_lead_days`). A per-matter opt-out lives on
`matter_details.annual_review_opt_out`, switched from the Close-out card on the matter's
Billing tab, since a closed plan is exactly the audience.

## The delegation dial

Each drafted invitation is offered as `annual_review.outreach.send` (risk: leaves the firm;
group: Communications), keyed `annual-review:<row id>` so one cycle is one decision.

- **Propose** (the default). A card waits on Today with the recipient, the review date, and
  the full text. Approving it sends.
- **Act and report.** The email goes out at once and the send is listed in the digest.
- **Observe.** The proposal is recorded as what would have been sent; nothing goes out.

Unlike an invoice reminder, the proposal is created even at Propose: the card is the queue
the attorney works from. Without an attorney on file to run as, the rows stay `drafted` and
appear under "Recent invitations" on the Settings page.

Sending (`sendAnnualReviewOutreach`) uses the `annual_review_outreach` email category from
the firm's address, posts the same words as a portal message when the client has an account,
writes an `email_sent` entry to the matter timeline, and marks the row sent. A refused send
marks the row `failed` with the error and the proposal shows the failure. An email the kill
switch or a category toggle kept in marks the row `skipped` with the reason, so the cycle is
not re-asked by accident; turn the category back on and approve the next cycle, or send by
hand from the matter.

## The booking link

The email carries the booking link for the **Client Call** meeting type
(`resolveBookingLink`): a configured outside scheduler if Settings names one, else the firm's
own booking page for that appointment type. When neither is available the email asks the
client to reply instead of linking anywhere.

## Settings page

**Settings → Workflow → Annual reviews** shows the switch and the three cadence numbers
(administrators change them; everyone can read), who the next run would ask and why others are
not asked, and the last twenty invitations with their status. The preview reads the same rules
as the run, so what it lists is what the next weekday morning drafts.

## Relation to the "Annual review" rule template

The older rule template (`annual-review`, trigger `annual_review_due`) creates an internal
task on the matter when a plan is a year old and skips closed matters. It is unchanged. This
campaign is the client-facing half and reaches the closed matters the task never did; a firm
that wants both can run both.
