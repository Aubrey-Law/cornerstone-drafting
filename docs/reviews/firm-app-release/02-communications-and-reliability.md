Remove in-app calling, texting, the unified Inbox, and automated SMS while keeping secure portal messages, transactional email, callback validation, communication history, and consent records. Old manual send/token routes return authenticated 410 responses, and the Inbox redirects to Today.

Also correct the reliability seams needed by the retained workflows: request-scoped authorization reuse, explicit failed reads, posted invoice-adjustment accounting, canonical/legacy matter identity handling, and lazy document/message panes. Remove seven proven dead-code orphans and the browser phone SDKs.

Release step 2; based on `codex/firm-app-release-guardrails`. Review the branch-relative diff. No provider cancellation, number-routing change, client send, historical-data deletion, or new staff-role activation is included.

Validation: the combined series passes 5,032 root tests, the production build, lint, and typecheck. The earlier slice passed communications, authorization, accounting, identity and portal boundary checks; the corpus remained 45/45 unchanged and workbench verification passed. Independent CI and a synthetic portal send/read/reply walkthrough remain review gates.

Rollout: after the build safeguards. Preserve external provider routing. Rollback must not silently restore outbound SMS or browser calling tokens; forward-fix authorization, accounting, and error-state defects.
