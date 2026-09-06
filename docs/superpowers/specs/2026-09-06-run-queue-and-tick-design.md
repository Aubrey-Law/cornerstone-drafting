# The run queue and the tick route — phase 4, third slice

**Date:** 2026-09-06
**Phase:** 4 of `docs/superpowers/plans/2026-09-02-workbench-overhaul.md`, third sub-project
**Follows:** `2026-09-05-run-steps-and-retry-design.md`
**Status:** design approved by the owner 2026-09-06

## Why now, when the last slice said not yet

The previous slice deliberately did not build this, on a measurement: a unit takes about
ten seconds, `maxDuration` is 300, so roughly thirty units fit in one invocation — and the
library was two prompts of three and six units. A queue would have been infrastructure
whose failure modes nothing could exercise.

**The owner's answer, 2026-09-06: the ~40-prompt library is coming.** That is the case the
measurement said would need this. A forty-unit run is roughly four hundred seconds of
work; it cannot finish in one invocation, and the failure would be a run dying at the
ceiling with no way to resume.

So this is built for that shape: a run that spans several ticks.

## The run is the queue

No second table. `workflow_runs.status = 'queued'` already means there is work to do, and
`workflow_run_steps` already says which units remain. A parallel `workflow_jobs` row would
be a second source of truth about the same work, and the two would drift the first time
one was written without the other.

`workflow_runs` gains three columns:

- `last_tick_at timestamptz` — the heartbeat, and the name the plan doc already used for this watchdog
- `locked_by text` — which worker holds it, so a claim is visible rather than implied
- `reclaims integer not null default 0` — how many times the reaper has handed it back, so a run that kills every worker it touches stops being handed to the next one

## Claiming is an RPC, because PostgREST cannot express it

Two ticks must never work the same run. That needs `for update skip locked`, which
PostgREST has no way to say, so claiming is a Postgres function:

`claim_workflow_run(p_worker text) returns workflow_runs`

It selects one `queued` run — oldest first — `for update skip locked`, sets `status`
`running`, stamps `locked_by` and `last_tick_at`, and returns it. Two concurrent ticks get
different runs or nothing, never the same one.

`20261004000000_solo_practice_efficiency_billing.sql` already does exactly this for a job
queue; follow it rather than inventing a second idiom.

### A gap this exposes

`scripts/checkDbRpcs.mjs` scans `['app', 'lib', 'components']` **from the repository root**
— it does not scan `apps/workbench` at all.

This is not merely a gap this slice would open. The workbench already calls one RPC that
nothing has ever verified: `ensure_user_profile`, in `lib/supabase/profile.ts`, on the
**sign-in path**. It does exist — checked against PostgREST on 2026-09-06, one of 89
exposed — so nothing is broken today. But had it been dropped or renamed, sign-in would
have failed in production with no check catching it first, which is the exact outage this
workflow was written after: migration 20260812000000 was recorded as applied while its SQL
never ran, two functions vanished, and every lead edit failed until someone noticed by
hand.

That is the same shape as the hole that let `matters.title` ship: a guard that does not
cover the code being written. The checker is extended to scan the workbench in this slice —
which is worth doing for the sign-in dependency alone, before any queue — and the extension
is proven by pointing a call at a function that does not exist and watching it fail.

## The tick route

`apps/workbench/app/api/cron/tick/route.ts` — `maxDuration = 300`, authenticated with
`Bearer $CRON_SECRET`, in the same shape as the root app's cron routes
(`app/api/cron/workflow-jobs/route.ts`). It fails closed when the secret is unset: no
secret means 401, never "allow".

Its loop:

1. Reap first (below), so a run killed by the last deploy is available to this tick.
2. Claim a run.
3. Work its `pending` steps one at a time, stamping `last_tick_at` after each.
4. **Stop at a time budget of about 240 seconds**, well inside the 300 ceiling, and leave the remaining steps `pending`. The run stays `running` with a fresh heartbeat; the next tick continues it.
5. When no `pending` steps remain, `finaliseRun` from the steps — the function the previous slice already built.

A forty-unit run takes two ticks. Nothing about a step changes: the same three-phase
recording, the same verification, the same fail-soft.

## Two things that keep it from feeling like a batch job

**A tick fires on enqueue.** Queueing a run also pokes the tick route, so work starts
immediately and cron is the safety net rather than the mechanism. Waiting up to a minute to
begin would make every run feel broken.

**Retry goes through the same path.** One code path, not two behaviours: a retry queues its
run the same way a first run does, and the page reads progress from the steps. A retry of
one unit finishes in one tick; a retry of twenty does not have to.

### The self-call needs an absolute URL, and that is where this usually breaks

A server action poking its own route cannot use a relative path. On Vercel `VERCEL_URL` is
the *deployment* URL, not the production alias, and it is absent locally — so a naive
`fetch('/api/cron/tick')` works in development and silently does nothing in production,
which is the worst of both.

The poke resolves its base from `VERCEL_URL` when present and falls back to localhost, is
fire-and-forget, and **a failed poke is never an error**: cron will pick the run up within
the minute. A run that starts a few seconds late is not a run that failed, and treating it
as one would turn a cosmetic delay into a red error on screen.

### `openRun` now opens `queued`, not `running`

The previous slice had it open `running`, because the caller ran the engine immediately.
Now the caller enqueues and returns, and `running` means a worker holds it. A run is
`queued` from `openRun` until a tick claims it.

### The tick rebuilds a run's context exactly as retry does

Both need the same thing from stored state: the prompt body at the run's own
`prompt_version_id`, and the pinned evidence — `resolved_inputs` for a field audit, the
layer read back from `document_text_layers` for a review. `retryFailedSteps` already does
this. It is factored out rather than written twice, because two copies of "rebuild what
this run was asked" would drift, and the drift would look like a queued run and a retried
run disagreeing about the same document.

## The reaper

A run that is `running` with `last_tick_at` older than ten minutes was killed mid-flight —
a deploy, an invocation limit, a crash. Nothing will ever finish it, and without this it
sits `running` forever, which reads as "in progress" rather than "abandoned".

The reaper marks its `running` steps `failed` with that reason, then:

- under three `reclaims`, sets the run back to `queued` and increments `reclaims`
- at three, leaves it `partial` for a person, because a run that has killed three workers is not going to survive a fourth, and retrying it automatically forever is how a queue turns one bad run into a permanent load

It runs at the top of the tick route. A separate cron for something this cheap would be
more moving parts than the job is worth.

## `CRON_SECRET` is required, and its absence must fail the build

`CRON_SECRET` is **not currently set on the workbench Vercel project** — the owner
confirmed this. A queue whose worker can never authenticate is worse than no queue: runs
would enqueue, the tick would 401, and every run would sit `queued` with nothing saying
why.

So it joins `REQUIRED_SERVER_ENV` in `lib/env.ts`, whose comment states the convention
outright: *"Add a variable here when the code that reads it lands, in the same PR."* A
missing variable then fails the deploy build with every missing name at once, and on Vercel
a failed build leaves the previous deployment serving — the safe direction.

**Operationally this means the secret must be set on the workbench project before this
merges,** or main's next deploy fails. That is the intended failure: loud, before anything
depends on it, rather than a cron silently 401ing for a week.

## Cadence

Every minute — the owner confirmed Vercel Pro, which allows minute-level crons. With the
enqueue-time tick doing the starting, the cron's job is only to continue long runs and to
reap; a minute keeps a forty-unit run finishing in two or three minutes rather than two
hours.

`apps/workbench/vercel.json` has no `crons` key today; this adds the first one.

## What must not change

The synchronous path's *results*. A queued run must produce exactly the findings,
references, citations and tasks the synchronous one did — the queue changes when work
happens, never what it concludes. The existing suites are the check on that, and they must
pass unmodified.

## Testing

- Pure functions tested directly: the time budget, the reap decision, the reclaim cap.
- **A tick that runs out of budget leaves the rest `pending` and the run resumable** — asserted by driving a tick with a clock that advances past the budget mid-run, and confirming the untouched steps are still `pending` and the run still `running` with a fresh heartbeat.
- **Two concurrent ticks never claim the same run** — proven against the real database, because it is the one property a stub cannot demonstrate: `for update skip locked` is the database's behaviour, not the app's.
- **A reaped run's steps say why**, and a run at the reclaim cap stops requeueing.
- The extended `checkDbRpcs.mjs` is proven by pointing a workbench call at a missing function and watching it fail.
- A real forty-unit run is not available yet, so the multi-tick path is proven by lowering the budget rather than by inventing a long playbook — and that substitution is stated plainly rather than glossed.

## Out of scope, named

Realtime progress (the page polls; a websocket is a separate question), priority or
fairness between runs, and any change to how a unit is executed or verified. Parallelism
within a run stays out: forty sequential calls against one cached prefix is the design the
prompt caching depends on, and running them concurrently would trade a cache hit rate for
wall-clock in a way nothing has measured.
