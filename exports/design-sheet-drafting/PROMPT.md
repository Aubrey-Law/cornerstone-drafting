# Prompt: add the design sheet & drafting feature to this app

> **Setup.**
> 1. Unzip `design-sheet-drafting.zip` into this repo, for example `unzip design-sheet-drafting.zip -d vendor/`. That gives `vendor/design-sheet-drafting/{README.md,SPEC.md,BUILD_PLAN.md,PROMPT.md,schema.sql,source/}`.
> 2. Add `vendor/` to this app's tsconfig `exclude` and to its lint ignores while the work is in progress.
> 3. Paste everything below the line into Claude Code from this repo's root. If you put the folder somewhere else, change the path in the first paragraph.

---

I'm adding an already-built estate-planning **design sheet and document
drafting** feature to this app. It comes from another Next.js + Supabase app
where it runs in production. The code is in `vendor/design-sheet-drafting/`.

Before changing anything, read these three files in full, in this order:

1. `vendor/design-sheet-drafting/README.md`: every file, every place the code depends on the original app, env vars, and what was already verified.
2. `vendor/design-sheet-drafting/SPEC.md`: what the feature does and the invariants it must keep.
3. `vendor/design-sheet-drafting/BUILD_PLAN.md`: the phases you will follow.

**The goal.** Staff in this app can do the following for a client matter:

- Open a design sheet seeded from the client's intake. It autosaves with conflict protection and shows what is still undecided.
- Run a preflight that lists the documents and missing fields.
- Generate the Word documents deterministically from the bundled templates, then download them or save them to the matter.
- Review each draft, convert it to PDF, and share it with the client. A draft with a `[[ MISSING ]]` marker can't be shared.
- Later phases add the drafting hub, quick draft, the clause library, template overrides, style sets, AI autofill and real-estate transfer documents. Do these only if I say they're in scope.

**Ground rules**

- **Keep the behavior.** Treat the bundled code as a working reference. Adapt the edges (auth, data model, storage, routes, branding) to this app. Change core logic only when this app requires it.
- **Core logic stays as it is.** The core is:
  - `packages/drafting-engine/**`
  - `tools/aubreylaw-docgeneration/**`
  - `lib/draftPayload/**`
  - `lib/designSheetPersistence.ts`, `lib/designSheet/useDesignSheetState.ts`, `lib/designSheet/designSheetConflict.ts`
  - `lib/drafting/{runStore,runState,sourceSnapshot,supersede,persistGeneratedDocument}.ts`
  - `lib/documents/shareGate.ts`
- **Keep the ten invariants in SPEC.md §5.** If an adaptation would break one, stop and ask me.
- **Fit this app's layout.** The bundle's paths assume a Next.js App Router root with the `@/*` alias. If this app is organized differently, move the files and fix the imports. Don't add a second alias just to keep the original layout.
- **Use this app's existing pieces** wherever they exist: Supabase clients, auth guard, UI primitives, `cn()`, toasts, theme tokens, file storage, activity log. Use a bundle copy only when this app has nothing equivalent. If this app already has shadcn components, use them and delete the bundled `components/ui/*`.
- **Every seam needs a decision.** That means every file marked `// HOST ADAPTER (stub)` and every row in README "Seams" sections 3 and 4. Either connect it to this app's data, or remove the code path cleanly. Don't leave a query to a table this app doesn't have, or a `fetch` to a route that doesn't exist.
- **Database:** `schema.sql` is the source of truth. Don't apply the files in `source/supabase/migrations/`; they are history. Keep the "Privileges (explicit)" block. Without it, the drafting RPCs become callable from the browser.
- **Tests:** move `source/tests/*` into this app's test setup and keep them green as you adapt. Add tests for every host adapter you implement for real. A test marked `EXTRACTED` checks something from the original app; delete it, or rewrite it for this app's equivalent.

**Before writing code**, look through this repo, then ask me only what you
can't find out yourself. These are BUILD_PLAN.md phase 0. Most likely:

1. **Matters and people.** What is a matter here, and where do client identity, the intake questionnaire and people (spouse, children, fiduciaries) live? Give me a column map from README "Host contract" to this app's tables. Ask me only about the gaps.
2. **Staff vs. clients.** How does this app tell them apart? The bundle assumes `users.role IN ('attorney','admin')`.
3. **Scope.** Which of these do I want: hub, quick draft, clause library, template overrides, style sets, AI assist (and which provider), real-estate transfer, client sharing?
4. **Templates.** Keep the bundled Massachusetts forms (rebranded), or use my own? Firm name, attorney, time zone.
5. **Storage.** Cloudflare R2 as bundled, or this app's existing file storage?

**Then work through BUILD_PLAN.md phase by phase.**

- Commit after each phase. Lint, typecheck and tests must pass at every commit.
- Check each phase's "Done when" yourself before moving on, and tell me the result.
- Phase 3 must render a document from the command line before any UI work starts.

**Definition of done**

- Lint, typecheck and the full test suite pass, including the moved drafting tests.
- `grep -rn "HOST ADAPTER" .` lists only no-ops we agreed to keep.
- No moved code queries a missing table. Check `.from('…')` and `.rpc('…')` against this app's schema.
- No moved code fetches a missing route.
- `has_function_privilege('authenticated', 'public.claim_draft_generation_run(uuid,uuid,uuid,text,text,text[],uuid)', 'execute')` is false.
- Locally, on a test matter:
  - The sheet seeds, autosaves, and survives a reload.
  - A second tab produces a conflict dialog, not an overwrite.
  - Preflight lists documents.
  - Download and save both work.
  - A double-clicked Generate makes one set.
  - Editing between preflight and generate gives `SOURCE_CHANGED`.
  - A draft with `MISSING` can't be shared.
  - Review and share work.
- On a preview deployment: one full generation, one quick draft (if in scope) and one design-summary export work. This proves the template files are in the serverless bundle.
- Tell me:
  - which seams you connected and which you removed;
  - which templates still carry the original firm's branding;
  - anything you couldn't verify, such as live R2, the PDF worker or LLM calls.
