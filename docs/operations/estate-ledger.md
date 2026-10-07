# Estate ledger (fiduciary inventory and accounting)

This is Probate Phase 3, slice 4. A probate estate's books used to live in a spreadsheet beside the
matter: the inventory at date-of-death value, then every receipt, payment, sale and distribution. On
a probate matter they now live in the **Estate ledger** card, below Probate essentials on the
Overview. The card adds them up to the account.

This is the **estate's** money, recorded for the personal representative. It is not the firm's
money, and it is not a trust (IOLTA) account. Nothing here moves funds.

## Inventory

Each asset the decedent owned at death is recorded with:

- what it is and its kind;
- its value at the date of death;
- how that value was reached (for example, "Appraisal" or "Statement balance").

Untick **Probate property** for joint, beneficiary-designated or trust assets. They stay listed, so
the estate can be seen whole, but they are kept out of the account.

You can correct an asset until it is sold or distributed. After that its value and probate status
are locked, because a gain or an in-kind distribution was measured against them. To change it, delete
that entry first.

## Entries

| Type | Use it for | Amount |
|---|---|---|
| Receipt | money in that was not on the inventory: income, refunds, a late-found asset | what came in |
| Disbursement | expenses, taxes, creditor claims, fees | what went out |
| Sale of an asset | an inventory asset sold, or an account closed into the estate account | the net proceeds; the gain or loss is worked out against its inventory value |
| Distribution | to a beneficiary, in cash or in kind | cash: what was paid; in kind: always the asset's inventory value |

**Principal and income** are kept apart. A sale and an in-kind distribution are always principal.

**One disposal per asset.** An asset can be sold or distributed once. The database enforces this
with a unique index, so a double click cannot count the same asset twice.

**Correcting an entry.** Delete it and enter it again. Amounts are never edited in place.

## The account

The card shows the account, and **Download CSV** exports it with the inventory and every entry:

```
inventory (probate, date-of-death value)
+ receipts
+ gains on sale − losses on sale
− disbursements
− distributions
= balance on hand          (principal and income shown separately)
```

The balance is **proved** against what is held: cash plus the inventory assets not yet sold or
distributed. The card warns in two cases:

- **Overdrawn:** more has been paid out than came in, so an entry is missing.
- **Does not prove:** cash plus assets on hand does not equal the balance, which only happens if an
  in-kind distribution was stored at the wrong value.

## Migration

`20270126090000_estate_ledger.sql` adds two tables, `estate_assets` and `estate_ledger_entries`.
Both are integer cents and staff-only (RLS); the client portal does not see them. Until the
migration runs, the card says the ledger arrives with the next database update.
