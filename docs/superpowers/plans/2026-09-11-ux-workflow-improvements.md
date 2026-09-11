# UX workflow improvements

Approved scope: implement all seven recommendations from the repository UX review at `1df1b8b1`.

## Constraints

- Preserve drafting, the existing stepper, server authorization, document provenance, and attorney review requirements.
- No provider configuration, migrations, live data mutations, external sends, or deployment.
- Keep changes on `codex/ux-workflow-improvements`. Commit, push, and a pull request are authorized; merging and deployment remain outside this scope.
- User approval is already recorded in the conversation. Routine implementation decisions do not require another approval.

## Delivery checklist

- [x] Authentication shell: explicit foreground on the dark surface; verify registration/login/recovery.
- [x] Global search: preserve email matches, discard stale results, include Tasks/Calendar/Billing, consistent Command-K. Add request-order and email-match tests.
- [x] Drafting worklist: URL-backed search/sort/action/practice filters, named saved views, session return position; counts respect practice filters. Add URL/count/return-state tests.
- [x] Conflict recovery: pause autosave on conflict, fetch latest authorized sheet, retain both snapshots, compare values, require explicit resolution, protect against another concurrent save. Test concurrent writes, repeated conflict, network failure, and reload recovery.
- [x] Drafting rows: native links and visible focus; scope arrow navigation to the worklist. Test keyboard and modified-click behavior.
- [x] Matter switcher: recent/pinned/search popover in matter detail, preserving compact navigation and shared sidebar data. Test navigation and keyboard access.
- [x] Portal next actions: use recorded pending work, provide direct safe portal links, explicitly describe waiting states, keep visible mobile document labels. Avoid inferring requests from message prose. Test actionable/clear/unavailable states.

## Verification

Run targeted behavior tests with each change. Then run lint, typecheck, complete unit suite, and a production build. Verify dark authentication surfaces in the browser at desktop/mobile sizes. Review the integrated diff for requirements and regressions before completion. Do not claim authenticated production verification without an authenticated session.

## Ownership

Conflict persistence, its UI, and associated tests form an independent bounded work package. Navigation/search/worklist/portal changes are implemented separately. No two implementers own the same files.

## Review and browser evidence

- Independent review findings were fixed and cleared: override metadata, stale recovery reads, restored list ordering, responsive native links, and truthful portal states for closed or absent matters and failed reads.
- Local browser checks covered intake/sign-in at 390px and desktop widths, the drafting worklist, switcher keyboard navigation, URL search/count updates, and explicit conflict selections. Drafting checks used synthetic fixtures; the temporary preview route was removed.
- Intake label foreground is now RGB 228/228/232 on RGB 9/9/11, replacing the inherited dark foreground.
- No authenticated production checks or live mutations were performed. Upload requests were not inferred: the repository has no dedicated portal-safe recorded request source.

## Final verification

- `npm run lint`: exit 0; 0 errors and 10 existing warnings in unchanged files.
- `npm run typecheck`: exit 0.
- `npm run build`: exit 0, including compilation, TypeScript, and static page generation. The initial sandbox attempt could not open the build tool's local IPC socket; the authorized local retry passed.
- Fresh full `npm test` before publication: exit 0; 515 files passed, 5,288 tests passed, 1 skipped. The header tests include the required App Router mock for the matter switcher.
- Final regression run on the completed code: 17 files, 77 tests passed, including that fixture, the two new portal dashboard wiring tests, search, worklist, saved views, switcher, conflict recovery, and preferences.
- `git diff --check`: passed. No remaining independent review findings.
- Implementation made no migration, provider, or deployment changes. Publication uses `codex/ux-workflow-improvements` and a pull request against `main`.
