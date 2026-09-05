Opened by the Database types drift workflow. `packages/db-types/src/supabase.generated.ts` no longer described the deployed schema; this is `npm run db:types:linked` run against it, unedited.

**Nothing has tested this yet.** GitHub starts no workflow run for a pull request opened by a workflow's own token, so none of the four required checks have run. The absence of red here means nothing has been checked, not that nothing is wrong — which is why this arrives as a draft rather than as something you could merge.

**Click "Ready for review" to run them.** That is an event from you rather than from the workflow, so it starts the full gate: lint, typecheck and the test suite with both apps compiled against these types, plus the three database checks. Pushing any commit to the branch does the same.

Worth reading the diff before you do. Both apps compile against this file, so a column that has disappeared from the database surfaces here as a type error — which is the point of the file, and the reason a green tick on it should mean something.
