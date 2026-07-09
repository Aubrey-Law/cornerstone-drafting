/** Minimal CSV parser — handles quoted fields and embedded commas. */
export function parseCsvRows(text: string): string[][] {
  const lines: string[][] = []
  let cur: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') {
        inQuotes = false
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      cur.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (field.length || cur.length) {
        cur.push(field)
        lines.push(cur)
        cur = []
        field = ''
      }
      if (c === '\r' && text[i + 1] === '\n') i++
    } else {
      field += c
    }
  }

  if (field.length || cur.length) {
    cur.push(field)
    lines.push(cur)
  }

  return lines
}
