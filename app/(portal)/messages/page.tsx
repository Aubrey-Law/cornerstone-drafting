import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerSupabase } from '@/lib/supabaseServer'
import { getMatterForUser } from '@/lib/portal/getMatterForUser'
import { Button } from '@/components/ui/button'
import MessageThread from './MessageThread'
import type { Message } from './actions'

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

  const { data: messages } = await supabase
    .from('messages')
    .select('*')
    .eq('matter_id', matterId)
    .order('created_at', { ascending: true })

  await supabase.rpc('mark_messages_read', {
    p_matter_id: matterId,
    p_reader_role: 'client',
  })

  return (
    <MessageThread
      matterId={matterId}
      messages={(messages ?? []) as Message[]}
      clientUserId={user.id}
    />
  )
}
