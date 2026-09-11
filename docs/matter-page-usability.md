# Matter page usability pass

Implements the first four recommendations from the matter page review.

- Put the next action before overview metrics and supporting details. Later-stage and closed matters get lifecycle-specific actions; an available current stage task shows its recorded owner and due date.
- Separate advisory review flags from uploads and unread messages. Link each review flag to its resolver, uploads to their review surface, and messages to portal communications.
- Await inline saves, retain failed text/date/selection edits, and expose local saving, saved, retry, and discard feedback. Additional contact channels also remain editable after failure. Successful contact mutations invalidate the other mounted matter views.
- Use scheduled future dates in the summary, open the matching calendar day, open scheduling when no date exists, and link stage age to recorded history. Unreviewed document shortcuts flatten incoming files across folders and keep filter changes reflected in the URL.

No schema, authorization, drafting generation gates, or external sends are changed. The remaining recommendations—stage/navigation separation, duplicate information reduction, broader workspace context preservation, and mobile navigation refinements—remain outside this pass.

Regression coverage includes lifecycle states, attention links, save failures and retries, duplicate submission protection, settled date entry, contact invalidation, document filtering, and calendar date parsing.
