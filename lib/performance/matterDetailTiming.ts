import 'server-only'

type Phase = 'identity' | 'matter-shell' | 'core' | 'contacts' | 'aging' | 'details'
  | 'notes' | 'design' | 'intake-snapshot' | 'activity' | 'stage-history' | 'task-counts'
  | 'estate' | 'client-intake' | 'lead-history' | 'consent' | 'upload-counts'
  | 'esign-documents' | 'work-graph'
type Outcome = 'pending' | 'success' | 'error'
type Measurement = { phase: Phase; startMs: number; durationMs: number; outcome: Outcome }
type Measure = <T>(phase: Phase, read: () => T | PromiseLike<T>) => Promise<T>
const SLOW_PAGE_MS = 1500

/** Timings only, in existing server logs. Never accepts IDs, URLs, payloads or error text. */
export async function profileMatterDetail<T>(load: (measure: Measure) => Promise<T>): Promise<T> {
  const started = performance.now()
  const phases: Measurement[] = []
  let outcome: Outcome = 'success'
  const measure: Measure = async (phase, read) => {
    const phaseStart = performance.now()
    const entry: Measurement = { phase, startMs: Math.round(phaseStart - started), durationMs: 0, outcome: 'pending' }
    phases.push(entry)
    try {
      const value = await read()
      entry.outcome = 'success'
      return value
    } catch (error) {
      entry.outcome = 'error'
      throw error
    } finally {
      entry.durationMs = Math.round(performance.now() - phaseStart)
    }
  }
  try {
    return await load(measure)
  } catch (error) {
    outcome = 'error'
    throw error
  } finally {
    const durationMs = Math.round(performance.now() - started)
    if (durationMs >= SLOW_PAGE_MS || outcome === 'error') {
      // Snapshot pending phases: rejected Promise.all siblings may still finish.
      // Diagnostic failure must never replace the page's result or exception.
      try {
        console.info('[matter-detail-timing]', {
          durationMs, outcome,
          phases: phases.map(entry => ({ ...entry, durationMs: entry.outcome === 'pending'
            ? Math.max(0, durationMs - entry.startMs) : entry.durationMs })),
        })
      } catch { /* logging is best effort */ }
    }
  }
}
