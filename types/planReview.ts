export type ReviewStatus =
  | 'draft'
  | 'sent'
  | 'in_progress'
  | 'client_approved'
  | 'attorney_unlocked'
  | 'approved';

export type SlotState = 'filled' | 'pending_client' | 'optional';

export interface FiduciarySlotStates {
  trustee_primary?: SlotState;
  trustee_alt1?: SlotState;
  trustee_alt2?: SlotState;
  executor_primary?: SlotState;
  executor_alt1?: SlotState;
  poa_primary?: SlotState;
  poa_alt1?: SlotState;
  hcp_primary?: SlotState;
  hcp_alt1?: SlotState;
  guardian_primary?: SlotState;
  guardian_alt1?: SlotState;
}

export interface ReviewNote {
  id: string;
  field: string;
  field_label: string;
  original_value: string;
  client_note: string;
  submitted_at: string;
  resolved: boolean;
  resolved_at?: string;
}

export interface ClientContact {
  id: string;
  first_name: string;
  last_name: string;
  relationship: string | null;
  phone: string | null;
  email: string | null;
}

export interface PlanReviewData {
  // Identity
  matterId: string;
  practiceArea: 'EP' | 'EP-LP';
  reviewStatus: ReviewStatus;

  // Personal
  clientName: string;
  clientDob: string;
  clientPhone: string;
  clientEmail: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  maritalStatus: string;
  spouseName: string;
  spouseDob: string;

  // Children
  children: {
    name: string;
    dob: string | null;
    isMinor: boolean;
  }[];

  // Fiduciaries
  fiduciarySlots: FiduciarySlotStates;
  contacts: Record<string, ClientContact | null>;
  hasMinorChildren: boolean;
  planType: string;

  // Distribution (EP-LP only)
  residuarySpouseSurvives?: string;
  residuaryNoSpouse?: string;
  residuarySpecificGifts?: string;

  // Review metadata
  reviewNotes: ReviewNote[];
  clientSignature: string | null;
  spouseSignature: string | null;
  planCoverage?: 'no_trust' | 'trust_included';
  clientReviewCompletedAt?: string;
}
