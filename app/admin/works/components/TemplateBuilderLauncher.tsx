'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Sparkles, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { WorkSkill } from '@/components/works/types'

/**
 * Library entry point for the Template Builder workflow: upload a DOCX, then
 * open the assistant with the Template Builder skill attached and the upload
 * referenced in the first message.
 */
export function TemplateBuilderLauncher({ skills }: { skills: WorkSkill[] }) {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)

  const builderSkill = skills.find(skill => skill.slug === 'template-builder' && skill.is_active)

  const launch = async () => {
    if (!file) return
    setBusy(true)
    try {
      const form = new FormData()
      form.set('file', file)
      const response = await fetch('/api/admin/template-builder/uploads', { method: 'POST', body: form })
      const data = await response.json().catch(() => ({})) as { uploadId?: string; filename?: string; error?: string }
      if (!response.ok || !data.uploadId) {
        toast.error(data.error ?? 'Upload failed.')
        return
      }
      const params = new URLSearchParams({
        templateUpload: data.uploadId,
        templateUploadName: data.filename ?? file.name,
      })
      if (builderSkill) params.set('workflow', builderSkill.id)
      router.push(`/admin/assistant?${params.toString()}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-4 rounded-lg border border-border bg-muted p-4">
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Build a template with the assistant</p>
          <p className="text-xs text-muted-foreground">
            Upload a Word document — a firm form, a filled example, or a draft template — and the
            assistant will ask what should become merge fields, rewrite it, verify it, and register
            it (or stage it as a new master version).
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              type="file"
              accept=".docx"
              className="text-xs text-muted-foreground file:mr-2 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-xs"
              onChange={event => setFile(event.target.files?.[0] ?? null)}
            />
            <Button size="sm" disabled={!file || busy} onClick={() => void launch()}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />}
              Start building
            </Button>
            {!builderSkill && (
              <span className="text-micro text-muted-foreground">
                Tip: run &quot;Sync&quot; on the Workflows tab so the Template Builder workflow attaches automatically.
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
