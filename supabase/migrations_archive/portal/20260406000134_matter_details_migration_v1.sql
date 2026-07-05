ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS responsible_attorney text;
COMMENT ON COLUMN public.matter_details.responsible_attorney IS 'Full name of the supervising/responsible attorney assigned to this matter.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS co_counsel text;
COMMENT ON COLUMN public.matter_details.co_counsel IS 'Name of co-counsel, if any, associated with this matter.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS paralegal_assigned text;
COMMENT ON COLUMN public.matter_details.paralegal_assigned IS 'Name of the paralegal assigned to work on this matter.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS jurisdiction_state text DEFAULT 'MA';
COMMENT ON COLUMN public.matter_details.jurisdiction_state IS 'Two-letter state code for the governing jurisdiction. Defaults to MA (Massachusetts).';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS jurisdiction_county text;
COMMENT ON COLUMN public.matter_details.jurisdiction_county IS 'County of client domicile (estate planning) or county of probate filing.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS urgency text DEFAULT 'standard' CONSTRAINT matter_details_urgency_check CHECK (urgency IN ('standard', 'expedited', 'urgent'));
COMMENT ON COLUMN public.matter_details.urgency IS 'Priority level of this matter: standard, expedited, or urgent.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS ep_plan_category text CONSTRAINT matter_details_ep_plan_category_check CHECK (ep_plan_category IN ('initial', 'amendment', 'restatement', 'review_update'));
COMMENT ON COLUMN public.matter_details.ep_plan_category IS 'Categorizes the estate planning engagement: initial, amendment, restatement, or review_update.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS ep_trust_type text CONSTRAINT matter_details_ep_trust_type_check CHECK (ep_trust_type IN ('revocable_living', 'irrevocable', 'ilit', 'qprt', 'grat', 'special_needs', 'other'));
COMMENT ON COLUMN public.matter_details.ep_trust_type IS 'The primary trust type being drafted or administered.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS ep_ancillary_docs jsonb DEFAULT '[]';
COMMENT ON COLUMN public.matter_details.ep_ancillary_docs IS 'JSON array of ancillary document tracking objects. Each element: { "doc_type": string, "status": string, "notes": string }.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS ep_funding_status text DEFAULT 'not_started' CONSTRAINT matter_details_ep_funding_status_check CHECK (ep_funding_status IN ('not_started', 'in_progress', 'complete'));
COMMENT ON COLUMN public.matter_details.ep_funding_status IS 'Tracks whether trust funding has begun: not_started, in_progress, or complete.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS ep_deed_transfers_needed boolean DEFAULT false;
COMMENT ON COLUMN public.matter_details.ep_deed_transfers_needed IS 'True if real property deed transfers are needed to fund the trust.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS ep_beneficiary_updates_needed boolean DEFAULT false;
COMMENT ON COLUMN public.matter_details.ep_beneficiary_updates_needed IS 'True if the client needs to update beneficiary designations.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS ep_powers_of_attorney_status text DEFAULT 'not_started' CONSTRAINT matter_details_ep_poa_status_check CHECK (ep_powers_of_attorney_status IN ('not_started', 'drafted', 'executed'));
COMMENT ON COLUMN public.matter_details.ep_powers_of_attorney_status IS 'Workflow status of the durable power of attorney document(s).';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS ep_healthcare_proxy_status text DEFAULT 'not_started' CONSTRAINT matter_details_ep_hcp_status_check CHECK (ep_healthcare_proxy_status IN ('not_started', 'drafted', 'executed'));
COMMENT ON COLUMN public.matter_details.ep_healthcare_proxy_status IS 'Workflow status of the healthcare proxy document.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS ep_has_prenuptial boolean DEFAULT false;
COMMENT ON COLUMN public.matter_details.ep_has_prenuptial IS 'True if the client has a prenuptial agreement.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS ep_prior_plan_date date;
COMMENT ON COLUMN public.matter_details.ep_prior_plan_date IS 'Execution date of the client''s prior estate plan documents.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS ep_prior_plan_firm text;
COMMENT ON COLUMN public.matter_details.ep_prior_plan_firm IS 'Name of the firm or attorney that drafted the client''s prior estate plan.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS ep_special_provisions text;
COMMENT ON COLUMN public.matter_details.ep_special_provisions IS 'Free-text field for special or non-standard plan provisions.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_decedent_name text;
COMMENT ON COLUMN public.matter_details.pb_decedent_name IS 'Full legal name of the decedent for whom probate is being administered.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_date_of_death date;
COMMENT ON COLUMN public.matter_details.pb_date_of_death IS 'Date of the decedent''s death.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_place_of_death text;
COMMENT ON COLUMN public.matter_details.pb_place_of_death IS 'City and state where the decedent died.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_domicile_at_death text;
COMMENT ON COLUMN public.matter_details.pb_domicile_at_death IS 'Legal domicile of the decedent at the time of death.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_cause_of_death_type text CONSTRAINT matter_details_pb_cause_check CHECK (pb_cause_of_death_type IN ('natural', 'accidental', 'other'));
COMMENT ON COLUMN public.matter_details.pb_cause_of_death_type IS 'General classification of manner of death.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_probate_type text CONSTRAINT matter_details_pb_probate_type_check CHECK (pb_probate_type IN ('informal', 'formal', 'voluntary', 'small_estate', 'ancillary', 'mupc_supervised', 'mupc_unsupervised'));
COMMENT ON COLUMN public.matter_details.pb_probate_type IS 'Type of Massachusetts probate proceeding.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_will_exists boolean DEFAULT false;
COMMENT ON COLUMN public.matter_details.pb_will_exists IS 'True if the decedent left a Last Will and Testament.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_will_date date;
COMMENT ON COLUMN public.matter_details.pb_will_date IS 'Execution date of the decedent''s will.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_will_codicils integer DEFAULT 0;
COMMENT ON COLUMN public.matter_details.pb_will_codicils IS 'Number of codicils to the will.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_testate_intestate text CONSTRAINT matter_details_pb_testate_check CHECK (pb_testate_intestate IN ('testate', 'intestate'));
COMMENT ON COLUMN public.matter_details.pb_testate_intestate IS 'Whether the decedent died testate or intestate.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_court_name text DEFAULT 'Norfolk Probate & Family Court';
COMMENT ON COLUMN public.matter_details.pb_court_name IS 'Full name of the probate court where the estate is filed.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_court_division text;
COMMENT ON COLUMN public.matter_details.pb_court_division IS 'Specific division or location identifier for the probate court.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_docket_number text;
COMMENT ON COLUMN public.matter_details.pb_docket_number IS 'Docket or case number assigned by the probate court upon filing.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_bond_required boolean DEFAULT false;
COMMENT ON COLUMN public.matter_details.pb_bond_required IS 'True if the court requires the personal representative to obtain a surety bond.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_bond_amount numeric;
COMMENT ON COLUMN public.matter_details.pb_bond_amount IS 'Dollar amount of the surety bond required by the court.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_bond_surety text;
COMMENT ON COLUMN public.matter_details.pb_bond_surety IS 'Name of the surety company providing the bond.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_personal_representative text;
COMMENT ON COLUMN public.matter_details.pb_personal_representative IS 'Full name of the court-appointed personal representative.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_pr_appointment_date date;
COMMENT ON COLUMN public.matter_details.pb_pr_appointment_date IS 'Date the personal representative was formally appointed by the probate court.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_pr_type text CONSTRAINT matter_details_pb_pr_type_check CHECK (pb_pr_type IN ('individual', 'corporate', 'co_representatives'));
COMMENT ON COLUMN public.matter_details.pb_pr_type IS 'Classification of the personal representative.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_inventory_due_date date;
COMMENT ON COLUMN public.matter_details.pb_inventory_due_date IS 'Court deadline by which the estate inventory must be filed.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_inventory_filed_date date;
COMMENT ON COLUMN public.matter_details.pb_inventory_filed_date IS 'Date the estate inventory was filed with the probate court.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_inventory_value numeric;
COMMENT ON COLUMN public.matter_details.pb_inventory_value IS 'Total appraised value of the probate estate per the inventory.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_real_property_value numeric;
COMMENT ON COLUMN public.matter_details.pb_real_property_value IS 'Aggregate fair market value of real property in the probate estate.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_personal_property_value numeric;
COMMENT ON COLUMN public.matter_details.pb_personal_property_value IS 'Aggregate value of personal property in the probate estate.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_claims_period_end date;
COMMENT ON COLUMN public.matter_details.pb_claims_period_end IS 'Last date creditors may file claims against the estate.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_creditor_notice_published boolean DEFAULT false;
COMMENT ON COLUMN public.matter_details.pb_creditor_notice_published IS 'True if the notice to creditors has been published in a newspaper.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_creditor_notice_date date;
COMMENT ON COLUMN public.matter_details.pb_creditor_notice_date IS 'Date the creditor notice was published.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_known_creditors_notified boolean DEFAULT false;
COMMENT ON COLUMN public.matter_details.pb_known_creditors_notified IS 'True if all known creditors have been sent written notice.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_federal_estate_tax_required boolean DEFAULT false;
COMMENT ON COLUMN public.matter_details.pb_federal_estate_tax_required IS 'True if the estate is required to file a federal estate tax return (Form 706).';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_state_estate_tax_required boolean DEFAULT false;
COMMENT ON COLUMN public.matter_details.pb_state_estate_tax_required IS 'True if the estate is required to file a Massachusetts estate tax return (Form M-706).';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_form_706_due_date date;
COMMENT ON COLUMN public.matter_details.pb_form_706_due_date IS 'Due date for the federal estate tax return (IRS Form 706).';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_form_706_filed_date date;
COMMENT ON COLUMN public.matter_details.pb_form_706_filed_date IS 'Date the federal estate tax return (Form 706) was filed.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_m706_due_date date;
COMMENT ON COLUMN public.matter_details.pb_m706_due_date IS 'Due date for the Massachusetts estate tax return (Form M-706).';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_m706_filed_date date;
COMMENT ON COLUMN public.matter_details.pb_m706_filed_date IS 'Date the Massachusetts estate tax return (Form M-706) was filed.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_income_tax_final_return_filed boolean DEFAULT false;
COMMENT ON COLUMN public.matter_details.pb_income_tax_final_return_filed IS 'True if the decedent''s final personal income tax return has been filed.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_fiduciary_income_tax_due_date date;
COMMENT ON COLUMN public.matter_details.pb_fiduciary_income_tax_due_date IS 'Due date for the estate''s fiduciary income tax return (IRS Form 1041).';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_fiduciary_income_tax_filed_date date;
COMMENT ON COLUMN public.matter_details.pb_fiduciary_income_tax_filed_date IS 'Date the fiduciary income tax return was filed.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_accounting_filed boolean DEFAULT false;
COMMENT ON COLUMN public.matter_details.pb_accounting_filed IS 'True if a formal accounting of the estate administration has been filed.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_accounting_filed_date date;
COMMENT ON COLUMN public.matter_details.pb_accounting_filed_date IS 'Date the formal estate accounting was filed.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_distribution_plan_approved boolean DEFAULT false;
COMMENT ON COLUMN public.matter_details.pb_distribution_plan_approved IS 'True if the proposed plan of distribution has been approved.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_final_distribution_date date;
COMMENT ON COLUMN public.matter_details.pb_final_distribution_date IS 'Date on which final distributions of estate assets were made.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_estate_closed boolean DEFAULT false;
COMMENT ON COLUMN public.matter_details.pb_estate_closed IS 'True if the estate administration is complete and the estate has been formally closed.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_estate_closed_date date;
COMMENT ON COLUMN public.matter_details.pb_estate_closed_date IS 'Date the estate was formally closed.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_real_property_needs_sale boolean DEFAULT false;
COMMENT ON COLUMN public.matter_details.pb_real_property_needs_sale IS 'True if one or more parcels of real property need to be sold during administration.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_family_settlement_agreement boolean DEFAULT false;
COMMENT ON COLUMN public.matter_details.pb_family_settlement_agreement IS 'True if the beneficiaries have entered into a family settlement agreement.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_contested boolean DEFAULT false;
COMMENT ON COLUMN public.matter_details.pb_contested IS 'True if any aspect of the estate or will is being contested.';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS pb_contest_details text;
COMMENT ON COLUMN public.matter_details.pb_contest_details IS 'Free-text description of any contested issues.';;
