import { z } from 'zod'
import { decimalToCents } from './money'

/**
 * Mercury response shapes.
 *
 * Every monetary field is converted here and renamed to `…Cents`, so a raw
 * dollar value has no name to travel under past this boundary. Schemas stay
 * permissive about unknown keys — Mercury adds fields (`slug`, `currencyCode`,
 * `updatedAt` all appear live but are undocumented), and a strict schema would
 * turn an additive provider change into an outage.
 */

const amountCents = z.union([z.number(), z.string()]).transform(decimalToCents)

export const mercuryPageSchema = z.object({
  nextPage: z.string().nullish(),
  previousPage: z.string().nullish(),
}).partial()

export const mercuryAccountSchema = z.object({
  id: z.string(),
  name: z.string().nullish(),
  nickname: z.string().nullish(),
  kind: z.string().nullish(),
  status: z.string().nullish(),
})

/**
 * `kind` and `status` stay open strings rather than enums. The documented sets
 * are incomplete — an unlisted `kind` must classify as "not a client payment",
 * not throw and take the whole page down with it.
 */
export const mercuryTransactionSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  amount: amountCents,
  postedAt: z.string().nullish(),
  status: z.string(),
  kind: z.string(),
  bankDescription: z.string().nullish(),
  counterpartyName: z.string().nullish(),
  counterpartyNickname: z.string().nullish(),
  // What the sender typed. The only place a client can cite an invoice number.
  externalMemo: z.string().nullish(),
  note: z.string().nullish(),
}).transform(({ amount, ...rest }) => ({ ...rest, amountCents: amount }))

export const mercuryLineItemSchema = z.object({
  name: z.string().nullish(),
  unitPrice: amountCents,
  quantity: z.number().nullish(),
  salesTaxRate: z.number().nullish(),
}).transform(({ unitPrice, ...rest }) => ({ ...rest, unitPriceCents: unitPrice }))

/** `canceledAt` is Mercury's spelling (one l) and appears only once cancelled. */
export const mercuryInvoiceSchema = z.object({
  id: z.string(),
  invoiceNumber: z.string().nullish(),
  customerId: z.string().nullish(),
  status: z.string(),
  amount: amountCents,
  invoiceDate: z.string().nullish(),
  dueDate: z.string().nullish(),
  destinationAccountId: z.string().nullish(),
  currencyCode: z.string().nullish(),
  slug: z.string().nullish(),
  createdAt: z.string().nullish(),
  updatedAt: z.string().nullish(),
  canceledAt: z.string().nullish(),
  // Returned by the single-invoice read and omitted from the list view.
  lineItems: z.array(mercuryLineItemSchema).nullish(),
}).transform(({ amount, ...rest }) => ({ ...rest, amountCents: amount }))

export const mercuryCustomerSchema = z.object({
  id: z.string(),
  name: z.string().nullish(),
  email: z.string().nullish(),
})

/** Mercury wraps every list as `{ "<resource>": [...], "page": {...} }`. */
export function mercuryListSchema<T extends z.ZodTypeAny>(resource: string, item: T) {
  return z.object({
    [resource]: z.array(item),
    page: mercuryPageSchema.nullish(),
  })
}

export type MercuryAccount = z.infer<typeof mercuryAccountSchema>
export type MercuryTransaction = z.infer<typeof mercuryTransactionSchema>
export type MercuryInvoice = z.infer<typeof mercuryInvoiceSchema>
export type MercuryCustomer = z.infer<typeof mercuryCustomerSchema>

export interface MercuryRequestInit {
  method: 'GET'
  query?: Record<string, string | number | undefined>
  signal?: AbortSignal
}
