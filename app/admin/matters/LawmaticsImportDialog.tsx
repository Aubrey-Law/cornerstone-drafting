'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface LawmaticsResult {
  lm_id: string
  full_name: string | null
  email: string | null
  phone: string | null
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultTarget?: 'lead' | 'matter'
}

export default function LawmaticsImportDialog({ open, onOpenChange, defaultTarget = 'matter' }: Props) {
  const router = useRouter()
  const token = useAccessToken()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<LawmaticsResult[]>([])
  const [loading, setLoading] = useState(false)
  const [importingId, setImportingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [target, setTarget] = useState<'lead' | 'matter'>(defaultTarget)

  const authHeaders = token ? { Authorization: `Bearer ${token}` } : undefined

  const handleSearch = async () => {
    if (!token) {
      toast.error('Not signed in')
      return
    }
    if (!query.trim()) return
    setLoading(true)
    setError(null)
    setResults([])
    try {
      const res = await fetch(`/api/lawmatics/pull?q=${encodeURIComponent(query)}`, {
        headers: authHeaders,
      })
      let data: Record<string, unknown> = {}
      try {
        data = await res.json()
      } catch {
        // ignore
      }
      if (!res.ok) {
        setError((data.error as string) ?? `Server error (${res.status})`)
        return
      }
      const matches = (data.matches as LawmaticsResult[]) ?? []
      setResults(matches)
      if (matches.length === 0) setError('No results found.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setLoading(false)
    }
  }

  const handleImport = async (lmId: string) => {
    if (!token) {
      toast.error('Not signed in')
      return
    }
    setImportingId(lmId)
    try {
      const res = await fetch('/api/lawmatics/pull', {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ lm_id: lmId, target }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error((data.error as string) ?? 'Import failed')
        return
      }
      onOpenChange(false)
      setQuery('')
      setResults([])
      setError(null)
      if (typeof data.leadId === 'string') {
        toast.success(data.created ? 'Lead imported from Lawmatics' : 'Opened existing Lawmatics lead')
        router.push(`/admin/leads/${data.leadId}`)
      } else if (typeof data.matterId === 'string') {
        toast.success(data.created ? 'Matter imported from Lawmatics' : 'Opened existing Lawmatics matter')
        router.push(`/admin/matters/${data.matterId}`)
      } else {
        router.refresh()
        toast.success('Imported from Lawmatics')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setImportingId(null)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        onOpenChange(next)
        if (!next) {
          setQuery('')
          setResults([])
          setError(null)
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import from Lawmatics</DialogTitle>
        </DialogHeader>
        <div className="flex gap-2">
          <Button type="button" variant={target === 'lead' ? 'default' : 'outline'} onClick={() => setTarget('lead')}>Lead</Button>
          <Button type="button" variant={target === 'matter' ? 'default' : 'outline'} onClick={() => setTarget('matter')}>Hired matter</Button>
        </div>
        <div className="space-y-4 py-2">
          <div className="flex gap-2">
            <Input
              placeholder="Search by name, email, or phone..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && void handleSearch()}
              className="flex-1"
            />
            <Button onClick={() => void handleSearch()} disabled={loading || !token}>
              {loading ? 'Searching…' : 'Search'}
            </Button>
          </div>
          {results.length > 0 && (
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {results.map(result => (
                <div key={result.lm_id} className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{result.full_name || 'Unnamed prospect'}</p>
                    <p className="text-xs text-muted-foreground">
                      {result.email || '—'} · {result.phone || '—'}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => void handleImport(result.lm_id)}
                    disabled={importingId !== null}
                  >
                    {importingId === result.lm_id ? 'Importing…' : 'Import'}
                  </Button>
                </div>
              ))}
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm text-warning">
              {error}
              {error.toLowerCase().includes('connect') && (
                <button
                  type="button"
                  className="ml-2 font-medium underline"
                  onClick={() => { window.location.href = '/api/lawmatics/connect' }}
                >
                  Reconnect →
                </button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
