export async function extractDocumentText(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer())

  if (file.name.endsWith('.docx')) {
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ buffer })
    return result.value
  }

  if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfParseModule = await import('pdf-parse') as any
    const pdfParse = pdfParseModule.default ?? pdfParseModule
    const result = await pdfParse(buffer)
    return result.text
  }

  return buffer.toString('utf-8')
}
