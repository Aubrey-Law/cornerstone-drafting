'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, FileCheck2, Loader2, RotateCcw, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MatterSearchPicker } from './MatterSearchPicker'

interface TemplateVersion {
  id: string
  versionNumber: number
  originalFilename: string
  byteSize: number
  validationStatus: 'pending' | 'valid' | 'invalid'
  validationReport: { error?: string; warnings?: string[]; missingFields?: string[] } | null
  createdAt: string
  isActive: boolean
  canCancel: boolean
}

interface TemplateRow {
  id: string
  label: string
  category: 'estate' | 'real_estate' | 'engagement'
  bundledPath: string
  packageNames: string[]
  activeVersionId: string | null
  activeSource: 'bundled' | 'published'
  publishedAt: string | null
  publishedBy: string | null
  versions: TemplateVersion[]
}

interface TemplateFieldInfo {
  path: string
  label: string
  type: string
  description: string | null
}

interface TemplateVariablesReport {
  source: 'bundled' | 'published'
  versionLabel: string
  variables: TemplateFieldInfo[]
  clauses: string[]
  perMatter: {
    matterId: string
    missingFields: TemplateFieldInfo[]
    unresolvedMarkers: string[]
    warnings: string[]
    error?: string
  } | null
}

const CATEGORY_LABELS = {
  estate: 'Estate planning',
  real_estate: 'Real-estate transfers',
  engagement: 'Engagement agreements',
} as const

function templateLastUpload(template: TemplateRow): TemplateVersion | null {
  return template.versions.reduce<TemplateVersion | null>((latest, version) => {
    if (!latest) return version
    return new Date(version.createdAt).getTime() > new Date(latest.createdAt).getTime() ? version : latest
  }, null)
}

export function DocumentTemplatesSection() {
  const token = useAccessToken()
  const [templates, setTemplates] = useState<TemplateRow[]>([])
  const [migrationRequired, setMigrationRequired] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [matterIds, setMatterIds] = useState<Record<string, string>>({})
  const [variablesByTemplate, setVariablesByTemplate] = useState<Record<string, TemplateVariablesReport | 'loading'>>({})

  const authHeaders = useMemo<Record<string, string>>(() => {
    if (!token) return {} as Record<string, string>
    return { Authorization: `Bearer ${token}` }
  }, [token])
  const headers = useCallback(() => authHeaders, [authHeaders])
  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const response = await fetch('/api/admin/settings/document-templates', { headers: headers(), cache: 'no-store' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Could not load document templates')
      setTemplates(body.templates ?? [])
      setMigrationRequired(Boolean(body.migrationRequired))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load document templates')
    } finally {
      setLoading(false)
    }
  }, [headers, token])

  useEffect(() => { void load() }, [load])

  async function upload(template: TemplateRow, file: File | undefined) {
    if (!file) return
    setBusy(template.id)
    try {
      const form = new FormData()
      form.set('file', file)
      const response = await fetch(`/api/admin/settings/document-templates/${template.id}/versions`, {
        method: 'POST', headers: headers(), body: form,
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Upload failed')
      toast.success('Template staged. You can validate it against a matter or publish it directly.')
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Upload failed')
    } finally {
      setBusy(null)
    }
  }

  async function validate(template: TemplateRow, version: TemplateVersion) {
    const matterId = matterIds[template.id]?.trim()
    if (!matterId) return toast.error('Choose a compatible validation matter first.')
    setBusy(version.id)
    try {
      const response = await fetch(
        `/api/admin/settings/document-templates/${template.id}/versions/${version.id}/validate`,
        {
          method: 'POST',
          headers: { ...headers(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ matterId }),
        },
      )
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.report?.error ?? body.error ?? 'Validation failed')
      toast.success('Template passed validation.')
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Validation failed')
      await load()
    } finally {
      setBusy(null)
    }
  }

  async function publish(template: TemplateRow, version: TemplateVersion, rollback: boolean) {
    const confirmation = window.prompt(`Type ${template.id} to ${rollback ? 'roll back' : 'publish'} this template.`)
    if (confirmation !== template.id) return
    setBusy(version.id)
    try {
      const response = await fetch(`/api/admin/settings/document-templates/${template.id}/publish`, {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          versionId: version.id,
          expectedActiveVersionId: template.activeVersionId,
          confirmation,
          action: rollback ? 'rollback' : 'publish',
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Publication failed')
      toast.success(rollback ? 'Template rolled back.' : 'Template published for future generations.')
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Publication failed')
    } finally {
      setBusy(null)
    }
  }

  async function cancelUpload(template: TemplateRow, version: TemplateVersion) {
    const confirmed = window.confirm(
      `Discard v${version.versionNumber} (${version.originalFilename})? The staged DOCX will be removed and can be uploaded again later.`,
    )
    if (!confirmed) return
    setBusy(version.id)
    try {
      const response = await fetch(
        `/api/admin/settings/document-templates/${template.id}/versions/${version.id}`,
        { method: 'DELETE', headers: headers() },
      )
      const body = await response.json().catch(() => ({})) as {
        error?: string
        cleanupWarning?: string | null
      }
      if (!response.ok) throw new Error(body.error ?? 'Could not discard upload')
      if (body.cleanupWarning) toast.warning(body.cleanupWarning)
      else toast.success('Staged template upload discarded.')
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not discard upload')
    } finally {
      setBusy(null)
    }
  }

  function isRollbackTarget(template: TemplateRow, version: TemplateVersion) {
    const active = template.versions.find(candidate => candidate.isActive)
    return Boolean(active && version.versionNumber < active.versionNumber)
  }

  async function download(template: TemplateRow, versionId: string, preview = false) {
    const matterId = matterIds[template.id]?.trim()
    if (preview && !matterId) return toast.error('Choose a compatible validation matter first.')
    setBusy(`${versionId}-download`)
    try {
      const query = preview ? `?matterId=${encodeURIComponent(matterId!)}` : ''
      const response = await fetch(
        `/api/admin/settings/document-templates/${template.id}/versions/${versionId}/download${query}`,
        { headers: headers() },
      )
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error ?? 'Download failed')
      }
      const blob = await response.blob()
      const disposition = response.headers.get('content-disposition') ?? ''
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `${template.id}.docx`
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Download failed')
    } finally {
      setBusy(null)
    }
  }

  const loadVariables = useCallback(async (template: TemplateRow) => {
    setVariablesByTemplate(current => ({ ...current, [template.id]: 'loading' }))
    try {
      const matterId = matterIds[template.id]
      const query = matterId ? `?matterId=${encodeURIComponent(matterId)}` : ''
      const response = await fetch(
        `/api/admin/settings/document-templates/${template.id}/variables${query}`,
        { headers: headers(), cache: 'no-store' },
      )
      const data = await response.json().catch(() => ({})) as TemplateVariablesReport & { error?: string }
      if (!response.ok) throw new Error(data.error ?? 'Failed to analyze template variables')
      setVariablesByTemplate(current => ({ ...current, [template.id]: data }))
    } catch (error) {
      setVariablesByTemplate(current => {
        const next = { ...current }
        delete next[template.id]
        return next
      })
      toast.error(error instanceof Error ? error.message : 'Failed to analyze template variables')
    }
  }, [headers, matterIds])

  if (loading) return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading templates…</div>

  return (
    <div className="space-y-6">
      {migrationRequired && (
        <div className="rounded-md border border-amber-border bg-amber-bg p-3 text-sm text-amber">
          Apply pending Supabase migrations, including <code>20260713222004_cancel_document_template_uploads.sql</code>, to enable the complete staged-template workflow.
        </div>
      )}
      {(Object.keys(CATEGORY_LABELS) as Array<keyof typeof CATEGORY_LABELS>).map(category => (
        <section key={category} className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold">{CATEGORY_LABELS[category]}</h3>
            <p className="text-xs text-muted-foreground">Uploads remain staged until they are explicitly published. Validation and preview are available but optional.</p>
          </div>
          <div className="space-y-3">
            {templates.filter(template => template.category === category).map(template => {
              const lastUpload = templateLastUpload(template)
              return (
              <details key={template.id} className="rounded-lg border border-border bg-card" open={template.versions.length > 0}>
                <summary className="cursor-pointer list-none p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{template.label}</span>
                        <Badge variant={template.activeSource === 'published' ? 'default' : 'outline'}>
                          {template.activeSource === 'published' ? 'Published override' : 'Bundled'}
                        </Badge>
                      </div>
                      <p className="mt-1 font-mono text-[11px] text-muted-foreground">{template.bundledPath}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">Used by: {template.packageNames.join(', ')}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Last uploaded:{' '}
                        {lastUpload ? (
                          <time dateTime={lastUpload.createdAt} title={lastUpload.createdAt}>
                            {new Date(lastUpload.createdAt).toLocaleString()} (v{lastUpload.versionNumber})
                          </time>
                        ) : 'Never — bundled baseline only'}
                      </p>
                      {template.publishedAt && (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Active version published{' '}
                          <time dateTime={template.publishedAt} title={template.publishedAt}>
                            {new Date(template.publishedAt).toLocaleString()}
                          </time>{' '}
                          by {template.publishedBy}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2" onClick={event => event.stopPropagation()}>
                      <Button size="sm" variant="outline" onClick={() => void download(template, template.activeVersionId ?? 'bundled')}>
                        <Download className="h-4 w-4" /> Current
                      </Button>
                      <Label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input px-3 py-1.5 text-xs font-medium hover:bg-muted">
                        <Upload className="h-4 w-4" /> Upload DOCX
                        <Input
                          type="file"
                          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                          className="hidden"
                          disabled={Boolean(busy) || migrationRequired}
                          onChange={event => {
                            const file = event.target.files?.[0]
                            event.target.value = ''
                            void upload(template, file)
                          }}
                        />
                      </Label>
                    </div>
                  </div>
                </summary>
                <div className="space-y-3 border-t border-border p-4">
                  <MatterSearchPicker
                    id={`matter-${template.id}`}
                    label="Validation matter"
                    headers={authHeaders}
                    value={matterIds[template.id] ?? ''}
                    onChange={matterId => setMatterIds(current => ({ ...current, [template.id]: matterId }))}
                  />
                  <div className="space-y-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={variablesByTemplate[template.id] === 'loading'}
                      onClick={() => void loadVariables(template)}
                    >
                      {variablesByTemplate[template.id] === 'loading'
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <FileCheck2 className="h-4 w-4" />}
                      {matterIds[template.id] ? 'Variables & matter check' : 'Variables'}
                    </Button>
                    {(() => {
                      const report = variablesByTemplate[template.id]
                      if (!report || report === 'loading') return null
                      return (
                        <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3 text-xs">
                          <p className="font-medium">
                            {report.variables.length} variable{report.variables.length === 1 ? '' : 's'} ·{' '}
                            {report.clauses.length} clause{report.clauses.length === 1 ? '' : 's'} ·{' '}
                            {report.source === 'published' ? `published ${report.versionLabel}` : 'bundled master'}
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {report.variables.map(field => (
                              <code key={field.path} title={field.description ?? field.label} className="rounded bg-background px-1.5 py-0.5">
                                {field.path}
                              </code>
                            ))}
                          </div>
                          {report.clauses.length > 0 && (
                            <p className="text-muted-foreground">Clauses: {report.clauses.join(', ')}</p>
                          )}
                          {report.perMatter && (
                            report.perMatter.error ? (
                              <p className="text-destructive">{report.perMatter.error}</p>
                            ) : report.perMatter.missingFields.length === 0 ? (
                              <p className="text-success">The selected matter resolves every field in this template.</p>
                            ) : (
                              <div>
                                <p className="font-medium text-amber">
                                  Missing for the selected matter ({report.perMatter.missingFields.length}):
                                </p>
                                <ul className="mt-1 list-inside list-disc text-muted-foreground">
                                  {report.perMatter.missingFields.map(field => (
                                    <li key={field.path}>{field.label} <code>({field.path})</code></li>
                                  ))}
                                </ul>
                              </div>
                            )
                          )}
                        </div>
                      )
                    })()}
                  </div>
                  {template.versions.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No uploaded versions. The bundled repository template is active.</p>
                  ) : template.versions.map(version => (
                    <div key={version.id} className="rounded-md border border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 text-sm font-medium">
                            v{version.versionNumber} · {version.originalFilename}
                            {version.isActive && <Badge>Active</Badge>}
                            <Badge variant={version.validationStatus === 'valid' ? 'secondary' : version.validationStatus === 'invalid' ? 'destructive' : 'outline'}>
                              {version.validationStatus}
                            </Badge>
                          </div>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {(version.byteSize / 1024).toFixed(1)} KB · {new Date(version.createdAt).toLocaleString()}
                          </p>
                          {version.validationReport?.error && <p className="mt-1 text-xs text-destructive">{version.validationReport.error}</p>}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void validate(template, version)}>
                            <FileCheck2 className="h-4 w-4" /> Validate
                          </Button>
                          <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void download(template, version.id, true)}>
                            <Download className="h-4 w-4" /> Preview
                          </Button>
                          <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => void download(template, version.id)}>
                            <Download className="h-4 w-4" /> Source
                          </Button>
                          {!version.isActive && (
                            <Button size="sm" disabled={Boolean(busy)} onClick={() => void publish(template, version, isRollbackTarget(template, version))}>
                              {isRollbackTarget(template, version) ? <RotateCcw className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
                              {isRollbackTarget(template, version) ? 'Roll back here' : 'Publish'}
                            </Button>
                          )}
                          {version.canCancel && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={Boolean(busy)}
                              className="text-destructive hover:text-destructive"
                              onClick={() => void cancelUpload(template, version)}
                            >
                              <Trash2 className="h-4 w-4" /> Discard upload
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </details>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
