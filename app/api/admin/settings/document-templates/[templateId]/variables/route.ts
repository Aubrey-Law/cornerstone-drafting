import { NextRequest, NextResponse } from 'next/server'
import { requireAdministrator } from '@/lib/apiAuth'
import { getDocumentTemplateDefinition } from '@/lib/documentTemplates/registry'
import { resolveDocumentTemplate } from '@/lib/documentTemplates/resolver'
import { extractTemplateVariables } from '@/lib/estateGenerator/templateVariables'
import { describeField, renderSingleTemplateForMatter } from '@/lib/drafting/quickDraft'

export const runtime = 'nodejs'

type Params = { params: Promise<{ templateId: string }> }

/**
 * What a template needs: the static variable/clause list extracted from the
 * active DOCX (published override or bundled), and — when `?matterId=` is
 * given — which of those fields the matter cannot yet resolve.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { err } = await requireAdministrator(req)
  if (err) return err
  const { templateId } = await params
  const matterId = req.nextUrl.searchParams.get('matterId')?.trim() || null

  try {
    const definition = getDocumentTemplateDefinition(templateId)
    if (!definition) {
      return NextResponse.json({ error: 'Unknown document template.' }, { status: 404 })
    }
    const resolved = await resolveDocumentTemplate(templateId)
    const report = extractTemplateVariables(resolved.buffer)

    let perMatter: {
      matterId: string
      missingFields: ReturnType<typeof describeField>[]
      unresolvedMarkers: string[]
      warnings: string[]
      error?: string
    } | null = null

    if (matterId) {
      if (definition.category !== 'estate') {
        perMatter = {
          matterId,
          missingFields: [],
          unresolvedMarkers: [],
          warnings: [],
          error: 'Per-matter analysis is available for estate templates only.',
        }
      } else {
        try {
          const rendered = await renderSingleTemplateForMatter({ matterId, templateId, allowPartial: true })
          perMatter = {
            matterId,
            missingFields: rendered.missingFields.map(describeField),
            unresolvedMarkers: rendered.unresolvedMarkers,
            warnings: rendered.warnings,
          }
        } catch (analysisError) {
          perMatter = {
            matterId,
            missingFields: [],
            unresolvedMarkers: [],
            warnings: [],
            error: analysisError instanceof Error ? analysisError.message : 'Analysis failed',
          }
        }
      }
    }

    return NextResponse.json({
      templateId,
      source: resolved.source,
      versionLabel: resolved.versionLabel,
      variables: report.variables.map(describeField),
      clauses: report.clauses,
      localVariables: report.localVariables,
      perMatter,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to analyze template variables' },
      { status: 500 },
    )
  }
}
