/**
 * Copy text to the clipboard, tolerating the two ways this fails in practice.
 *
 * The first is a browser without the async clipboard API on this origin — the
 * legacy `execCommand` path still works there. The second is subtler: the
 * transient user activation from the click expires while we await the value,
 * so a handler that fetches the text before writing it is rejected on WebKit.
 * Passing the *pending* value lets `ClipboardItem` hand the promise straight to
 * the browser, which keeps the gesture alive.
 *
 * Returns whether the text reached the clipboard. A rejected `source` is
 * rethrown, so a failed fetch stays distinguishable from a failed copy.
 */
export async function copyToClipboard(source: string | Promise<string>): Promise<boolean> {
  if (typeof source !== 'string') {
    if (typeof ClipboardItem === 'function' && typeof navigator?.clipboard?.write === 'function') {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': source.then(text => new Blob([text], { type: 'text/plain' })),
          }),
        ])
        return true
      } catch {
        // Either the write was refused or `source` rejected. Awaiting it below
        // rethrows a rejection and otherwise falls through to the plain write.
      }
    }
    return writeText(await source)
  }
  return writeText(source)
}

async function writeText(text: string): Promise<boolean> {
  if (typeof navigator?.clipboard?.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through to the legacy path.
    }
  }
  return legacyCopy(text)
}

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false
  const field = document.createElement('textarea')
  field.value = text
  field.setAttribute('readonly', '')
  field.style.position = 'fixed'
  field.style.top = '0'
  field.style.opacity = '0'
  document.body.appendChild(field)
  try {
    field.select()
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    field.remove()
  }
}
