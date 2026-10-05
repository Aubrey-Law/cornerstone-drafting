'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { WorkSkill } from '@/components/works/types'

/**
 * Library entry point for the Template Builder workflow: pick a DOCX, upload
 * it, then open the assistant with the Template Builder skill attached and the
 * upload referenced in the first message. Picking the file starts it — there is
 * no separate "start" step.
 */
export function TemplateBuilderLauncher({ skills }: { skills: WorkSkill[] }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const builderSkill = skills.find(skill => skill.slug === 'template-builder' && skill.is_active)

  const launch = async (file: File) => {
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
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <input
        ref={inputRef}
        type="file"
        accept=".docx"
        className="hidden"
        aria-label="Word document to build a template from"
        onChange={event => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void launch(file)
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        title="Upload a firm form, a filled example, or a draft template. The assistant asks what should become merge fields, rewrites and verifies it, then registers it or stages it as a new master version."
        onClick={() => inputRef.current?.click()}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {busy ? 'Uploading…' : 'Build with the assistant'}
      </Button>
      {!builderSkill && (
        <span className="text-micro text-muted-foreground">
          Run &quot;Sync system skills&quot; on Workflows so the Template Builder attaches automatically.
        </span>
      )}
    </div>
  )
}
