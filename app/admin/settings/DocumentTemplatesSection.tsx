'use client'

import { useCallback, useEffect, useState } from 'react'
import { Download, FileCheck2, Loader2, RotateCcw, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface TemplateVersion {
  id: string
  versionNumber: number
  originalFilename: string
  byteSize: number
  validationStatus: 'pending' | 'valid' | 'invalid'
  validationReport: { error?: string; warnings?: string[]; missingFields?: string[] } | null
  createdAt: string
  isActive: boolean
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

  const headers = useCallback(() => ({ Authorization: `Bearer ${token}` }), [token])
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
      toast.success('Template staged. Validate it against a matter before publishing.')
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Upload failed')
    } finally {
      setBusy(null)
    }
  }

  async function validate(template: TemplateRow, version: TemplateVersion) {
    const matterId = matterIds[template.id]?.trim()
    if (!matterId) return toast.error('Enter a compatible matter ID first.')
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

  function isRollbackTarget(template: TemplateRow, version: TemplateVersion) {
    const active = template.versions.find(candidate => candidate.isActive)
    return Boolean(active && version.versionNumber < active.versionNumber)
  }

  async function download(template: TemplateRow, versionId: string, preview = false) {
    const matterId = matterIds[template.id]?.trim()
    if (preview && !matterId) return toast.error('Enter a compatible matter ID first.')
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

  if (loading) return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading templates…</div>

  return (
    <div className="space-y-6">
      {migrationRequired && (
        <div className="rounded-md border border-amber-border bg-amber-bg p-3 text-sm text-amber">
          Apply migration <code>20260713194628_document_template_workflow.sql</code> to enable staged template versions.
        </div>
      )}
      {(Object.keys(CATEGORY_LABELS) as Array<keyof typeof CATEGORY_LABELS>).map(category => (
        <section key={category} className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold">{CATEGORY_LABELS[category]}</h3>
            <p className="text-xs text-muted-foreground">Uploads remain staged until they pass a matter preview and are explicitly published.</p>
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
                          onChange={event => void upload(template, event.target.files?.[0])}
                        />
                      </Label>
                    </div>
                  </div>
                </summary>
                <div className="space-y-3 border-t border-border p-4">
                  <div className="max-w-md">
                    <Label htmlFor={`matter-${template.id}`}>Preview matter ID</Label>
                    <Input
                      id={`matter-${template.id}`}
                      value={matterIds[template.id] ?? ''}
                      onChange={event => setMatterIds(current => ({ ...current, [template.id]: event.target.value }))}
                      placeholder="Paste a compatible matter UUID"
                    />
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
                          {!version.isActive && version.validationStatus === 'valid' && (
                            <Button size="sm" disabled={Boolean(busy)} onClick={() => void publish(template, version, isRollbackTarget(template, version))}>
                              {isRollbackTarget(template, version) ? <RotateCcw className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
                              {isRollbackTarget(template, version) ? 'Roll back here' : 'Publish'}
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
