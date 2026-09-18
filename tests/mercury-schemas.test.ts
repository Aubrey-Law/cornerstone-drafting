import { describe, expect, it } from 'vitest'
import {
  mercuryCustomerSchema, mercuryInvoiceSchema, mercuryListSchema, mercuryTransactionSchema,
} from '@/lib/integrations/mercury/types'

/** Shapes below are the live payloads observed on the firm's own account. */

describe('invoice schema', () => {
  const paid = {
    id: '4c5fc90a-9804-11f1-ba17-55875a6aefcd',
    dueDate: '2026-08-14',
    invoiceDate: '2026-08-14',
    invoiceNumber: 'INV-1002',
    customerId: '0ed9fd26-9804-11f1-9d63-b32cfb51cdd3',
    ccEmails: [],
    slug: 'zw5qb3c64v26m4sj',
    status: 'Paid',
    amount: 725,
    currencyCode: 'USD',
    destinationAccountId: '40e1b452-85d1-11f1-92ba-23367ea93847',
    creditCardEnabled: true,
    achDebitEnabled: false,
    useRealAccountNumber: false,
    createdAt: '2026-08-14T17:19:25.380493Z',
    updatedAt: '2026-08-14T17:19:25.380493Z',
  }

  it('accepts Mercury capitalized statuses', () => {
    expect(mercuryInvoiceSchema.parse(paid).status).toBe('Paid')
    expect(mercuryInvoiceSchema.parse({ ...paid, status: 'Cancelled' }).status).toBe('Cancelled')
  })

  it('converts the dollar amount to cents and drops the dollar field', () => {
    const invoice = mercuryInvoiceSchema.parse(paid)
    expect(invoice.amountCents).toBe(72_500)
    expect(invoice).not.toHaveProperty('amount')
  })

  it('parses with line items absent, as the list view returns them', () => {
    expect(mercuryInvoiceSchema.parse(paid).lineItems).toBeUndefined()
  })

  it('parses line items when the single-invoice read includes them', () => {
    const invoice = mercuryInvoiceSchema.parse({
      ...paid,
      lineItems: [{ name: 'College Preparation Plan', unitPrice: 725, quantity: 1, salesTaxRate: 0 }],
    })
    expect(invoice.lineItems?.[0].unitPriceCents).toBe(72_500)
  })

  /** Mercury spells it with one l, and only sends it once cancelled. */
  it('tolerates canceledAt', () => {
    expect(mercuryInvoiceSchema.parse({ ...paid, canceledAt: '2026-08-21T14:14:43.751044Z' }).canceledAt)
      .toBe('2026-08-21T14:14:43.751044Z')
  })

  it('ignores unknown fields rather than failing on an additive provider change', () => {
    expect(() => mercuryInvoiceSchema.parse({ ...paid, somethingNewMercuryAdded: true })).not.toThrow()
  })
})

describe('transaction schema', () => {
  const transaction = {
    id: 'bc8dede0-b061-11f1-9337-4fe3a3dc6942',
    amount: -38,
    postedAt: '2026-09-14T19:17:47.930517Z',
    status: 'sent',
    bankDescription: 'Transfer from Mercury to another bank account',
    counterpartyName: 'Mercury - Checking ••7694',
    kind: 'externalTransfer',
    accountId: '32c294e2-2b49-11f0-9205-837057363052',
  }

  it('parses a live transaction into cents', () => {
    expect(mercuryTransactionSchema.parse(transaction).amountCents).toBe(-3_800)
  })

  it('requires the fields the matcher depends on', () => {
    expect(() => mercuryTransactionSchema.parse({ ...transaction, accountId: undefined })).toThrow()
    expect(() => mercuryTransactionSchema.parse({ ...transaction, kind: undefined })).toThrow()
  })

  /**
   * An unlisted kind must classify as "not a client payment", not throw and
   * take the whole page down.
   */
  it('accepts a transaction kind the documentation does not list', () => {
    expect(mercuryTransactionSchema.parse({ ...transaction, kind: 'somethingNew' }).kind).toBe('somethingNew')
  })
})

describe('list envelope', () => {
  // The resource key is computed, so the parsed shape is only known at runtime.
  type Envelope = { page?: { nextPage?: string | null } | null } & Record<string, unknown>

  it('parses the resource array and pagination cursor', () => {
    const schema = mercuryListSchema('customers', mercuryCustomerSchema)
    const parsed = schema.parse({
      customers: [{ id: '038f4a90-85dd-11f1-b73b-93a307a0d391', email: 'a@example.com', name: 'John Doe' }],
      page: { nextPage: 'df88c7c6-85d1-11f1-af1a-53c5557ec2e3' },
    }) as Envelope

    expect(parsed.customers).toHaveLength(1)
    expect(parsed.page?.nextPage).toBe('df88c7c6-85d1-11f1-af1a-53c5557ec2e3')
  })

  it('parses an empty page object, which is how Mercury signals the last page', () => {
    const schema = mercuryListSchema('invoices', mercuryInvoiceSchema)
    const parsed = schema.parse({ invoices: [], page: {} }) as Envelope
    expect(parsed.page?.nextPage).toBeUndefined()
  })
})
