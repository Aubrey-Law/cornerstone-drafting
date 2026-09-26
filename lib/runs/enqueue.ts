/**
 * Nudging the queue so a run starts now rather than on the next tick.
 *
 * The tick that claims and works queued runs still lives in the review
 * workbench (`apps/workbench/app/api/cron/tick`, every minute); it reads the
 * same database, so a run queued from Cornerstone is picked up within the
 * minute without a nudge. There is nothing to poke from here until the tick
 * moves into Cornerstone, so this is deliberately a no-op, kept so callers
 * copied from the workbench need no change.
 */
export async function pokeTick(): Promise<void> {}
