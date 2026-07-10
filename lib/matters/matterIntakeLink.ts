/** Matter columns used to link a household intake (lite omits `lead_id`). */
export const MATTER_INTAKE_LINK_COLUMNS = 'id, client_intake_id, client_id' as const

export interface MatterIntakeLinkRow {
  id: string
  client_intake_id: string | null
  client_id: string | null
}
