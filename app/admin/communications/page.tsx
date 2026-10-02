import Link from 'next/link'
import { Mail, MessageSquareText, MessagesSquare } from 'lucide-react'
import { getCachedClaims } from '@/lib/supabaseServer'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { fetchWorkGraphForUser } from '@/lib/work/server'
import { AdminPageShell } from '@/components/layout/AdminPageShell'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ApprovalInbox, type ApprovalProposal } from '@/app/admin/components/ApprovalInbox'

export const dynamic = 'force-dynamic'

export default async function CommunicationsPage() {
  const auth = await getCachedClaims()
  const [graph, pendingResult] = await Promise.all([
    auth ? fetchWorkGraphForUser(auth.id) : Promise.resolve(null),
    auth
      ? getAdminClient().from('action_proposals')
        .select('id, action_key, risk, display_summary, confirmation_policy, created_at')
        .eq('actor_id', auth.id)
        .eq('status', 'pending')
        .eq('risk', 'external_write')
        .order('created_at', { ascending: false })
        .limit(10)
      : Promise.resolve({ data: [] }),
  ])
  const communication = graph?.items.filter(item =>
    item.sourceType === 'email' || item.sourceType === 'sms' || item.sourceType === 'portal_message',
  ) ?? []
  const count = (source: 'email' | 'sms' | 'portal_message') =>
    communication.filter(item => item.sourceType === source).length

  return (
    <AdminPageShell className="mx-auto w-full max-w-[1180px]">
      <PageHeader
        eyebrow="Operations"
        title="Communications"
        description="One attention list for email, text, and secure client messages. Reply in the specialist view without losing the firm-wide queue."
      />

      <Card id="send-approvals" className="border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/10">
        <CardHeader>
          <CardTitle className="text-base">Ready to send</CardTitle>
          <CardDescription>Review the exact recipient, channel, and content here before an external message goes out. A changed draft must be reviewed again.</CardDescription>
        </CardHeader>
        <CardContent>
          <ApprovalInbox
            initialProposals={(pendingResult.data ?? []) as ApprovalProposal[]}
            emptyMessage="No prepared external messages are waiting for approval."
          />
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-3">
        {[
          { title: 'Email', count: count('email'), href: '/admin/email-triage', icon: Mail, detail: 'Triage, draft, approve, and reply.' },
          { title: 'Texts', count: count('sms'), href: '/admin/texts', icon: MessageSquareText, detail: 'Unread and unlinked conversations.' },
          { title: 'Client portal', count: count('portal_message'), href: '/admin/matters/list', icon: MessagesSquare, detail: 'Secure matter conversations.' },
        ].map(channel => (
          <Card key={channel.title}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2"><channel.icon className="h-4 w-4" />{channel.title}</span>
                <span className="text-2xl tabular-nums">{channel.count}</span>
              </CardTitle>
              <CardDescription>{channel.detail}</CardDescription>
            </CardHeader>
            <CardContent><Button asChild variant="outline" size="sm"><Link href={channel.href}>Open {channel.title.toLowerCase()}</Link></Button></CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Needs a response</CardTitle>
          <CardDescription>Oldest waiting clients rise first. Message bodies stay in their source systems.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {communication.length ? communication.map(item => (
            <Link key={item.workKey} href={item.href} className="flex items-center justify-between gap-3 rounded-lg border p-3 hover:bg-accent">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{item.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{item.record.name} · {item.priorityReasons[0]?.label}</span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{item.estimateMinutes} min</span>
            </Link>
          )) : <p className="py-8 text-center text-sm text-muted-foreground">No messages are waiting for the firm.</p>}
        </CardContent>
      </Card>
    </AdminPageShell>
  )
}
