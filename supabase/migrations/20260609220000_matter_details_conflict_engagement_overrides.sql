-- Manual override flags for the "Conflict pending" and "Engagement pending"
-- pills on the matter detail page. The TypeScript type already references
-- these columns; this migration brings the database in line.
--
-- conflict_cleared:   true  → force pill to "Conflict cleared"
--                     false → force pill to "Conflict pending" (even if a
--                             formal conflict check was completed)
--                     null  → fall back to conflict_check_completed
-- engagement_signed:  true  → force pill to "Engagement signed"
--                     false/null → "Engagement pending"
ALTER TABLE matter_details
  ADD COLUMN IF NOT EXISTS conflict_cleared boolean,
  ADD COLUMN IF NOT EXISTS engagement_signed boolean;
