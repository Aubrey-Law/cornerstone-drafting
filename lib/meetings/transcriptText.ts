/**
 * Turn a WebVTT transcript (what Microsoft Graph returns for a Teams meeting)
 * into readable text, one line per utterance, with the speaker kept.
 *
 *   WEBVTT
 *
 *   00:00:01.000 --> 00:00:04.000
 *   <v Pat Client>We want the house in the trust.</v>
 *
 * becomes "Pat Client: We want the house in the trust." Consecutive lines by
 * the same speaker are joined so the follow-up model reads sentences, not
 * caption fragments. Pure, so it is testable without Graph.
 */
export function vttToTranscriptText(vtt: string): string {
  const lines = vtt.replace(/\r\n?/g, '\n').split('\n')
  const utterances: Array<{ speaker: string | null; text: string }> = []
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (/^WEBVTT/i.test(line) || /^NOTE\b/.test(line) || /^STYLE\b/.test(line)) continue
    if (/^\d+$/.test(line)) continue
    if (/-->/.test(line)) continue
    const voice = line.match(/^<v\s+([^>]*)>([\s\S]*?)(?:<\/v>)?$/i)
    const speaker = voice ? voice[1].trim() || null : null
    const text = decodeEntities((voice ? voice[2] : line).replace(/<[^>]+>/g, '').trim())
    if (!text) continue
    const last = utterances[utterances.length - 1]
    if (last && last.speaker === speaker) {
      last.text = `${last.text} ${text}`
    } else {
      utterances.push({ speaker, text })
    }
  }
  return utterances.map(entry => (entry.speaker ? `${entry.speaker}: ${entry.text}` : entry.text)).join('\n')
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
}
