import { serializeWordMutation } from '../mutationQueue'

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

/** Office allows only two open file handles per document; every path closes. */
async function readDocumentBytes(): Promise<string> {
  const file = await new Promise<Office.File>((resolve, reject) => {
    Office.context.document.getFileAsync(
      Office.FileType.Compressed,
      { sliceSize: 4 * 1024 * 1024 },
      (result) => {
        if (result.status === Office.AsyncResultStatus.Succeeded) resolve(result.value)
        else reject(new Error(result.error?.message ?? 'Could not read the document.'))
      },
    )
  })

  try {
    const chunks: number[][] = []
    for (let i = 0; i < file.sliceCount; i++) {
      const slice = await new Promise<Office.Slice>((resolve, reject) => {
        file.getSliceAsync(i, (result) => {
          if (result.status === Office.AsyncResultStatus.Succeeded) resolve(result.value)
          else reject(new Error(result.error?.message ?? 'Could not read the document.'))
        })
      })
      chunks.push(slice.data as number[])
    }
    return toBase64(chunks)
  } finally {
    file.closeAsync()
  }
}

function toBase64(chunks: number[][]): string {
  // Chunked so a large document does not blow the argument limit of
  // String.fromCharCode with a single spread of millions of bytes.
  let binary = ''
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i += 8192) {
      binary += String.fromCharCode(...chunk.slice(i, i + 8192))
    }
  }
  return btoa(binary)
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
