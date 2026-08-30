/**
 * Hand a file the app produced to the browser.
 *
 * Admin CSV routes require a bearer token, so a plain `<a href>` to one would
 * save an "Unauthorized" JSON body instead of the file. Everything that offers
 * a download here goes through a blob and an object URL, and this is that step
 * in one place.
 */

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function downloadCsv(csv: string, filename: string): void {
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename)
}

/** Fetch an admin CSV route with the caller's token and save what comes back. */
export async function downloadCsvFromRoute(
  url: string,
  filename: string,
  token: string | null,
): Promise<void> {
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(body?.error ?? 'Export failed')
  }
  downloadBlob(await response.blob(), filename)
}
