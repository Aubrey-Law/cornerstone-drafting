import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerSupabase } from '@/lib/supabaseServer'
import { getMatterForUser } from '@/lib/portal/getMatterForUser'
import { Button } from '@/components/ui/button'
import MessageThread from './MessageThread'
import { readMessageHistory } from '@/lib/messages/history'

export default async function MessagesPage() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  const matter = await getMatterForUser(supabase, user.id)

  if (!matter) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <div className="max-w-md rounded-xl border border-border bg-card p-6 text-center">
          <p className="text-sm font-semibold text-foreground">Messages will open after intake review</p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            The firm is still setting up your matter. You can continue your intake or check your dashboard for current next steps.
          </p>
          <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
            <Button asChild size="sm">
              <Link href="/dashboard">Return to dashboard</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/intake">View intake</Link>
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const matterId = matter.id

  const history = await readMessageHistory(supabase, matterId)

  return (
    <MessageThread
      key={matterId}
      matterId={matterId}
      messages={history.messages}
      older={history.older}
      clientUserId={user.id}
    />
  )
}
