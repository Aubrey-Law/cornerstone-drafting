import { useRef, useState } from 'react'
import { streamChat, type ChatTurn } from '../api/client'
import { describeContextGap } from '../matter/contextGap'
import { readDocument } from '../../word/readDocument'
import { parseEditsBlock, type ProposedEdit } from '../../word/editTypes'
import { applyTrackedEdits, type EditOutcome } from '../../word/applyTrackedEdits'
import EditCard from './EditCard'

interface Turn extends ChatTurn {
  edits?: ProposedEdit[]
  outcomes?: EditOutcome[]
}


export default function ChatPanel({ matterId }: { matterId: string | null }) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [contextWarning, setContextWarning] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const send = async () => {
    const instruction = input.trim()
    if (!instruction || busy) return

    setInput('')
    setError(null)
    setBusy(true)
    setStreaming('')

    const history: Turn[] = [...turns, { role: 'user', content: instruction }]
    setTurns(history)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      // Re-read on every turn. The attorney may have typed in Word since the
      // last message, and a stale snapshot produces edits that cannot be found.
      const snapshot = await readDocument()

      const { reply, matterContext } = await streamChat({
        messages: history.map(({ role, content }) => ({ role, content })),
        documentText: snapshot.markdown,
        documentName: snapshot.name,
        matterId,
        signal: controller.signal,
        onDelta: text => setStreaming(prev => prev + text),
      })

      setContextWarning(describeContextGap(matterId, matterContext))

      const { edits, prose, malformed } = parseEditsBlock(reply)
      setStreaming('')

      const outcomes = edits.length > 0 ? await applyTrackedEdits(edits) : undefined
      setTurns([...history, { role: 'assistant', content: prose, edits, outcomes }])

      if (malformed) {
        setError('The reply included edits that could not be read. Nothing was changed.')
      }
    } catch (err) {
      setStreaming('')
      if ((err as Error)?.name !== 'AbortError') {
        setError(err instanceof Error ? err.message : 'Something went wrong.')
      }
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {turns.length === 0 && !streaming && (
          <p className="text-[color:var(--color-ink-muted)]">
            {matterId
              ? 'Ask about the open document, or describe a change. The linked matter’s design sheet is the source of truth for names, dates and fiduciaries. Revisions arrive as tracked changes you can accept or reject one at a time.'
              : 'Ask about the open document, or describe a change. Link a matter above to draft from its design sheet. Revisions arrive as tracked changes you can accept or reject one at a time.'}
          </p>
        )}

        {turns.map((turn, i) => (
          <div key={i} className="space-y-2">
            <div
              className={
                turn.role === 'user'
                  ? 'rounded bg-[color:var(--color-surface-sunken)] px-3 py-2'
                  : 'whitespace-pre-wrap'
              }
            >
              {turn.content}
            </div>

            {turn.edits?.map((edit, j) => (
              <EditCard
                key={j}
                edit={edit}
                outcome={turn.outcomes?.find(o => o.index === j)}
              />
            ))}
          </div>
        ))}

        {streaming && <div className="whitespace-pre-wrap opacity-70">{streaming}</div>}
        {contextWarning && (
          <p className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-amber-800">
            {contextWarning}
          </p>
        )}
        {error && <p className="text-red-600">{error}</p>}
      </div>

      <div className="border-t border-[color:var(--color-line)] p-2">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          rows={3}
          disabled={busy}
          placeholder="Shorten the trustee succession paragraph…"
          aria-label="Message"
          className="w-full resize-none rounded border border-[color:var(--color-line)] p-2"
        />
        <div className="mt-1 flex justify-end gap-2">
          {busy && (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="rounded border border-[color:var(--color-line)] px-3 py-1"
            >
              Stop
            </button>
          )}
          <button
            type="button"
            onClick={() => void send()}
            disabled={busy || !input.trim()}
            className="rounded bg-[color:var(--color-accent)] px-3 py-1 font-medium text-white disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
