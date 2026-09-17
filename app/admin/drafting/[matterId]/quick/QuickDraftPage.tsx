'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Download, FileText, Loader2, Save, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { PageHeader } from '@/components/PageHeader'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { logMatterActivity } from '@/lib/matterActivity'
import { cn } from '@/lib/utils'

interface TemplateOption {
  id: string
  label: string
  packageNames: string[]
  custom?: boolean
}

interface MissingFieldInfo {
  path: string
  label: string
  type: string
  description: string | null
}

interface AnalyzeResult {
  outputFilename: string
  title: string
  packageName: string
  templateSource: 'bundled' | 'published'
  missingFields: MissingFieldInfo[]
  unresolvedMarkers: string[]
  warnings: string[]
}

interface QuickDraftPageProps {
  matterId: string
  matterLabel: string
}

export default function QuickDraftPage({ matterId, matterLabel }: QuickDraftPageProps) {
  const accessToken = useAccessToken()
  const [templates, setTemplates] = useState<TemplateOption[]>([])
  const [savedAnswers, setSavedAnswers] = useState<Record<string, Record<string, string>>>({})
  const [templateId, setTemplateId] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null)
  const [busy, setBusy] = useState<'load' | 'analyze' | 'download' | 'save' | null>('load')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [savedDocumentName, setSavedDocumentName] = useState<string | null>(null)
  const [uploadLabel, setUploadLabel] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadBusy, setUploadBusy] = useState(false)

  useEffect(() => {
    if (!accessToken) return
    let cancelled = false
    ;(async () => {
      try {
        const response = await fetch(`/api/admin/matters/${matterId}/quick-draft`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        const data = await response.json().catch(() => ({})) as {
          error?: string
          templates?: TemplateOption[]
          savedAnswers?: Record<string, Record<string, string>>
        }
        if (cancelled) return
        if (!response.ok) {
          setLoadError(data.error ?? 'Failed to load templates.')
          return
        }
        setTemplates(Array.isArray(data.templates) ? data.templates : [])
        setSavedAnswers(data.savedAnswers ?? {})
      } catch {
        if (!cancelled) setLoadError('Failed to load templates.')
      } finally {
        if (!cancelled) setBusy(null)
      }
    })()
    return () => { cancelled = true }
  }, [accessToken, matterId])

  const selectTemplate = useCallback((id: string) => {
    setTemplateId(id)
    setAnalysis(null)
    setSavedDocumentName(null)
    setAnswers(id ? { ...(savedAnswers[id] ?? {}) } : {})
  }, [savedAnswers])

  const filledAnswers = useMemo(() => {
    const filled: Record<string, string> = {}
    for (const [key, value] of Object.entries(answers)) {
      if (value.trim() !== '') filled[key] = value
    }
    return filled
  }, [answers])

  const runMode = useCallback(async (mode: 'analyze' | 'download' | 'save') => {
    if (!accessToken) {
      toast.error('Your session expired. Refresh and try again.')
      return
    }
    if (!templateId) return
    setBusy(mode)
    if (mode === 'analyze') setSavedDocumentName(null)
    try {
      const response = await fetch(`/api/admin/matters/${matterId}/quick-draft`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ templateId, mode, overrides: filledAnswers }),
      })

      if (mode === 'download' && response.ok) {
        const blob = await response.blob()
        const disposition = response.headers.get('Content-Disposition') ?? ''
        const filenameMatch = disposition.match(/filename="([^"]+)"/)
        const filename = filenameMatch?.[1] ?? 'quick-draft.docx'
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = filename
        anchor.click()
        URL.revokeObjectURL(url)
        const missingCount = Number(response.headers.get('X-Missing-Count') ?? '0')
        if (missingCount > 0) {
          toast.warning(`Downloaded with ${missingCount} unresolved field${missingCount === 1 ? '' : 's'}.`, {
            description: 'Open the document in Word and search for [[ MISSING ]] to finish it.',
          })
        } else {
          toast.success('Draft downloaded', { description: filename })
        }
        return
      }

      const data = await response.json().catch(() => ({})) as Record<string, unknown> & { error?: string }
      if (!response.ok) {
        toast.error(data.error ?? 'Quick draft failed.')
        return
      }

      if (mode === 'analyze') {
        const next = data as unknown as AnalyzeResult
        setAnalysis({
          outputFilename: next.outputFilename,
          title: next.title,
          packageName: next.packageName,
          templateSource: next.templateSource,
          missingFields: Array.isArray(next.missingFields) ? next.missingFields : [],
          unresolvedMarkers: Array.isArray(next.unresolvedMarkers) ? next.unresolvedMarkers : [],
          warnings: Array.isArray(next.warnings) ? next.warnings : [],
        })
        return
      }

      // save
      const documentName = typeof data.documentName === 'string' ? data.documentName : 'Quick draft'
      const missingCount = typeof data.missingCount === 'number' ? data.missingCount : 0
      setSavedDocumentName(documentName)
      setSavedAnswers(previous => ({ ...previous, [templateId]: { ...filledAnswers } }))
      if (missingCount > 0) {
        toast.warning(`Saved with ${missingCount} unresolved field${missingCount === 1 ? '' : 's'}.`, {
          description: 'The draft is in the matter’s Draft folder — finish the [[ MISSING ]] holes before sharing.',
        })
      } else {
        toast.success('Draft saved to matter', { description: documentName })
      }
      void logMatterActivity(matterId, 'draft_generated', `Quick drafted ${documentName}`, {
        detail: `Quick drafted ${documentName}`,
        metadata: { templateId, documentName },
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Quick draft failed.')
    } finally {
      setBusy(null)
    }
  }, [accessToken, filledAnswers, matterId, templateId])

  const uploadCustomTemplate = useCallback(async () => {
    if (!accessToken || !uploadFile || !uploadLabel.trim()) return
    setUploadBusy(true)
    try {
      const form = new FormData()
      form.set('file', uploadFile)
      form.set('label', uploadLabel.trim())
      const response = await fetch('/api/admin/quick-draft/custom-templates', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      })
      const data = await response.json().catch(() => ({})) as {
        error?: string
        id?: string
        label?: string
        variables?: string[]
      }
      if (!response.ok || !data.id) {
        toast.error(data.error ?? 'Upload failed.')
        return
      }
      setTemplates(previous => [...previous, {
        id: data.id!,
        label: data.label ?? uploadLabel.trim(),
        packageNames: ['custom'],
        custom: true,
      }])
      setUploadLabel('')
      setUploadFile(null)
      selectTemplate(data.id)
      toast.success('Custom template added', {
        description: data.variables?.length
          ? `Reads ${data.variables.length} variable${data.variables.length === 1 ? '' : 's'} — run Analyze to see what this matter still needs.`
          : 'Run Analyze to render it for this matter.',
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Upload failed.')
    } finally {
      setUploadBusy(false)
    }
  }, [accessToken, selectTemplate, uploadFile, uploadLabel])

  const removeCustomTemplate = useCallback(async (id: string) => {
    if (!accessToken) return
    const response = await fetch(`/api/admin/quick-draft/custom-templates/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!response.ok) {
      const data = await response.json().catch(() => ({})) as { error?: string }
      toast.error(data.error ?? 'Could not remove the template.')
      return
    }
    setTemplates(previous => previous.filter(template => template.id !== id))
    if (templateId === id) selectTemplate('')
    toast.success('Custom template removed')
  }, [accessToken, selectTemplate, templateId])

  const missingUnanswered = analysis
    ? analysis.missingFields.filter(field => !(filledAnswers[field.path] ?? '').trim()).length
    : 0

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="space-y-2">
        <Link
          href={`/admin/drafting/${matterId}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to drafting workspace
        </Link>
        <PageHeader
          eyebrow="Drafting"
          icon={Sparkles}
          title="Quick Draft"
          description={
            <>
              Generate a single document for {matterLabel}. Everything the matter already knows is
              filled automatically — you only answer what&apos;s left.
            </>
          }
        />
      </div>

      {loadError ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {loadError}
        </div>
      ) : (
        <Card className="gap-4 p-5">
          <div className="space-y-2">
            <label htmlFor="quick-draft-template" className="text-sm font-medium">Document</label>
            <div className="flex flex-wrap items-center gap-2">
              <select
                id="quick-draft-template"
                className="h-9 min-w-64 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                value={templateId}
                disabled={busy === 'load'}
                onChange={event => selectTemplate(event.target.value)}
              >
                <option value="">
                  {busy === 'load' ? 'Loading templates…' : 'Choose a document…'}
                </option>
                <optgroup label="Estate documents">
                  {templates.filter(template => !template.custom).map(template => (
                    <option key={template.id} value={template.id}>{template.label}</option>
                  ))}
                </optgroup>
                {templates.some(template => template.custom) && (
                  <optgroup label="Custom templates">
                    {templates.filter(template => template.custom).map(template => (
                      <option key={template.id} value={template.id}>{template.label}</option>
                    ))}
                  </optgroup>
                )}
              </select>
              <Button
                onClick={() => void runMode('analyze')}
                disabled={!templateId || busy !== null}
              >
                {busy === 'analyze' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileText className="mr-1 h-4 w-4" />}
                Analyze
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Analyze renders the document against this matter&apos;s data and lists only the fields
              it could not resolve.
            </p>
          </div>

          {analysis && (
            <div className="space-y-4 border-t pt-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{analysis.title}</span>
                <Badge variant="outline">{analysis.packageName}</Badge>
                {analysis.templateSource === 'published' && <Badge variant="secondary">Published template</Badge>}
                <span className={cn('ml-auto text-xs', missingUnanswered > 0 ? 'text-amber' : 'text-success')}>
                  {missingUnanswered > 0
                    ? `${missingUnanswered} field${missingUnanswered === 1 ? '' : 's'} still unresolved`
                    : 'All fields resolved'}
                </span>
              </div>

              {analysis.missingFields.length > 0 ? (
                <div className="space-y-3">
                  {analysis.missingFields.map(field => (
                    <div key={field.path} className="space-y-1">
                      <label htmlFor={`qd-${field.path}`} className="text-sm font-medium">
                        {field.label}
                      </label>
                      <input
                        id={`qd-${field.path}`}
                        type="text"
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={answers[field.path] ?? ''}
                        placeholder={field.description ?? field.path}
                        onChange={event => setAnswers(previous => ({ ...previous, [field.path]: event.target.value }))}
                      />
                      <p className="text-xs text-muted-foreground">{field.description ?? field.path}</p>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">
                    Fields left blank render as <code>[[ MISSING ]]</code> markers you can finish in Word.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nothing else is needed — the matter&apos;s data resolves this document completely.
                </p>
              )}

              {analysis.unresolvedMarkers.length > 0 && (
                <div className="rounded-md border border-amber-border bg-amber-bg p-3 text-xs text-amber">
                  <p className="font-medium">Unresolved template markers</p>
                  <ul className="mt-1 list-inside list-disc">
                    {analysis.unresolvedMarkers.slice(0, 8).map(marker => <li key={marker}>{marker}</li>)}
                  </ul>
                </div>
              )}
              {analysis.warnings.length > 0 && (
                <div className="rounded-md border border-muted bg-muted p-3 text-xs text-muted-foreground">
                  <ul className="list-inside list-disc">
                    {analysis.warnings.map(warning => <li key={warning}>{warning}</li>)}
                  </ul>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                <Button
                  variant="outline"
                  onClick={() => void runMode('download')}
                  disabled={busy !== null}
                >
                  {busy === 'download' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}
                  Download
                </Button>
                <Button
                  onClick={() => void runMode('save')}
                  disabled={busy !== null}
                >
                  {busy === 'save' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
                  Save to matter
                </Button>
                {savedDocumentName && (
                  <span className="text-sm text-success">
                    Saved <span className="font-medium">{savedDocumentName}</span> to the Draft folder.
                  </span>
                )}
              </div>
            </div>
          )}
        </Card>
      )}

      {!loadError && (
        <Card className="gap-3 p-5">
          <div>
            <h2 className="text-sm font-semibold">Custom templates</h2>
            <p className="text-xs text-muted-foreground">
              Upload a one-off DOCX with merge fields like {'{{ client.full_name }}'} or{' '}
              {'{{ extras.my_field }}'} — it becomes available in the picker above for any matter.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={uploadLabel}
              placeholder="Template name (e.g. Trust Transfer Letter)"
              className="h-9 min-w-56 flex-1 rounded-md border border-input bg-background px-3 text-sm"
              onChange={event => setUploadLabel(event.target.value)}
            />
            <input
              type="file"
              accept=".docx"
              className="text-xs text-muted-foreground file:mr-2 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-xs"
              onChange={event => setUploadFile(event.target.files?.[0] ?? null)}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={uploadBusy || !uploadFile || !uploadLabel.trim()}
              onClick={() => void uploadCustomTemplate()}
            >
              {uploadBusy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileText className="mr-1 h-4 w-4" />}
              Upload
            </Button>
          </div>
          {templates.some(template => template.custom) && (
            <ul className="divide-y text-sm">
              {templates.filter(template => template.custom).map(template => (
                <li key={template.id} className="flex items-center justify-between py-1.5">
                  <span>{template.label}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => void removeCustomTemplate(template.id)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  )
}
