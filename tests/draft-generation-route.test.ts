import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const routePath = path.join(process.cwd(), 'app/api/admin/matters/[id]/draft/route.ts')

describe('matter draft generation route', () => {
  it('uses bearer-aware admin auth for client-triggered generation', () => {
    const authSource = fs.readFileSync(path.join(process.cwd(), 'lib/apiAuth.ts'), 'utf8')
    const routeSource = fs.readFileSync(routePath, 'utf8')

    expect(authSource).toContain('const token = getBearerToken(_req)')
    expect(authSource).toContain('const user = await userFromBearer(token)')
    expect(routeSource).toContain("import { getBearerToken, requireAdmin } from '@/lib/apiAuth'")
    expect(routeSource).toContain('const token = getBearerToken(req)')
  })

  it('uses request-aware fallback URLs instead of hardcoding the dev port', () => {
    const source = fs.readFileSync(routePath, 'utf8')

    expect(source).toContain("import { getRequestOrigin } from '@/lib/requestOrigin'")
    expect(source).toContain('function getBaseUrl(req: NextRequest)')
    expect(source).toContain('return getRequestOrigin(req)')
    expect(source).not.toContain("return 'http://localhost:3000'")
  })

  it('forwards admin authorization to both fallback drafting calls', () => {
    const source = fs.readFileSync(routePath, 'utf8')
    const fallbackSection = source.slice(
      source.indexOf('async function generateFallbackFiles'),
      source.indexOf('type Params'),
    )

    expect(fallbackSection).toContain('function fallbackAuthHeaders')
    expect(fallbackSection).toContain('if (token) return { Authorization: `Bearer ${token}` }')
    expect(fallbackSection).toContain("const cookie = req.headers.get('cookie')")
    expect(fallbackSection).toContain('return cookie ? { Cookie: cookie } : {}')
    expect(fallbackSection.match(/\.\.\.authHeaders/g)).toHaveLength(2)
  })

  it('validates R2 settings before upload attempts', () => {
    const source = fs.readFileSync(routePath, 'utf8')

    expect(source).toContain("requireConfiguredEnv('R2_ACCESS_KEY_ID')")
    expect(source).toContain("requireConfiguredEnv('R2_SECRET_ACCESS_KEY')")
    expect(source).toContain('assertR2Configured()')
    expect(source.indexOf('assertR2Configured()')).toBeLessThan(source.indexOf('getR2Client()'))
  })

  it('uses the Node estate generator as the draft engine (legacy Python subprocess retired)', () => {
    const source = fs.readFileSync(routePath, 'utf8')
    const engineSource = fs.readFileSync(path.join(process.cwd(), 'packages/drafting-engine/src/estateGenerator/engine.ts'), 'utf8')

    expect(source).toContain('resolveEstateGeneratorEngine')
    expect(source).toContain('llmFallbackEngineLabel')
    expect(source).toContain('@/lib/estateGenerator/engine')
    expect(source).toContain('const engine: EstateGeneratorEngine = resolveEstateGeneratorEngine()')
    expect(engineSource).toContain("process.env.ESTATE_GENERATOR_ENGINE?.trim().toLowerCase()")
    expect(engineSource).toContain("if (raw === 'supabase' || raw === 'typescript') return 'supabase'")
    expect(engineSource).not.toContain("return 'python'")
    expect(engineSource).toContain("return 'node'")
    expect(source).toContain("await import('@/lib/estateGenerator/node/generate').then(mod => mod.generateEstatePlanDocumentsNode(payload, { matterId: canonicalMatterId }))")
    expect(source).not.toContain('runEstateGenerator')
    expect(source).not.toContain("} else if (engine === 'python') {")
    expect(source).not.toContain('function shouldUsePythonEstateGenerator')
  })

  it('keeps validation blockers as 422s, distinct from unsupported-package 501s', () => {
    const nodeSource = fs.readFileSync(path.join(process.cwd(), 'lib/estateGenerator/node/generate.ts'), 'utf8')
    const blockerSection = nodeSource.slice(
      nodeSource.indexOf('if (blockingError)'),
      nodeSource.indexOf('if (unsupported.length > 0)'),
    )

    expect(blockerSection).toContain('error: blockingError')
    expect(blockerSection).toContain('status: 422')
    expect(blockerSection).not.toContain('status: 501')
  })

  it('adds an authenticated preflight endpoint before draft documents are saved', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'app/api/admin/matters/[id]/draft/preflight/route.ts'), 'utf8')

    expect(source).toContain("import { requireAdmin } from '@/lib/apiAuth'")
    expect(source).toContain("import { buildDraftPayload, resolveMatterId } from '@/lib/buildDraftPayload'")
    expect(source).toContain("import { buildEstateDraftPreflight } from '@/lib/estateGenerator/preflight'")
    expect(source).toContain('export async function GET')
    expect(source).toContain('const { err } = await requireAdmin(req)')
    expect(source).toContain('const canonicalMatterId = await resolveMatterId(matterId)')
    expect(source).toContain('const preflight = buildEstateDraftPreflight(payload)')
  })

  it('clause-library text fallback reads the latest design sheet only', () => {
    const textRoute = fs.readFileSync(path.join(process.cwd(), 'app/api/drafting/route.ts'), 'utf8')

    expect(textRoute).toContain("import { resolveMatterId } from '@/lib/buildDraftPayload'")
    expect(textRoute).toContain('const resolvedMatterId = await resolveMatterId(matter_id, admin)')
    expect(textRoute).toContain(".from('design_sheets')")
    expect(textRoute).toContain(".order('created_at', { ascending: false })")
    expect(textRoute).toContain('.limit(1)')
    expect(textRoute).not.toContain(".from('client_intake')")
    expect(textRoute).not.toContain(".from('v_matter_pipeline').select('*').eq('matter_id', matter_id).single()")
    expect(textRoute).not.toContain(".from('design_sheets').select('*').eq('matter_id', matter_id).single()")
  })

  it('DOCX fallback uses canonical draft payload flat projection', () => {
    const docxRoute = fs.readFileSync(path.join(process.cwd(), 'app/api/drafting/docx/route.ts'), 'utf8')

    expect(docxRoute).toContain("import { buildDraftPayload, resolveMatterId } from '@/lib/buildDraftPayload'")
    expect(docxRoute).toContain('projectDraftPayloadToFlatSheet')
    expect(docxRoute).toContain('const flatSheet = projectDraftPayloadToFlatSheet(payload)')
    expect(docxRoute).not.toContain('buildFlatSheet')
    expect(docxRoute).not.toContain(".from('client_intake')")
  })

  it('AI refinement failure falls back to assembled clause-library text', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'app/api/drafting/route.ts'), 'utf8')

    expect(source).toContain("let refinedText = assembledText")
    expect(source).toContain("modelStatus: 'refined' | 'clause_library'")
    expect(source).toContain("AI refinement failed; using clause library draft")
    expect(source).toContain('return NextResponse.json({ text: refinedText, doc_type, label, modelStatus })')
  })

  it('matter draft fallback preserves non-JSON drafting error details', () => {
    const source = fs.readFileSync(routePath, 'utf8')

    expect(source).toContain('const draftRaw = await draftRes.text()')
    expect(source).toContain('tryParseJson<{ error?: string; text?: string; label?: string }>(draftRaw)')
    expect(source).toContain('const docxRaw = await docxRes.text()')
    expect(source).toContain('function tryParseJson')
  })

  it('DOCX fallback route uses an ASCII-safe download filename and JSON errors', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'app/api/drafting/docx/route.ts'), 'utf8')

    expect(source).toContain('function safeHeaderFilename')
    expect(source).toContain(".replace(/[^\\x20-\\x7E]/g, '')")
    expect(source).toContain('`${label ?? doc_type} - ${clientName}.docx`')
    expect(source).toContain("return NextResponse.json({ error: `Failed to build DOCX: ${message}` }, { status: 500 })")
    expect(source).not.toContain(' — ')
  })

  it('surfaces generator and coverage warnings in the draft response', () => {
    const source = fs.readFileSync(routePath, 'utf8')

    expect(source).toContain('function draftCoverageWarnings')
    expect(source).toContain('include_testamentary_trust_will')
    expect(source).toContain('draftWarnings')
    expect(source).toContain('warningsFromGenerateResult(generateResult)')
    expect(source).toContain('warnings: draftWarnings')
  })

  it('atomically registers database-backed Node files and rolls back R2 on persistence failure', () => {
    const source = fs.readFileSync(routePath, 'utf8')

    expect(source).toContain("import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'")
    expect(source).toContain("import { persistGeneratedEstateDocument } from '@/lib/estateClauses/persistGeneratedDocument'")
    expect(source).toContain('clauseSource: meta.clauseSource')
    expect(source).toContain('clauseManifest: meta.clauseManifest')
    expect(source).toContain("if (file.clauseSource === 'database')")
    expect(source).toContain('await persistGeneratedEstateDocument({')
    expect(source).toContain('new DeleteObjectCommand({ Bucket: r2Bucket(), Key: r2Key })')

    const branchStart = source.indexOf("if (file.clauseSource === 'database')")
    const databaseBranch = source.slice(branchStart, source.indexOf('} else {', branchStart))
    expect(databaseBranch).not.toContain('ensureInitialVersion')
    expect(source.slice(branchStart, source.indexOf('uploadedFilenames.push(documentName)'))).toContain('} else {')
  })

  it('routes legacy testamentary-trust fallback drafts through dedicated doc types', () => {
    const source = fs.readFileSync(routePath, 'utf8')
    const textRoute = fs.readFileSync(path.join(process.cwd(), 'app/api/drafting/route.ts'), 'utf8')
    const docxRoute = fs.readFileSync(path.join(process.cwd(), 'app/api/drafting/docx/route.ts'), 'utf8')

    expect(source).toContain("| 'will_testamentary_trust'")
    expect(source).toContain("| 'wills_testamentary_x2'")
    expect(source).toContain('if (payload.documents.include_simple_will) {')
    expect(source).toContain("docTypes.push(spouseDocs ? 'wills_x2' : 'will_individual')")
    expect(source).toContain('if (payload.documents.include_testamentary_trust_will) {')
    expect(source).toContain("docTypes.push(spouseDocs ? 'wills_testamentary_x2' : 'will_testamentary_trust')")

    expect(textRoute).toContain("will_testamentary_trust:         'pour_over_will'")
    expect(textRoute).toContain("wills_testamentary_x2:           'pour_over_will'")
    expect(textRoute).toContain("will_testamentary_trust:         'Last Will and Testament with Testamentary Trust'")
    expect(textRoute).toContain("wills_testamentary_x2:           'Last Wills and Testaments with Testamentary Trusts (x2)'")
    expect(docxRoute).toContain("'wills_testamentary_x2'")
  })

  it('legacy Supabase fallback reads the hosted doc selection schema', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/drafting/generateDocuments.ts'), 'utf8')

    expect(source).toContain("import { docSelectionTemplateKey } from '@/lib/drafting/docSelectionKey'")
    expect(source).toContain(".select('doc_type, variant, party, selected')")
    expect(source).toContain('docSelectionTemplateKey(selection)')
    expect(source).not.toContain('template_filename')
  })

  it('legacy Supabase fallback uses buildDraftPayload flat projection', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/drafting/generateDocuments.ts'), 'utf8')

    expect(source).toContain("import { buildDraftPayload } from '@/lib/buildDraftPayload'")
    expect(source).toContain('projectDraftPayloadToFlatSheet')
    expect(source).toContain('const flatSheet = projectDraftPayloadToFlatSheet(payload)')
    expect(source).toContain('buildClientVariables(flatSheet)')
    expect(source).toContain('buildSpouseVariables(flatSheet)')
    expect(source).not.toContain('buildClientVariables(s)')
    expect(source).not.toContain('buildFlatSheet')
  })
})
