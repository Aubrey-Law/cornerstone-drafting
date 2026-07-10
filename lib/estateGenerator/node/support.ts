import type { NodeEstatePackageName } from '@/lib/estateGenerator/node/types'

export const NODE_SUPPORTED_PACKAGES = new Set<NodeEstatePackageName>([
  'design-summary',
  'estate-plan-summary',
  'pourover-will',
  'trust-individual-single',
  'indv-disclaimer-trust',
  'incapacity-documents',
  'joint-trust',
  'joint-trust-simplified',
  'parental-guardian-appointment',
  'temporary-delegation-parental-powers',
  'personal-property-memorandum',
  'certificate-of-trust',
  'assignment-of-personal-property',
  'funding-instructions',
  'trust-funding-plan',
  'homestead-trustee',
  'simple-will',
  'spouse-incapacity-documents',
  'spouse-pourover-will',
  'spouse-testamentary-trust-will',
  'testamentary-trust-will',
  'young-adult-estate-plan',
])

export function isNodeEstatePackageSupported(packageName: string): packageName is NodeEstatePackageName {
  return NODE_SUPPORTED_PACKAGES.has(packageName as NodeEstatePackageName)
}
