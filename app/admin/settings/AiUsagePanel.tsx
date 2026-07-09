'use client'

import { useEffect, useState } from 'react'
import { Activity, AlertTriangle } from 'lucide-react'
import { estimateUsdCost } from '@/lib/aiUsage'
import { fetchRecentAiUsage, type AiUsageRow, type AiUsageTotals } from '@/app/actions/aiUsage'

function fmtTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function fmtUsd(n: number) {
  if (n >= 1) return `$${n.toFixed(2)}`
  if (n >= 0.01) return `$${n.toFixed(3)}`
  return `$${n.toFixed(4)}`
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function AiUsagePanel() {
  const [rows, setRows] = useState<AiUsageRow[]>([])
  const [totals, setTotals] = useState<AiUsageTotals>({
    calls: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    failures: 0,
  })
  const [windowDays, setWindowDays] = useState(30)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchRecentAiUsage(30)
      .then(snapshot => {
        if (cancelled) return
        setRows(snapshot.rows)
        setTotals(snapshot.totals)
        setWindowDays(snapshot.windowDays)
        setError(null)
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load usage')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section className="space-y-4 rounded-lg border border-border p-4">
      <div className="flex items-center gap-2">
        <Activity className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">AI Usage</h2>
        <span className="text-xs text-muted-foreground">Last {windowDays} days</span>
      </div>

      {loading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Loading usage…</div>
      ) : error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Token usage and estimated spend across the matter assistant, AI redline, design-sheet
            import, tabular review, and draft refinement. Cost is an estimate based on published
            model rates and may not match invoices exactly.
          </p>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="Calls" value={totals.calls.toLocaleString()} />
            <Stat
              label="Input tokens"
              value={fmtTokens(totals.input + totals.cacheRead + totals.cacheWrite)}
            />
            <Stat label="Output tokens" value={fmtTokens(totals.output)} />
            <Stat label="Est. cost" value={fmtUsd(totals.cost)} />
            <Stat
              label="Failures"
              value={totals.failures.toString()}
              tone={totals.failures > 0 ? 'warn' : 'default'}
            />
          </div>

          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Route</th>
                  <th className="px-3 py-2 font-medium">Context</th>
                  <th className="px-3 py-2 font-medium">Model</th>
                  <th className="px-3 py-2 text-right font-medium">In</th>
                  <th className="px-3 py-2 text-right font-medium">Out</th>
                  <th className="px-3 py-2 text-right font-medium">Cost</th>
                  <th className="px-3 py-2 text-right font-medium">Latency</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                      No AI usage in the last {windowDays} days.
                    </td>
                  </tr>
                ) : (
                  rows.map(row => {
                    const cost = estimateUsdCost(row)
                    return (
                      <tr key={row.id} className="border-t border-border">
                        <td className="px-3 py-2 text-foreground">{fmtTime(row.created_at)}</td>
                        <td className="px-3 py-2 font-mono text-[11px]">{row.route}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {row.context_type ?? '—'}
                        </td>
                        <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                          {row.model}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {fmtTokens(
                            row.input_tokens +
                              row.cache_read_input_tokens +
                              row.cache_creation_input_tokens
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {fmtTokens(row.output_tokens)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtUsd(cost)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {row.duration_ms != null ? `${(row.duration_ms / 1000).toFixed(1)}s` : '—'}
                          {!row.success && (
                            <span
                              title={row.error_message ?? 'Failed'}
                              className="ml-1 inline-flex"
                            >
                              <AlertTriangle className="h-3 w-3 text-destructive" />
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

function Stat({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string
  tone?: 'default' | 'warn'
}) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={`mt-1 text-lg font-semibold tabular-nums ${
          tone === 'warn' ? 'text-destructive' : 'text-foreground'
        }`}
      >
        {value}
      </div>
    </div>
  )
}
