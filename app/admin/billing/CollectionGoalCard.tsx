import { Target } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import type { BillingSnapshot } from '@/lib/billing/types'
import { money } from './financeFormat'

export function CollectionGoalCard({ snapshot }: { snapshot: BillingSnapshot }) {
  const { amount, goal, progressPercent } = snapshot.collectedYtd
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b border-border py-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Target className="size-4 text-muted-foreground" aria-hidden />
          Collection goal
        </CardTitle>
        <p className="text-xs text-muted-foreground">{progressPercent}% of the annual goal</p>
      </CardHeader>
      <CardContent className="space-y-2 py-3">
        <p className="text-2xl font-semibold tabular-nums">{money(amount)}</p>
        <Progress
          value={progressPercent}
          className="h-1.5"
          aria-label={`${progressPercent}% of the annual collection goal`}
        />
        <p className="text-xs text-muted-foreground">
          of {money(goal)} · {money(Math.max(0, goal - amount))} to go
        </p>
      </CardContent>
    </Card>
  )
}
