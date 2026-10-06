# File closing and retention

Closing a matter is one action that finishes the file properly: the billing check, both
lifecycle axes, the closed date, the day the retention period ends, and a closing notice
to the client offered through the delegation dial. A weekly run lists the files past
their date for the attorney to review. Nothing is destroyed on its own.

## Closing

Two paths close a matter and both end the same way:

- **Close-out card** (matter → Billing). The button is enabled once the close-out gates are
  met. It moves the stage to `closed` through the stage route, which now runs the status
  transition first (`transition_matter_status_with_closeout`, the RPC with the billing check:
  an unpaid balance, an open plan claim, a ready milestone or a pending adjustment refuses the
  close with a 409 unless a documented financial exception is active), then the stage RPC, the
  task sweep, and `finishMatterClose`. Leaving `closed` by stage sets the status back to
  active.
- **Matter status dropdown** → Closed. The status route runs the same RPC, the task sweep, and
  `finishMatterClose`. Archived is a visibility change and does not finish the file or tell
  the client anything.

`finishMatterClose` (`lib/fileClosing/server.ts`) stamps `matter_details.closed_date` and
`matter_details.retention_until` where they are missing (closed date plus the firm's retention
years), then schedules the closing notice behind the response. The browser no longer writes
the closed date itself.

## The closing notice

Composed from the record (`composeClosingNotice`, pure): the work is complete, keep the signed
originals safe and tell the people the plan names where they are, where copies live (the
portal when the client has an account, else the firm), that lives change and the plan should
too (with the annual review line when that campaign is on and the matter has not opted out),
and how long the firm keeps the file and until what date.

Offered as `matter.closing.notice.send` (risk: leaves the firm; group: Communications), keyed
to the matter and the day it closed. At Propose a card waits on Today with the full text; at
Act and report it sends at once. Sending uses the `matter_closing_notice` email category from
the firm's address, posts the same words as a portal message when the client has an account,
and writes an `email_sent` entry on the matter timeline. The notice is composed again at send
from the record, so what the attorney approved is what goes out; a record that changed in
between fails the digest check instead of sending. The switch to turn the notice off is in
**Settings → Workflow → File closing**.

## Retention

- `firm_settings.file_retention_years` (default 6; Massachusetts Rule of Professional Conduct
  1.15A asks for at least six) and `closing_notice_enabled`.
- `matter_details.retention_until`, `retention_hold`, `retention_hold_reason`. The hold is a
  switch on the Close-out card after the matter closes and on the Settings page; a held file is
  never listed for destruction.
- Migration `20270117090000_file_closing_retention.sql` backfills `retention_until` for every
  file already closed with a closed date.

**File retention review** (`/api/cron/file-retention`, system automation `file-retention`,
Mondays 8:40 AM Eastern) gives any closed file still missing a retention date one from its
closed date, then for every file past its date and not on hold proposes a `task.create` through
the dial ("File retention review: {client}"), keyed to the matter and the retention date so a
second Monday is a no-op. The task tells the attorney where to decide.

**Settings → Workflow → File closing** lists the files past their date (each with a hold switch
and, for administrators, a Destroy action), the files on hold, closed files with no retention
date (record the closed date on the matter and the next run stamps the rest), the files within
their period, and the last ten destructions. Destroy goes through the existing permanent delete
(`DELETE /api/admin/matters/[id]` with `confirm: true` and the reason "Retention period ended
…"), which removes the matter, its documents and R2 objects, and writes the `matter_deletions`
record with who did it and why. It asks for the word DESTROY first.

## Also fixed here

The "Signing closeout" automation queued its `fire_stage_task` job with `stage: 'closeout'`,
the engine key rather than the pipeline stage, so the job mapped nothing and never created the
closeout task. It now sends `post_execution`, the stage whose template it is.
