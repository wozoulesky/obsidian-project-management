import {
  apiErrorEnvelopeSchema,
  apiSuccessEnvelopeSchema,
} from '@project-os/contracts'
import type {
  ApiErrorEnvelope,
  ApiSuccessEnvelope,
} from '@project-os/contracts'
import { z } from 'zod'

export function successEnvelope<T>(
  data: T,
  requestId: string,
): ApiSuccessEnvelope<T> {
  return apiSuccessEnvelopeSchema(z.unknown()).parse({
    data,
    error: null,
    meta: { request_id: requestId },
  }) as ApiSuccessEnvelope<T>
}

export function errorEnvelope(
  code: string,
  message: string,
  details: Record<string, unknown>,
  requestId: string,
): ApiErrorEnvelope {
  return apiErrorEnvelopeSchema.parse({
    data: null,
    error: { code, message, details },
    meta: { request_id: requestId },
  })
}
