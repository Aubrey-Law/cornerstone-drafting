import { redirect } from 'next/navigation'

export default function CallsPage() {
  redirect('/admin/inbox?scope=unlinked_calls')
}
