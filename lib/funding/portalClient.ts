import { supabase } from '@/lib/supabaseClient'
import type { PortalAsset } from '@/lib/funding/portal'

/** Browser-side calls for the portal's assets page. */

async function headers(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Not authenticated')
  return { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }
}

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? fallback)
  return body
}

export async function addPortalAsset(input: Record<string, unknown>): Promise<PortalAsset[]> {
  const response = await fetch('/api/portal/assets', { method: 'POST', headers: await headers(), body: JSON.stringify(input) })
  const body = await readJson<{ assets: PortalAsset[] }>(response, 'Could not add the asset')
  return body.assets
}

export async function reportPortalAssetDone(assetId: string, note: string | null): Promise<PortalAsset[]> {
  const response = await fetch(`/api/portal/assets/${encodeURIComponent(assetId)}/done`, {
    method: 'POST',
    headers: await headers(),
    body: JSON.stringify({ note }),
  })
  const body = await readJson<{ assets: PortalAsset[] }>(response, 'Could not record that')
  return body.assets
}

export async function listPortalAssets(): Promise<PortalAsset[]> {
  const response = await fetch('/api/portal/assets', { headers: await headers() })
  const body = await readJson<{ assets: PortalAsset[] }>(response, 'Could not load your assets')
  return body.assets
}
