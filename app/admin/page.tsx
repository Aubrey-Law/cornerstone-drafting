import { redirect } from 'next/navigation'
import { DEFAULT_ADMIN_HOME } from '@/lib/auth/safeRedirect'

export default function AdminPage() {
  redirect(DEFAULT_ADMIN_HOME)
}
