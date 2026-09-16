export interface LawmaticsRequestInit {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: Record<string, unknown>
  signal?: AbortSignal
}

export interface LawmaticsProspectInput {
  firstName: string
  lastName: string
  email?: string
  phone?: string
}

export interface LawmaticsEventInput {
  name: string
  description: string
  start: string
  end: string
  timezone: string
  prospectId: string
  eventTypeId: string
  userIds: string[]
  locationId?: string
}

export interface LawmaticsResource<Type extends 'prospect' | 'event'> {
  id: string
  type: Type
  attributes?: Record<string, unknown>
  relationships?: Record<string, unknown>
}
