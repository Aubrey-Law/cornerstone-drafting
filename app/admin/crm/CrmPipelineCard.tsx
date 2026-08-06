import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { CrmPipelineStage } from '@/lib/crm/dashboard'

const PALETTE = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
]

export function CrmPipelineCard({ stages }: { stages: CrmPipelineStage[] }) {
  const total = stages.reduce((sum, stage) => sum + stage.count, 0)

  return (
    <Card className="min-w-0 gap-0 py-0">
      <CardHeader className="border-b border-border py-3">
        <CardTitle className="text-sm">Pipeline</CardTitle>
        <p className="text-xs text-muted-foreground">People by stage, in the firm&apos;s stage order</p>
      </CardHeader>
      <CardContent className="px-4 py-4">
        {stages.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No stages configured.</p>
        ) : (
          <>
            <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-muted" aria-hidden>
              {stages.map((stage, index) => (
                stage.count > 0 && (
                  <span
                    key={stage.key}
                    style={{
                      width: `${total > 0 ? (stage.count / total) * 100 : 0}%`,
                      backgroundColor: PALETTE[index % PALETTE.length],
                    }}
                  />
                )
              ))}
            </div>

            <dl className="mt-4 space-y-3">
              {stages.map((stage, index) => (
                <div key={stage.key} className="flex items-center gap-3">
                  <dt className="flex min-w-0 flex-1 items-center gap-2">
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: PALETTE[index % PALETTE.length] }}
                      aria-hidden
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{stage.label}</span>
                      <span className="block text-xs text-muted-foreground">
                        {stage.count} {stage.count === 1 ? 'person' : 'people'}
                        {stage.isWon ? ' · won' : ''}
                      </span>
                    </span>
                  </dt>
                  <dd className="flex shrink-0 items-center gap-2">
                    <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted sm:block" aria-hidden>
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${stage.percent}%`,
                          backgroundColor: PALETTE[index % PALETTE.length],
                        }}
                      />
                    </span>
                    <span className="w-9 text-right text-xs font-medium tabular-nums">
                      {stage.percent}%
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </CardContent>
    </Card>
  )
}
