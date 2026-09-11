type Scope = 'proxy' | 'admin-layout'
type Phase = 'auth' | 'role' | 'model-label'
type Outcome = 'pending' | 'success' | 'error'
type Measurement = { phase: Phase; startMs: number; durationMs: number; outcome: Outcome }
type Measure = <T>(phase: Phase, read: () => T | PromiseLike<T>) => Promise<T>

const SLOW_REQUEST_MS = 1500

/** Fixed-label timings only. Callers cannot pass routes, IDs, payloads, or error text. */
export async function profileServerRequest<T>(
  scope: Scope,
  load: (measure: Measure) => Promise<T>,
): Promise<{ value: T; serverTiming: string }> {
  const started = performance.now()
  const phases: Measurement[] = []
  let outcome: Outcome = 'success'
  const measure: Measure = async (phase, read) => {
    const phaseStarted = performance.now()
    const entry: Measurement = {
      phase,
      startMs: Math.round(phaseStarted - started),
      durationMs: 0,
      outcome: 'pending',
    }
    phases.push(entry)
    try {
      const value = await read()
      entry.outcome = 'success'
      return value
    } catch (error) {
      entry.outcome = 'error'
      throw error
    } finally {
      entry.durationMs = Math.round(performance.now() - phaseStarted)
    }
  }

  try {
    const value = await load(measure)
    const durationMs = Math.round(performance.now() - started)
    if (durationMs >= SLOW_REQUEST_MS) {
      try {
        console.info('[server-request-timing]', { scope, durationMs, outcome, phases })
      } catch { /* diagnostics are best effort */ }
    }
    const tokens = [`${scope};dur=${durationMs}`]
    for (const phase of phases) tokens.push(`${phase.phase};dur=${phase.durationMs}`)
    return { value, serverTiming: tokens.join(', ') }
  } catch (error) {
    outcome = 'error'
    const durationMs = Math.round(performance.now() - started)
    if (durationMs >= SLOW_REQUEST_MS) {
      try {
        console.info('[server-request-timing]', { scope, durationMs, outcome, phases })
      } catch { /* diagnostics are best effort */ }
    }
    throw error
  }
}
