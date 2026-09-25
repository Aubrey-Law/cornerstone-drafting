import { redirect } from 'next/navigation'
import { LOGIN_PATH } from '@/lib/auth/gate'
import { loadPublishedPrompts } from '@/lib/prompts/repository'
import { getAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/supabase/server'
import { PlaybookBuilder } from './PlaybookBuilder'

export const metadata = { title: 'Build a playbook · Aubrey Law Workbench' }

/**
 * The playbook builder: upload a precedent, approve the rules it proposes,
 * publish them as a review playbook.
 *
 * Published review playbooks are loaded so an attorney can extend one — the
 * trust playbook's next version starts from its current rules — rather than
 * only ever starting fresh.
 */
export default async function PlaybooksPage() {
  const user = await getSessionUser()
  if (!user) redirect(LOGIN_PATH)

  const prompts = await loadPublishedPrompts(getAdminClient())
  const playbooks = prompts.flatMap((prompt) =>
    prompt.body.kind === 'review'
      ? [
          {
            slug: prompt.slug,
            title: prompt.title,
            version: prompt.versionNumber,
            rules: prompt.body.rules.map((rule) => ({
              statement: rule.statement,
              risk: rule.risk,
              preferredLanguage: rule.preferredLanguage ?? null,
            })),
          },
        ]
      : [],
  )

  return <PlaybookBuilder playbooks={playbooks} />
}
