import { serializeWordMutation } from '../mutationQueue'
import { readDocumentBytes } from '../readDocumentBytes'

/**
 * The declarative half of the firm formatting pass — font, title sizes,
 * subsection indents, page setup.
 *
 * Done as a round trip rather than through Office.js style APIs, for two
 * reasons that both come down to fidelity:
 *
 * 1. The server reuses `applyStyleSetToPart`, the same engine that formats
 *    every document the generator produces. An Office.js reimplementation would
 *    be a second engine, and the two would drift.
 * 2. `Document.insertFileFromBase64` copies headers, footers, watermarks, and
 *    section properties by default, so page size and margins survive. Office.js
 *    exposes page setup only through `WordApiDesktop`, which does not exist in
 *    Word on the web at all.
 *
 * The cost is that the whole document is replaced: one undo step, and the
 * cursor moves. The caller confirms with the attorney first.
 */

export interface StyleSweepResult {
  noOp: boolean
  changedParts: string[]
}

export async function applyStyleSweep(
  postToServer: (fileBase64: string) => Promise<{
    noOp: boolean
    changedParts: string[]
    fileBase64?: string
  }>,
): Promise<StyleSweepResult> {
  if (!Office.context.requirements.isSetSupported('WordApi', '1.5')) {
    throw new Error('This build of Word cannot replace the document (needs WordApi 1.5).')
  }

  const fileBase64 = await readDocumentBytes()
  const styled = await postToServer(fileBase64)

  if (styled.noOp || !styled.fileBase64) {
    return { noOp: true, changedParts: styled.changedParts }
  }

  await serializeWordMutation(() =>
    Word.run(async (context) => {
      context.document.insertFileFromBase64(styled.fileBase64!, Word.InsertLocation.replace, {
        importStyles: true,
        importTheme: true,
        importParagraphSpacing: true,
        importPageColor: true,
        importCustomProperties: true,
        importCustomXmlParts: true,
        // Carry the attorney's tracked-changes setting across rather than
        // resetting it as a side effect of formatting.
        importChangeTrackingMode: true,
      })
      await context.sync()
    }),
  )

  return { noOp: false, changedParts: styled.changedParts }
}
