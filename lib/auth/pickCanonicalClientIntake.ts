/** When multiple `client_intake` rows share an email, pick exactly one row to link
 *  to an auth account. Attorneys may have sent `/intake/auth` invites while the
 *  same email also triggered a self-serve signup draft — both rows can coexist.
 */

export interface ClientIntakePickRow {
  id: string
  client_user_id: string | null
  user_id: string | null
  status: string | null
  lead_id: string | null
  intake_sent_at: string | null
  created_at: string | null
}

/** Deterministic precedence: row already tied to user → lawyer-sent invite → earliest created. */
export function pickCanonicalClientIntakeRow(
  rows: ClientIntakePickRow[],
  authUserId: string,
): ClientIntakePickRow | null {
  if (rows.length === 0) return null

  const byId = [...new Map(rows.map((r) => [r.id, r])).values()]

  const alreadyLinked = byId.filter((r) => r.client_user_id === authUserId)
  if (alreadyLinked.length >= 1) {
    sortByCreatedAt(alreadyLinked)
    return alreadyLinked[0]
  }

  const invited = byId.filter((r) => r.intake_sent_at != null)
  if (invited.length >= 1) {
    invited.sort((a, b) => {
      const at = a.intake_sent_at ?? ''
      const bt = b.intake_sent_at ?? ''
      return bt.localeCompare(at)
    })
    return invited[0]
  }

  sortByCreatedAt(byId)
  return byId[0]
}

function sortByCreatedAt(rows: ClientIntakePickRow[]) {
  rows.sort((a, b) => {
    const at = a.created_at ?? ''
    const bt = b.created_at ?? ''
    return at.localeCompare(bt)
  })
}
