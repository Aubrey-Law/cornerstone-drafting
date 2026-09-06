/**
 * Nudge the tick route so a queued run starts now rather than on the next cron.
 *
 * Fire-and-forget, and a failure is deliberately not an error: cron will pick
 * the run up within the minute. A run that starts a few seconds late is not a
 * run that failed, and reporting it as one would turn a cosmetic delay into a
 * red message on screen.
 *
 * The absolute URL is the part that usually breaks. A relative fetch works in
 * development and silently does nothing in production, so the base comes from
 * VERCEL_URL when it is set and localhost otherwise.
 */
export async function pokeTick(): Promise<void> {
  const secret = process.env.CRON_SECRET
  if (!secret) return
  const base = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000'
  try {
    await fetch(`${base}/api/cron/tick`, {
      headers: { authorization: `Bearer ${secret}` },
    })
  } catch {
    // See above: cron is the guarantee, this is only the hurry.
  }
}
