import type { NodeEstateData, NodeEstatePackageName } from '@/lib/estateGenerator/node/types'

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function firstValue(...values: unknown[]): unknown {
  return values.find(value => value !== undefined && value !== null && value !== '')
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function person(fullName: unknown, extra: Record<string, unknown> = {}) {
  return {
    full_name: textValue(fullName),
    ...extra,
  }
}

function spouseBaseData(data: NodeEstateData): NodeEstateData {
  const client = recordValue(data.client)
  const spouse = recordValue(data.spouse)
  const spouseFields = Object.fromEntries(
    Object.entries(spouse).filter(([key]) => key !== 'exists'),
  )

  return {
    ...data,
    client: {
      ...client,
      ...spouseFields,
      full_name: firstValue(spouse.full_name) ?? '',
      date_of_birth: firstValue(spouse.date_of_birth, spouse.dob) ?? '',
      street_address: firstValue(spouse.street_address, client.street_address),
      city: firstValue(spouse.city, client.city),
      county: firstValue(spouse.county, client.county),
      state: firstValue(spouse.state, client.state),
      signing_county: firstValue(spouse.signing_county, client.signing_county),
    },
    spouse: {
      ...client,
      exists: true,
    },
  }
}

function spousePouroverWillData(data: NodeEstateData): NodeEstateData {
  const fiduciaries = recordValue(data.fiduciaries)

  return {
    ...spouseBaseData(data),
    fiduciaries: {
      ...fiduciaries,
      executor: recordValue(fiduciaries.spouse_executor),
    },
  }
}

function spouseIncapacityDocumentsData(data: NodeEstateData): NodeEstateData {
  const fiduciaries = recordValue(data.fiduciaries)
  const healthcare = recordValue(data.healthcare)

  return {
    ...spouseBaseData(data),
    fiduciaries: {
      ...fiduciaries,
      agent: recordValue(fiduciaries.spouse_agent),
    },
    healthcare: {
      ...healthcare,
      agent: recordValue(healthcare.spouse_agent),
    },
  }
}

function spouseTestamentaryTrustWillData(data: NodeEstateData): NodeEstateData {
  const fiduciaries = recordValue(data.fiduciaries)

  return {
    ...spouseBaseData(data),
    fiduciaries: {
      ...fiduciaries,
      executor: recordValue(fiduciaries.spouse_executor),
      testamentary_trustee: recordValue(fiduciaries.spouse_testamentary_trustee),
    },
  }
}

export function youngAdultEstatePlanData(data: NodeEstateData, child: Record<string, unknown>): NodeEstateData {
  const client = recordValue(data.client)
  const spouse = recordValue(data.spouse)
  const fiduciaries = recordValue(data.fiduciaries)
  const healthcare = recordValue(data.healthcare)
  const execution = recordValue(data.execution)
  const primaryParent = person(client.full_name, {
    address: firstValue(client.street_address, client.address),
    city: client.city,
    state: client.state,
    phone: client.phone,
  })
  const secondParent = person(spouse.full_name, {
    address: firstValue(spouse.street_address, client.street_address, client.address),
    city: firstValue(spouse.city, client.city),
    state: firstValue(spouse.state, client.state),
    phone: firstValue(spouse.phone, client.phone),
  })
  const primaryAgent = primaryParent
  const successorAgent = secondParent.full_name ? secondParent : recordValue(recordValue(fiduciaries.agent).successor)

  return {
    ...data,
    client: {
      ...child,
      full_name: firstValue(child.full_name, child.name),
      date_of_birth: firstValue(child.date_of_birth, child.dob),
      city: firstValue(child.city, client.city),
      county: firstValue(child.county, client.county),
      state: firstValue(child.state, client.state, 'MA'),
      signing_county: firstValue(child.signing_county, client.signing_county, client.county),
    },
    spouse: { exists: false },
    fiduciaries: {
      ...fiduciaries,
      agent: {
        primary: primaryAgent,
        successor: successorAgent,
      },
    },
    healthcare: {
      ...healthcare,
      agent: {
        primary: primaryAgent,
        alternate: successorAgent,
      },
    },
    execution: {
      ...execution,
      signing_county: firstValue(execution.signing_county, client.signing_county, client.county),
    },
    young_adult: {
      parent1: primaryParent,
      parent2: secondParent,
    },
  }
}

// Single-instrument packages, used to honor a bequest's `document` routing.
// `core-estate` renders several instruments from one context and is left
// unfiltered, matching the previous render-everywhere behavior.
const WILL_PACKAGE_NAMES = new Set<NodeEstatePackageName>([
  'pourover-will',
  'simple-will',
  'testamentary-trust-will',
  'spouse-pourover-will',
  'spouse-testamentary-trust-will',
])

const TRUST_PACKAGE_NAMES = new Set<NodeEstatePackageName>([
  'indv-disclaimer-trust',
  'joint-trust',
  'joint-trust-simplified',
  'trust-individual-single',
])

/**
 * Keep gifts and pet-care provisions the attorney routed to the other
 * instrument out of this package. A gift with no `document` renders in both,
 * as before — routing is opt-in per bequest.
 */
function routeDispositionsForPackage(
  data: NodeEstateData,
  packageName: NodeEstatePackageName,
): NodeEstateData {
  const isWill = WILL_PACKAGE_NAMES.has(packageName)
  const isTrust = TRUST_PACKAGE_NAMES.has(packageName)
  if (!isWill && !isTrust) return data

  const excluded = isWill ? 'trust' : 'will'
  const next: NodeEstateData = { ...data }

  const filterGifts = (value: unknown): unknown[] | undefined => {
    if (!Array.isArray(value)) return undefined
    return value.filter(gift => recordValue(gift).document !== excluded)
  }

  const gifts = filterGifts(data.specific_gifts)
  if (gifts) next.specific_gifts = gifts
  const charitable = filterGifts(data.charitable_gifts)
  if (charitable) next.charitable_gifts = charitable

  const will = recordValue(data.will)
  const petCare = recordValue(will.pet_care)
  if (petCare.document === excluded) {
    next.will = { ...will, pet_care: { ...petCare, option: 'omit' } }
  }

  return next
}

export function dataForNodeEstatePackage(
  data: NodeEstateData,
  packageName: NodeEstatePackageName,
): NodeEstateData {
  const routed = routeDispositionsForPackage(data, packageName)

  if (packageName === 'spouse-pourover-will') {
    return spousePouroverWillData(routed)
  }

  if (packageName === 'spouse-incapacity-documents') {
    return spouseIncapacityDocumentsData(routed)
  }

  if (packageName === 'spouse-testamentary-trust-will') {
    return spouseTestamentaryTrustWillData(routed)
  }

  return routed
}
