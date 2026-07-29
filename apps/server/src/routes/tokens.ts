import type { Router } from 'express'
import { z } from 'zod'
import type { AppRouteModule } from '../app.js'
import {
  callService,
  requestActorId,
  routeIdSchema,
  routeVersionSchema,
  sendSuccess,
} from './actors.js'

const timestampSchema = z.iso.datetime({ offset: false })
const tokenNameSchema = z.string().min(1).max(200)
const accessTokenSchema = z.object({
  id: routeIdSchema,
  name: tokenNameSchema,
  createdAt: timestampSchema,
  lastUsedAt: timestampSchema.nullable(),
  revokedAt: timestampSchema.nullable(),
  version: routeVersionSchema,
}).strict()
const issuedAccessTokenSchema = accessTokenSchema.extend({
  token: z.string().regex(
    /^pos_[A-Za-z0-9_-]{24}_[A-Za-z0-9_-]{43}$/,
  ),
}).strict()
const issueTokenBodySchema = z.object({
  name: tokenNameSchema,
}).strict()
const tokenParamsSchema = z.object({
  id: routeIdSchema,
}).strict()
const revokeTokenBodySchema = z.object({
  version: routeVersionSchema,
}).strict()

export const tokenRoutes: AppRouteModule = {
  register(router: Router, getContext) {
    router.get('/tokens', (_request, response) => {
      const context = getContext()
      const tokens = callService(
        z.array(accessTokenSchema),
        () => context.services.tokens.list(),
      )
      sendSuccess(response, tokens)
    })

    router.post('/tokens', (request, response) => {
      const { name } = issueTokenBodySchema.parse(request.body)
      const context = getContext()
      const actorId = requestActorId(context)
      const token = callService(
        issuedAccessTokenSchema,
        () => context.services.tokens.issue(name, actorId, 'web'),
      )
      sendSuccess(response, token, 201)
    })

    router.post('/tokens/:id/revoke', (request, response) => {
      const { id } = tokenParamsSchema.parse(request.params)
      const { version } = revokeTokenBodySchema.parse(request.body)
      const context = getContext()
      const actorId = requestActorId(context)
      const token = callService(
        accessTokenSchema,
        () => context.services.tokens.revoke(
          id,
          version,
          actorId,
          'web',
        ),
      )
      sendSuccess(response, token)
    })
  },
}
