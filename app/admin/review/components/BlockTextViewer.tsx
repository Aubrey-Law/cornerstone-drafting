'use client'

import { useEffect, useRef } from 'react'
import type { Citation, TextLayer } from '@aubrey-law/citations/textLayer/types'

/**
 * The document as its blocks, with a citation's exact characters marked.
 *
 * The highlight is computed from the stored offsets and nothing else. There is
 * deliberately no search of the rendered text for the quote: that would be a
 * second, independent way of deciding what a citation points at, and the whole
 * value of the citation model is that there is only one. The consequence is
 * that a highlight can never disagree with the citation it came from — both
 * read the same numbers.
 *
 * This is also the only view a DOCX can have. OOXML carries no coordinates, so
 * there is no page geometry to draw; a block's index *is* its paragraph index,
 * which is enough to show the attorney the words.
 */
export function BlockTextViewer({
  layer,
  citation,
}: {
  layer: TextLayer
  citation: Citation | null
}) {
  const selectedRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [citation])

  if (layer.status === 'no_text' || layer.blocks.length === 0) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        This document has no text layer, so there is nothing to show or to cite. It is almost
        certainly a scan.
      </p>
    )
  }

  return (
    <div className="space-y-4 p-4">
      {layer.blocks.map((block) => {
        // Intersect the citation with this block. verifyQuote scopes a citation
        // to a single block, so the overlap is normally all-or-nothing; doing it
        // by intersection means a citation that ever ran past its block is shown
        // in full rather than silently disappearing.
        const from = citation ? Math.max(citation.charStart, block.charStart) : 0
        const to = citation ? Math.min(citation.charEnd, block.charEnd) : 0
        const overlaps = citation !== null && to > from

        return (
          <p
            key={block.index}
            data-testid={`block-${block.index}`}
            ref={overlaps ? (node) => { selectedRef.current = node } : undefined}
            className="text-sm leading-relaxed whitespace-pre-wrap"
          >
            <span className="mr-2 select-none font-mono text-xs text-muted-foreground">
              ¶ {block.index}
              {block.page === null ? '' : ` · p${block.page}`}
            </span>
            {/* The document's own characters, separate from the label, so what
                is rendered here is exactly what the layer holds. */}
            <span data-testid={`block-text-${block.index}`}>
              {overlaps ? (
                <>
                  {block.text.slice(0, from - block.charStart)}
                  <mark className="rounded bg-warning/25 px-0.5 text-foreground">
                    {block.text.slice(from - block.charStart, to - block.charStart)}
                  </mark>
                  {block.text.slice(to - block.charStart)}
                </>
              ) : (
                block.text
              )}
            </span>
          </p>
        )
      })}
    </div>
  )
}
