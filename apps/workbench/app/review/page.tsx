import { redirect } from 'next/navigation'
import { LOGIN_PATH } from '@/lib/auth/gate'
import { loadReviewPlaybook } from '@/lib/review/playbook'
import { loadRunSummaries } from '@/lib/review/history'
import { loadReviewableByMatter } from '@/lib/review/matterDocuments'
import { getAdminClient } from '@/lib/supabase/admin'
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
  // Every draft reviewed here is the firm's own and already filed, so the
  // normal path is choosing one rather than uploading it.
  const matters = await loadReviewableByMatter(getAdminClient())
  const runs = await loadRunSummaries(getAdminClient(), 15)

  return (
    <ReviewWorkspace
      runs={runs}
      matters={matters.map((matter) => ({
        matterId: matter.matterId,
        title: matter.title,
        documents: matter.documents.map((document) => ({
          versionId: document.versionId,
          name: document.name,
          kind: document.source.kind,
        })),
      }))}
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
