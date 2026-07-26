import type { ReactNode } from 'react'

const URL_PATTERN = /(https?:\/\/[^\s<>"']+)/g

/** Render plain text with http(s) URLs as safe external links. */
export function linkifyText(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  let lastIndex = 0
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0
    if (start > lastIndex) parts.push(text.slice(lastIndex, start))
    parts.push(
      <a
        key={`${start}-${match[0]}`}
        href={match[0]}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 break-all"
      >
        {match[0]}
      </a>,
    )
    lastIndex = start + match[0].length
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts.length ? parts : [text]
}
