import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const routeSource = fs.readFileSync(
  path.join(process.cwd(), 'app/api/admin/esign/template-token/route.ts'),
  'utf8',
)

const firmaSource = fs.readFileSync(
  path.join(process.cwd(), 'lib/esign/firma.ts'),
  'utf8',
)

describe('esign template-token route source shape', () => {
  it('requires admin auth', () => {
    expect(routeSource).toContain('requireAdmin')
  })

  it('returns 501 when the template token cannot be minted', () => {
    expect(routeSource).toContain('generateEngagementTemplateToken')
    expect(routeSource).toContain('501')
  })

  it('runs on the nodejs runtime and never returns the api key', () => {
    expect(routeSource).toContain("runtime = 'nodejs'")
    expect(routeSource).not.toContain('FIRMA_API_KEY')
    expect(routeSource).toContain('token: result.token')
  })
})

describe('generateEngagementTemplateToken', () => {
  it('reports the missing env vars when unconfigured', () => {
    expect(firmaSource).toContain('FIRMA_API_KEY')
    expect(firmaSource).toContain('FIRMA_ENGAGEMENT_TEMPLATE_ID')
    expect(firmaSource).toContain('E-signature is not configured')
  })

  it('mints the token via the firma generate-template-token endpoint', () => {
    expect(firmaSource).toContain('generate-template-token')
    expect(firmaSource).toContain('companies_workspaces_templates_id')
  })
})
