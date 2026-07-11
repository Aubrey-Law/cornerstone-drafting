import { requireAdmin } from '@/lib/apiAuth'
import { generateEngagementTemplateToken } from '@/lib/esign/firma'

export const runtime = 'nodejs'

/**
 * POST /api/admin/esign/template-token — mint a short-lived JWT that authorizes
 * the browser-side firma.dev template editor to edit the engagement-agreement
 * template. The firma API key never leaves the server; only this token does.
 */
export async function POST(req: Request) {
  const { user, err } = await requireAdmin(req)
  if (err) return err
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const result = await generateEngagementTemplateToken()
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 501 })
  }

  return Response.json({ token: result.token, templateId: result.templateId })
}
