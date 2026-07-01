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

export function dataForNodeEstatePackage(
  data: NodeEstateData,
  packageName: NodeEstatePackageName,
): NodeEstateData {
  if (packageName === 'spouse-pourover-will') {
    return spousePouroverWillData(data)
  }

  if (packageName === 'spouse-incapacity-documents') {
    return spouseIncapacityDocumentsData(data)
  }

  if (packageName === 'spouse-testamentary-trust-will') {
    return spouseTestamentaryTrustWillData(data)
  }

  return data
}
