import { redirect } from 'next/navigation'
import { LOGIN_PATH } from '@/lib/auth/gate'
import { loadReviewPlaybook } from '@/lib/review/playbook'
import { getSessionUser } from '@/lib/supabase/server'
import { ReviewWorkspace } from './ReviewWorkspace'

export const metadata = { title: 'Review a draft · Aubrey Law Workbench' }

/**
 * The findings workspace.
 *
 * The playbook is read on the server so the screen can name the rules it is
 * about to apply before anything is uploaded — an attorney should know what is
 * being checked, not just what came back.
 */
export default async function ReviewPage() {
  const user = await getSessionUser()
  if (!user) redirect(LOGIN_PATH)

  const playbook = loadReviewPlaybook()

  return (
    <ReviewWorkspace
      playbook={{
        title: playbook.title,
        version: playbook.version,
        rules: playbook.rules.map((rule) => ({
          number: rule.number,
          risk: rule.risk,
          statement: rule.statement,
        })),
      }}
    />
  )
}
