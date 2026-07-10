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

  return missingRequiredFields(context, requiredFields)
}
