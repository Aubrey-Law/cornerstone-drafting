/**
 * The lead list's two vocabularies: the progress states the filter offers and
 * the orders the sort offers.
 *
 * The filtering and sorting themselves used to live here, over whatever rows
 * the page had loaded. They moved into `v_lead_list` and
 * `lib/queries/leadList.ts` (20261014000000) so the list ranks the whole
 * pipeline before paging it; what is left is the shared vocabulary the URL,
 * the client controls and the query all name.
 */

export type LeadProgressFilter =
  | 'all'
  | 'intake_not_sent'
  | 'intake_pending'
  | 'intake_complete'
  | 'engagement_pending'
  | 'engagement_signed'

export type LeadSortKey =
  | 'newest'
  | 'oldest'
  | 'name_asc'
  | 'name_desc'
  | 'fee_desc'
  | 'last_activity'
  | 'score_desc'
