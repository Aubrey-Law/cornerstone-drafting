-- Plan claims for every named legal-plan carrier.
--
-- matter_details.billing_type has accepted arag, hyatt and legalshield since
-- 20260903000000, but the ledger only knew MetLife and LegalEASE: a plan claim
-- could not name the other three, and a carrier invoice could not be billed to
-- them. "Start a claim" on an ARAG, Hyatt or LegalShield matter therefore
-- offered MetLife or LegalEASE, and whatever was chosen was wrong.
--
-- Widen both lists to the five named carriers in MATTER_BILLING_TYPES
-- (lib/billing/billingType.ts) and billingPlans (lib/billing/types.ts).
-- other_legal_plan stays out: it names no carrier to bill. Nothing else in the
-- database lists carriers: billing_item_payer() copies the plan through, and
-- is_legal_plan_billing() treats every non-flat-fee billing type as a carrier.
-- Widening a check cannot invalidate an existing row.

alter table public.billing_items drop constraint if exists billing_items_plan_check;
alter table public.billing_items
  add constraint billing_items_plan_check
  check (plan is null or plan in ('metlife', 'legalease', 'arag', 'hyatt', 'legalshield'));

alter table public.invoices drop constraint if exists invoices_payer_check;
alter table public.invoices
  add constraint invoices_payer_check
  check (payer in ('client', 'metlife', 'legalease', 'arag', 'hyatt', 'legalshield'));

notify pgrst, 'reload schema';
