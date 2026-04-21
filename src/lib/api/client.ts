export interface ApiEnvelope {
  ok?: boolean
  message?: string
  code?: string
  stage?: string
  details?: unknown
}

export class ApiClientError extends Error {
  status: number
  code?: string
  stage?: string
  details?: unknown

  constructor(
    message: string,
    options?: {
      status?: number
      code?: string
      stage?: string
      details?: unknown
    },
  ) {
    super(message)
    this.status = options?.status ?? 500
    this.code = options?.code
    this.stage = options?.stage
    this.details = options?.details
  }
}

function stripHtml(input: string) {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeErrorMessage(input: string) {
  const stripped = stripHtml(input)
  if (!stripped) return 'Request failed'
  if (stripped.length > 240) {
    return `${stripped.slice(0, 237).trimEnd()}...`
  }
  return stripped
}

export async function readApiResponse<T extends ApiEnvelope>(
  response: Response,
): Promise<T> {
  const contentType = response.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    const payload = (await response.json().catch(() => null)) as T | null
    if (!payload) {
      throw new ApiClientError('Invalid JSON response from server', {
        status: response.status,
      })
    }

    if (!response.ok || payload.ok === false) {
      throw new ApiClientError(
        payload.message ?? `Request failed with status ${response.status}`,
        {
          status: response.status,
          code: payload.code,
          stage: payload.stage,
          details: payload.details,
        },
      )
    }

    return payload
  }

  const text = await response.text().catch(() => '')
  if (!response.ok) {
    throw new ApiClientError(
      normalizeErrorMessage(text) || `Request failed with status ${response.status}`,
      { status: response.status },
    )
  }

  throw new ApiClientError(
    'Server returned a non-JSON success response unexpectedly',
    { status: response.status },
  )
}

export async function postJson<T extends ApiEnvelope>(
  input: RequestInfo | URL,
  body: unknown,
  init?: Omit<RequestInit, 'body' | 'method'>,
) {
  const response = await fetch(input, {
    ...init,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
    body: JSON.stringify(body),
  })

  return readApiResponse<T>(response)
}

export async function getJson<T extends ApiEnvelope>(
  input: RequestInfo | URL,
  init?: Omit<RequestInit, 'method'>,
) {
  const response = await fetch(input, {
    ...init,
    method: 'GET',
    headers: {
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  return readApiResponse<T>(response)
}

export async function patchJson<T extends ApiEnvelope>(
  input: RequestInfo | URL,
  body: unknown,
  init?: Omit<RequestInit, 'body' | 'method'>,
) {
  const response = await fetch(input, {
    ...init,
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
    body: JSON.stringify(body),
  })

  return readApiResponse<T>(response)
}

export async function deleteJson<T extends ApiEnvelope>(
  input: RequestInfo | URL,
  body?: unknown,
  init?: Omit<RequestInit, 'body' | 'method'>,
) {
  const response = await fetch(input, {
    ...init,
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  return readApiResponse<T>(response)
}

export async function postFormData<T extends ApiEnvelope>(
  input: RequestInfo | URL,
  formData: FormData,
  init?: Omit<RequestInit, 'body' | 'method'>,
) {
  const response = await fetch(input, {
    ...init,
    method: 'POST',
    headers: {
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
    body: formData,
  })

  return readApiResponse<T>(response)
}
