'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BoundingBox, Citation, TextLayer } from '@/lib/textLayer/types'
import { bboxesForRange } from '@/lib/textLayer/match'

/**
 * Renders a PDF and highlights a citation from stored geometry alone.
 *
 * There is deliberately no text matching here. The sibling DOCX viewer searches
 * the rendered document for a quote string, because a DOCX carries no
 * coordinates and there is nothing else to go on. A PDF citation already knows
 * exactly where it is, so re-deriving that at display time could only introduce
 * a way for the highlight to land somewhere the citation does not.
 *
 * That also means a highlight can never disagree with the citation it came
 * from: both read the same offsets.
 */

interface PdfCitationViewerProps {
  /** The PDF bytes. Fetched by the caller, which owns auth. */
  bytes: ArrayBuffer | null
  layer: TextLayer | null
  /** The citation to highlight, if any. */
  citation: Citation | null
  /** Rendering scale. 1 renders at the PDF's own point size. */
  scale?: number
}

interface RenderedPage {
  pageNumber: number
  canvas: HTMLCanvasElement
}

export function PdfCitationViewer({ bytes, layer, citation, scale = 1.5 }: PdfCitationViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [pages, setPages] = useState<RenderedPage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const renderPdf = useCallback(async () => {
    const host = hostRef.current
    if (!host || !bytes) return
    setLoading(true)
    setError(null)
    try {
      const pdfjs = await import('pdfjs-dist')
      // The worker is bundled beside the library; without this pdf.js falls back
      // to running on the main thread and blocks the page on a long document.
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url,
      ).toString()

      // pdf.js takes ownership of the buffer it is given, so hand it a copy —
      // otherwise a re-render finds the caller's bytes detached.
      const doc = await pdfjs.getDocument({ data: bytes.slice(0) }).promise
      const rendered: RenderedPage[] = []

      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
        const page = await doc.getPage(pageNumber)
        const viewport = page.getViewport({ scale })
        const canvas = document.createElement('canvas')
        canvas.width = viewport.width
        canvas.height = viewport.height
        canvas.style.width = '100%'
        canvas.style.height = 'auto'
        const context = canvas.getContext('2d')
        if (context) await page.render({ canvas, canvasContext: context, viewport }).promise
        rendered.push({ pageNumber, canvas })
      }

      setPages(rendered)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not render this PDF')
    } finally {
      setLoading(false)
    }
  }, [bytes, scale])

  useEffect(() => {
    void renderPdf()
  }, [renderPdf])

  /** The rectangles to draw, in PDF points, grouped by the page they sit on. */
  const highlights = useMemo(() => {
    const byPage = new Map<number, BoundingBox[]>()
    if (!layer || !citation) return byPage
    for (const placed of bboxesForRange(layer, citation.charStart, citation.charEnd)) {
      const existing = byPage.get(placed.page) ?? []
      existing.push(placed.box)
      byPage.set(placed.page, existing)
    }
    return byPage
  }, [layer, citation])

  useEffect(() => {
    const host = hostRef.current
    if (!host || pages.length === 0) return
    const target = citation?.page
    if (!target) return
    host
      .querySelector(`[data-page-number="${target}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [citation, pages])

  return (
    <div ref={hostRef} className="relative overflow-auto" data-testid="pdf-citation-viewer">
      {loading && <p className="p-4 text-sm text-muted-foreground">Rendering…</p>}
      {error && <p className="p-4 text-sm text-destructive">{error}</p>}

      {pages.map(page => (
        <div
          key={page.pageNumber}
          data-page-number={page.pageNumber}
          className="relative mb-4"
          ref={node => {
            if (node && !node.contains(page.canvas)) node.prepend(page.canvas)
          }}
        >
          {(highlights.get(page.pageNumber) ?? []).map((box, index) => (
            <div
              key={index}
              // Boxes are stored in PDF points with a top-left origin, so a
              // percentage of the page dimensions scales with whatever width the
              // canvas ends up at — no coupling to the render scale.
              className="pointer-events-none absolute rounded-sm bg-amber-300/40 ring-1 ring-amber-500/70"
              style={{
                left: `${(box.x / (page.canvas.width / scale)) * 100}%`,
                top: `${(box.y / (page.canvas.height / scale)) * 100}%`,
                width: `${(box.width / (page.canvas.width / scale)) * 100}%`,
                height: `${(box.height / (page.canvas.height / scale)) * 100}%`,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
