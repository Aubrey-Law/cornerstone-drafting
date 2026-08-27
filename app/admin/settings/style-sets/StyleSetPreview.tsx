'use client'

import { useId, useMemo, useState } from 'react'
import { Info } from 'lucide-react'
import {
  PREVIEW_CONTENT,
  buildStyleSetPreview,
  type PreviewBlock,
  type PreviewLevel,
} from '@/lib/styleSets/preview'
import type { StyleSetSettings } from '@/lib/styleSets/schema'

/**
 * A page laid out from the style set, beside the form that edits it.
 *
 * Two honesty constraints shape this, and both are stated on screen rather than
 * only in a comment:
 *
 * 1. **It is CSS, not Word.** Proportions, relative sizes, indents, spacing and
 *    numbering shapes are faithful. Line breaks, justification and hyphenation
 *    are the browser's, so the preview answers "is this the layout I meant" and
 *    not "is this the page my client receives".
 * 2. **Preserved properties are guesses and are labelled as such.** The preview
 *    has no template to read, so anything the style set leaves alone is drawn
 *    from a deliberately generic baseline and counted in the note below the
 *    page. Drawing a plausible-looking value unlabelled would make the page
 *    look most authoritative exactly where it knows least.
 *
 * The page is drawn at true proportions in CSS inches and then scaled down, so
 * an 8.5 × 11 sheet with one-inch margins really does show a 6.5-inch text
 * block — which is the part of this that a person can check by eye.
 */

/** CSS pixels per inch, fixed by the CSS spec regardless of screen density. */
const CSS_PX_PER_INCH = 96

function blockStyle(block: PreviewBlock): React.CSSProperties {
  return {
    fontFamily: block.fontFamily,
    fontSize: `${block.fontSizePt}pt`,
    fontWeight: block.bold ? 700 : 400,
    textAlign: block.textAlign as React.CSSProperties['textAlign'],
    lineHeight: block.lineHeight,
    marginTop: `${block.spaceBeforePt}pt`,
    marginBottom: `${block.spaceAfterPt}pt`,
  }
}

function LevelLine({ level, text }: { level: PreviewLevel; text: string }) {
  // Hanging indent the way Word means it: the block starts at indentLeft, and
  // the first line — carrying the number — begins `hanging` further left.
  return (
    <p
      style={{
        ...blockStyle(level),
        marginLeft: `${level.indentLeftPt}pt`,
        textIndent: `-${level.hangingPt}pt`,
        paddingLeft: `${level.hangingPt}pt`,
      }}
    >
      {level.marker && <span>{level.marker}&nbsp;&nbsp;</span>}
      {text}
    </p>
  )
}

export function StyleSetPreview({ settings }: { settings: StyleSetSettings }) {
  const preview = useMemo(() => buildStyleSetPreview(settings), [settings])
  const [showPreserved, setShowPreserved] = useState(false)
  const detailsId = useId()

  // Fit the sheet to a comfortable column width rather than a fixed zoom, so a
  // legal or landscape page shrinks instead of overflowing.
  const targetWidthPx = 420
  const scale = targetWidthPx / (preview.page.widthIn * CSS_PX_PER_INCH)

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">Preview</h2>
        <span className="text-xs text-muted-foreground">
          {preview.page.widthIn} × {preview.page.heightIn} in
        </span>
      </div>

      <div
        className="overflow-hidden rounded-lg border border-border bg-muted/40 p-3"
        // The scaled sheet is taken out of flow by the transform, so the wrapper
        // has to be told the height it ends up occupying.
        style={{ height: preview.page.heightIn * CSS_PX_PER_INCH * scale + 24 }}
      >
        <div
          aria-label="Sample page laid out with these settings"
          role="img"
          className="bg-white text-black shadow-sm"
          style={{
            width: `${preview.page.widthIn}in`,
            height: `${preview.page.heightIn}in`,
            paddingTop: `${preview.page.marginTopPt}pt`,
            paddingRight: `${preview.page.marginRightPt}pt`,
            paddingBottom: `${preview.page.marginBottomPt}pt`,
            paddingLeft: `${preview.page.marginLeftPt}pt`,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            overflow: 'hidden',
          }}
        >
          <p style={blockStyle(preview.title)}>{PREVIEW_CONTENT.title}</p>
          <p style={blockStyle(preview.body)}>{PREVIEW_CONTENT.opening}</p>
          {preview.levels.map((level, index) => (
            <LevelLine key={index} level={level} text={PREVIEW_CONTENT.levels[index]} />
          ))}
          <p style={blockStyle(preview.body)}>{PREVIEW_CONTENT.closing}</p>
        </div>
      </div>

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          Drawn in the browser, so proportions, sizes, indents and numbering are right but line
          breaks and justification are not Word&rsquo;s.
        </span>
      </p>

      {preview.preservedProperties.length > 0 && (
        <div className="rounded-md border border-border px-3 py-2 text-xs">
          <button
            type="button"
            onClick={() => setShowPreserved(open => !open)}
            aria-expanded={showPreserved}
            aria-controls={detailsId}
            className="text-start text-muted-foreground hover:text-foreground"
          >
            {preview.isEntirelyPreserved
              ? 'This style set changes nothing, so the whole page above is a generic stand-in.'
              : `${preview.preservedProperties.length} propert${preview.preservedProperties.length === 1 ? 'y is' : 'ies are'} shown as a stand-in, because this style set leaves them to the template.`}
          </button>
          {showPreserved && (
            <ul id={detailsId} className="mt-2 columns-2 gap-4 text-muted-foreground">
              {preview.preservedProperties.map(name => (
                <li key={name} className="break-inside-avoid">
                  {name}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
