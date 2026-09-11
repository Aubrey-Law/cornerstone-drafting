# Firm app release review

The owner authorized publication. All four branches have been pushed and opened as draft PRs in the existing private repository. The implementation worktree remains at `/tmp/cornerstone-remediation`. No PR has been merged and no production migration or deployment was performed by this publication step.

## Published review sequence

| Draft PR | Branch | PR base | Review description |
| --- | --- | --- | --- |
| [#453](https://github.com/spaubrey/cornerstone-drafting/pull/453) | `codex/firm-app-release-guardrails` (`edb91db3`) | `main` (`03e284d0`) | [Build safeguards](firm-app-release/01-build-safeguards.md) |
| [#454](https://github.com/spaubrey/cornerstone-drafting/pull/454) | `codex/firm-app-communications-retirement` (`b3749832`) | `codex/firm-app-release-guardrails` | [Communications retirement and reliability](firm-app-release/02-communications-and-reliability.md) |
| [#455](https://github.com/spaubrey/cornerstone-drafting/pull/455) | `codex/firm-app-workflow-recovery` (`826133cc`) | `codex/firm-app-communications-retirement` | [Disabled queue recovery](firm-app-release/03-disabled-queue-recovery.md) |
| [#456](https://github.com/spaubrey/cornerstone-drafting/pull/456) | `codex/firm-app-remediation` | `codex/firm-app-workflow-recovery` | [Navigation and working lists](firm-app-release/04-navigation-and-working-lists.md) |

These are dependent review branches. The proposed release order is 1 through 4. After a prerequisite lands on main, retarget the next PR to main and recheck its diff and CI before merging. Do not merge later work into an earlier review branch.

Publication covered these four branches and four draft PRs with the linked descriptions. Each draft's CI has started against its own branch head; final results are pending. Main remains unchanged by publication. Local application verification applies to code revision `428df951`; this publication update changes documentation only.

## What the app changes

- Calling, texting, Inbox, browser phone SDKs, and automated SMS are retired. Secure client portal messages, email, communication history, consent records, and signed callbacks remain.
- Leads, matters, tasks, invoices, and ledger views use complete server counts and bounded working pages. Billing selections use bounded search. Secondary calendar/planning work no longer holds up the primary Today content.
- Matter and lead badges stop downloading capped task lists. Matter intake/upload reads begin when their own dependency is available. Failed uploads and badge refreshes do not claim zero outstanding work.
- Portal history is paged and marks only displayed messages read. Probate and estate progress use persisted milestones. Drafting output remains protected by its corpus checks.

## Evidence and release conditions

See [execution evidence](2026-09-10-firm-app-remediation-evidence.md) and [live baseline](2026-09-10-navigation-benchmark.md). Current local tests, build, lint, and typecheck are recorded there. The live baseline includes delays up to 8.95 seconds; no deployed speed improvement is claimed.

Before queue consumer deployment, review and apply `20261123000000_workflow_job_leases.sql`. Before list consumer deployment, review and apply `20261124000000_working_list_reads.sql`. Both are additive and tested against synthetic PostgreSQL fixtures. Production currently ends at migration `20261122000000`; queue recovery remains disabled with zero jobs. Shared-schema RPC checks will report the new functions missing until the reviewed migrations are applied; retain that release gate.

Production acceptance still requires a synthetic staff/client portal message roundtrip, authenticated failure/retry and mobile checks, reviewed deployment SHA, and native before/after timing. Some matter history/design comparisons and older secondary overview reads remain eager; additional tuning should use the deployed traces. Queue activation and provider cancellation/routing changes are separate decisions.
