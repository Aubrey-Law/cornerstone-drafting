import type { NodeEstateContext, NodeEstatePackageName } from '@/lib/estateGenerator/node/types'
import { getPath, missingRequiredFields } from '@/lib/estateGenerator/node/validation'

export function conditionalMissingFieldsForPackage(
  packageName: NodeEstatePackageName | string,
  context: NodeEstateContext,
): string[] {
  const requiredFields: string[] = []

  if (
    (
      packageName === 'simple-will' ||
      packageName === 'pourover-will' ||
      packageName === 'spouse-pourover-will' ||
      packageName === 'testamentary-trust-will' ||
      packageName === 'spouse-testamentary-trust-will'
    ) &&
    context.requires_guardian_clause
  ) {
    requiredFields.push('guardians.primary.full_name')
  }

  if (
    (
      packageName === 'simple-will' ||
      packageName === 'pourover-will' ||
      packageName === 'spouse-pourover-will' ||
      packageName === 'testamentary-trust-will' ||
      packageName === 'spouse-testamentary-trust-will'
    ) &&
    getPath(context, 'will.pr_structure') === 'co_pr'
  ) {
    requiredFields.push('fiduciaries.executor.co_primary.full_name')
  }

  if (
    (packageName === 'pourover-will' || packageName === 'spouse-pourover-will') &&
    getPath(context, 'pour_over.alternate_disposition') === 'named'
  ) {
    requiredFields.push('pour_over.alternate_named.full_name')
  }

  if (
    packageName === 'simple-will' &&
    getPath(context, 'outright_will.residuary.disposition') === 'named'
  ) {
    requiredFields.push(
      'outright_will.residuary.named.full_name',
      'outright_will.residuary.alternate.full_name',
    )
  }

  if (packageName === 'testamentary-trust-will' || packageName === 'spouse-testamentary-trust-will') {
    const structure = getPath(context, 'testamentary_trust.beneficiary_structure')

    if (getPath(context, 'testamentary_trust.trustee_structure') === 'co_trustees') {
      requiredFields.push('fiduciaries.testamentary_trustee.co_primary.full_name')
    }

    if (structure === 'single_beneficiary') {
      requiredFields.push(
        'testamentary_trust.single_beneficiary.full_name',
        'testamentary_trust.remainder_beneficiary.full_name',
      )
    } else {
      requiredFields.push('testamentary_trust.age_distribution_schedule')
    }

    if (getPath(context, 'testamentary_trust.trust_protector_requested') === true) {
      requiredFields.push('testamentary_trust.trust_protector.full_name')
    }
  }

  if (packageName === 'temporary-delegation-parental-powers') {
    requiredFields.push('guardians.temporary.full_name')
  }

  // A release that names no records authorizes nothing. Only required when the
  // student did not ask for an unlimited release — that branch prints its own
  // sentence and never iterates the list.
  if (packageName === 'ferpa-release' && !context.ferpa_all_records) {
    requiredFields.push('ferpa.records')
  }

  // A power of attorney that grants no powers appoints an agent who can do
  // nothing. Only required when the student did not grant everything — that
  // branch prints the general grant and never iterates the list.
  if (packageName === 'college-financial-poa' && !context.college_dpoa_all_powers) {
    requiredFields.push('college.dpoa_powers')
  }

  if (packageName === 'college-health-care-documents') {
    // HIPAA requires the authorization to state its expiration (45 CFR
    // 164.508(c)(1)(v)) — a date election with no date is not draftable.
    if (getPath(context, 'college.hipaa_expiration') === 'date') {
      requiredFields.push('college.hipaa_expiration_date')
    }
    // An "everything except" release that names no categories is just "all";
    // the design section must say which categories are withheld.
    if (getPath(context, 'college.hipaa_scope') === 'all_except') {
      requiredFields.push('college.hipaa_excluded_categories')
    }
  }

  // The directive's operative articles branch on this instruction; without it
  // the document states no treatment preference at all.
  if (packageName === 'college-advance-directive') {
    requiredFields.push('college.life_support')
  }

  return missingRequiredFields(context, requiredFields)
}
