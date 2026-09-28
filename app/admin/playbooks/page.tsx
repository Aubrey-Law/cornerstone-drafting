import { loadPublishedPrompts } from '@/lib/prompts/repository'
import { requireStaffPage, reviewClient } from '@/lib/review/staff'
import { PlaybookBuilder } from './PlaybookBuilder'

export const dynamic = 'force-dynamic'

/**
 * The playbook builder: upload a precedent, approve the rules it proposes,
 * publish them as a review playbook. Ported from the workbench's `/playbooks`.
 *
 * Published review playbooks are loaded so an attorney can extend one — the
 * trust playbook's next version starts from its current rules — rather than
 * only ever starting fresh.
 */
export default async function PlaybooksPage() {
  await requireStaffPage()

  const prompts = await loadPublishedPrompts(reviewClient())
  const playbooks = prompts.flatMap(prompt =>
    prompt.body.kind === 'review'
      ? [
          {
            slug: prompt.slug,
            title: prompt.title,
            version: prompt.versionNumber,
            rules: prompt.body.rules.map(rule => ({
              title: rule.title ?? null,
              statement: rule.statement,
              risk: rule.risk,
              preferredLanguage: rule.preferredLanguage ?? null,
              conditions: rule.conditions ?? [],
            })),
          },
        ]
      : [],
  )

  return <PlaybookBuilder playbooks={playbooks} />
}
