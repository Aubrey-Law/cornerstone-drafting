import type { MatterStage } from '@/types/database'

export async function updateMatterStage(matterId: string, stage: MatterStage): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch(`/api/admin/matters/${encodeURIComponent(matterId)}/stage`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stage }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null
    return { ok: false, error: body?.error ?? `Could not update stage (${res.status})` }
  }

  return { ok: true }
}
