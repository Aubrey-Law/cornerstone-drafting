import Link from 'next/link'
import { AlertTriangle, ArrowRight, CalendarDays, Clock3 } from 'lucide-react'
import { AdminPageShell } from '@/components/layout/AdminPageShell'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getCachedClaims } from '@/lib/supabaseServer'
import { fetchWorkGraphForUser, fetchWorkPreferences } from '@/lib/work/server'
import { buildWeeklyReview } from '@/lib/work/weeklyReview'

export const dynamic = 'force-dynamic'

function minutes(value: number): string {
  if (value < 60) return `${value} min`
  const hours = Math.floor(value / 60)
  const rest = value % 60
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

export default async function WeeklyReviewPage() {
  const auth = await getCachedClaims()
  if (!auth) return null
  const now = new Date()
  const [graph, preferences] = await Promise.all([
    fetchWorkGraphForUser(auth.id, now, { horizonDays: 14 }),
    fetchWorkPreferences(auth.id),
  ])
  const review = buildWeeklyReview({ items: graph.items, preferences, now })

  return (
    <AdminPageShell className="mx-auto w-full max-w-[1240px]">
      <PageHeader
        eyebrow="Planning"
        title={`Week of ${new Date(`${review.weekStart}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
        description="A deterministic preview of dated work for the coming week. Daily plans still check live calendar availability before any time is committed."
        actions={<Button asChild variant="outline" size="sm"><Link href="/admin"><ArrowRight /> Open Today</Link></Button>}
      />

      {review.overflowMinutes > 0 ? (
        <div role="alert" className="mb-4 flex gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
          <span><strong>{minutes(review.overflowMinutes)} exceeds the daily guardrails.</strong> Move, delegate, or reschedule a specific item; the review never silently drops work.</span>
        </div>
      ) : null}

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Card><CardHeader className="pb-2"><CardDescription>Dated work</CardDescription><CardTitle className="text-2xl tabular-nums">{minutes(review.plannedMinutes)}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Weekly focus guardrail</CardDescription><CardTitle className="text-2xl tabular-nums">{minutes(review.capacityMinutes)}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Start with</CardDescription><CardTitle className="truncate text-base">{review.firstAction?.title ?? 'No firm-owned work due'}</CardTitle></CardHeader></Card>
      </div>

      <section className="grid gap-3 lg:grid-cols-5" aria-label="Coming workweek">
        {review.days.map(day => (
          <Card key={day.date} className={day.overflowMinutes ? 'border-destructive/50' : undefined}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-base"><span>{day.label}</span><span className="text-xs font-normal text-muted-foreground">{minutes(day.plannedMinutes)}</span></CardTitle>
              <CardDescription>{new Date(`${day.date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · guardrail {minutes(day.capacityMinutes)}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {day.items.length ? day.items.map(item => (
                <Link key={item.workKey} href={item.href} className="block rounded-md border p-2 text-sm hover:bg-accent">
                  <span className="block line-clamp-2 font-medium">{item.title}</span>
                  <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><Clock3 className="h-3 w-3" />{minutes(item.estimateMinutes)} · {item.record.name}</span>
                </Link>
              )) : <p className="py-2 text-xs text-muted-foreground">No dated work.</p>}
              {day.overflowMinutes ? <Badge variant="destructive">{minutes(day.overflowMinutes)} over</Badge> : null}
              <Button asChild variant="ghost" size="sm" className="w-full text-xs"><Link href={`/admin/calendar?date=${day.date}`}><CalendarDays /> View calendar</Link></Button>
            </CardContent>
          </Card>
        ))}
      </section>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Flexible work</CardTitle><CardDescription>Important work without a date this week. Choose deliberately in each daily plan.</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            {review.flexible.length ? review.flexible.slice(0, 8).map(item => <Link key={item.workKey} href={item.href} className="block rounded-md border p-2 text-sm hover:bg-accent">{item.title}<span className="ml-2 text-xs text-muted-foreground">{minutes(item.estimateMinutes)} · {item.priorityReasons[0]?.label}</span></Link>) : <p className="text-sm text-muted-foreground">No undated priority work needs a slot yet.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Waiting or blocked</CardTitle><CardDescription>Visible for planning, but excluded from your focus capacity.</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            {review.waiting.length ? review.waiting.slice(0, 8).map(item => <Link key={item.workKey} href={item.href} className="block rounded-md border p-2 text-sm hover:bg-accent">{item.title}<span className="ml-2 text-xs text-muted-foreground">{item.priorityReasons[0]?.label}</span></Link>) : <p className="text-sm text-muted-foreground">Nothing is waiting or blocked.</p>}
          </CardContent>
        </Card>
      </div>
    </AdminPageShell>
  )
}
