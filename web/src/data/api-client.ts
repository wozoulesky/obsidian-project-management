import {
  apiErrorEnvelopeSchema,
  apiSuccessEnvelopeSchema,
} from '@project-os/contracts'
import type { z } from 'zod'

export class ApiError extends Error {
  readonly code: string
  readonly status: number
  readonly requestId?: string
  readonly details: Record<string, unknown>

  constructor(options: {
    code: string
    message: string
    status: number
    requestId?: string
    details?: Record<string, unknown>
  }) {
    super(options.message)
    this.name = 'ApiError'
    this.code = options.code
    this.status = options.status
    this.requestId = options.requestId
    this.details = options.details ?? {}
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

function requestIdFrom(value: unknown): string | undefined {
  if (
    typeof value !== 'object'
    || value === null
    || !('meta' in value)
    || typeof value.meta !== 'object'
    || value.meta === null
    || !('request_id' in value.meta)
    || typeof value.meta.request_id !== 'string'
  ) {
    return undefined
  }
  return value.meta.request_id
}

export class ApiClient {
  private readonly baseUrl: string

  constructor(baseUrl = '/api/v1') {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  async request<Output>(
    path: string,
    schema: z.ZodType<Output>,
    init: RequestInit = {},
  ): Promise<Output> {
    const headers = Object.fromEntries(new Headers(init.headers).entries())
    headers.Accept = 'application/json'
    if (
      init.body !== undefined
      && !(init.body instanceof FormData)
      && !Object.keys(headers).some(
        (name) => name.toLowerCase() === 'content-type',
      )
    ) headers['Content-Type'] = 'application/json'

    const response = await fetch(
      `${this.baseUrl}/${path.replace(/^\/+/, '')}`,
      { ...init, headers },
    )
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new ApiError({
        code: 'API_RESPONSE_INVALID',
        message: 'API response was not valid JSON',
        status: response.status,
      })
    }

    if (!response.ok) {
      const parsedError = apiErrorEnvelopeSchema.safeParse(payload)
      if (parsedError.success) {
        throw new ApiError({
          code: parsedError.data.error.code,
          message: parsedError.data.error.message,
          status: response.status,
          requestId: parsedError.data.meta.request_id,
          details: parsedError.data.error.details,
        })
      }
      throw new ApiError({
        code: 'API_RESPONSE_INVALID',
        message: 'API error response did not match its contract',
        status: response.status,
        requestId: requestIdFrom(payload),
      })
    }

    const parsed = apiSuccessEnvelopeSchema(schema).safeParse(payload)
    if (!parsed.success) {
      throw new ApiError({
        code: 'API_RESPONSE_INVALID',
        message: 'API response did not match its contract',
        status: response.status,
        requestId: requestIdFrom(payload),
        details: { issues: parsed.error.issues },
      })
    }
    return parsed.data.data
  }

  async download(path: string, init: RequestInit = {}): Promise<Blob> {
    const response = await fetch(
      `${this.baseUrl}/${path.replace(/^\/+/, '')}`,
      init,
    )
    if (response.ok) return response.blob()

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new ApiError({
        code: 'API_RESPONSE_INVALID',
        message: 'API error response was not valid JSON',
        status: response.status,
      })
    }
    const parsedError = apiErrorEnvelopeSchema.safeParse(payload)
    if (!parsedError.success) {
      throw new ApiError({
        code: 'API_RESPONSE_INVALID',
        message: 'API error response did not match its contract',
        status: response.status,
        requestId: requestIdFrom(payload),
      })
    }
    throw new ApiError({
      code: parsedError.data.error.code,
      message: parsedError.data.error.message,
      status: response.status,
      requestId: parsedError.data.meta.request_id,
      details: parsedError.data.error.details,
    })
  }
}
