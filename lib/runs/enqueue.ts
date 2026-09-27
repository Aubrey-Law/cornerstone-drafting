/**
 * Nudging the queue so a run starts now rather than on the next tick.
 *
 * Deliberately a no-op. The run queue's cron (`app/api/cron/run-queue`) fires
 * every minute, so a queued run starts within the minute without a nudge.
 *
 * The workbench poked its tick by fetching it, and awaited the response —
 * which only comes back once the tick has worked the run for up to its whole
 * four-minute budget, so the request that queued a review waited on it too.
 * A fire-and-forget fetch is no better on a serverless host: the function
 * that sent it can be frozen the moment it returns, taking the request with
 * it. A review that starts up to a minute later is the cheaper of the three.
 *
 * Kept so callers copied from the workbench need no change.
 */
export async function pokeTick(): Promise<void> {}
