Prepare recoverable workflow claims without enabling the queue. Expiring, token-fenced claims prevent an old worker from completing a reclaimed job; bounded processing, retry limits, and the disabled fast path remain explicit. Move invoice-reminder draft preparation to its own authenticated hourly cron; preparation does not send messages.

Release step 3; based on `codex/firm-app-communications-retirement`.

Validation: synthetic PostgreSQL integration checks cover independent claims, expiry/reclaim, stale completion, attempts and permissions. Unit checks cover the disabled queue, worker budgeting, and reminder deduplication. The combined series passes 5,032 root tests. Read-only production recheck confirms `durable_workflow_jobs_enabled=false` and zero queued jobs.

Rollout gate: review and apply additive migration `20261123000000_workflow_job_leases.sql` before deploying the consumer. The production RPC check will report the new functions missing until that happens. Keep the queue disabled: side-effect replay safety, including annual-review task creation, requires separate activation evidence. Legacy RPCs are retained for compatibility; reverting consumers leaves the additive schema and historical data intact.
