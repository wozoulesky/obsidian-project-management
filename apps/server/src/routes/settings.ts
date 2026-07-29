import {
  accentSchema,
  backgroundSchema,
  densitySchema,
  persistedAppSettingsSchema,
  themeSchema,
} from '@project-os/contracts'
import type { PersistedAppSettings } from '@project-os/contracts'
import type { Router } from 'express'
import { z } from 'zod'
import type { AppRouteModule } from '../app.js'
import {
  callService,
  requestActorId,
  routeVersionSchema,
  sendSuccess,
} from './actors.js'

const updateSettingsBodySchema = z.object({
  theme: themeSchema.optional(),
  background: backgroundSchema.optional(),
  accent: accentSchema.optional(),
  density: densitySchema.optional(),
  version: routeVersionSchema,
}).strict()

export const settingsRoutes: AppRouteModule = {
  register(router: Router, getContext) {
    router.get('/settings', (_request, response) => {
      const context = getContext()
      const settings = callService(
        persistedAppSettingsSchema,
        () => context.services.settings.get(),
      )
      sendSuccess(response, settings)
    })

    router.patch('/settings', (request, response) => {
      const input = updateSettingsBodySchema.parse(request.body)
      const context = getContext()
      const actorId = requestActorId(context)
      const current = callService(
        persistedAppSettingsSchema,
        () => context.services.settings.get(),
      )
      const settings = callService(
        persistedAppSettingsSchema,
        () => context.services.settings.update({
          ...current,
          ...input,
        } as PersistedAppSettings, actorId, 'web'),
      )
      sendSuccess(response, settings)
    })
  },
}
