import { redirect } from 'next/navigation'

export const dynamic = 'force-static'

export default function SignupPage() {
  redirect('/auth/login?tab=create')
}
