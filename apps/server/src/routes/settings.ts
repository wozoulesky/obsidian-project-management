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
  createProjectOsSkillArchive,
  createSkillConfigSnippet,
  skillConfigClients,
} from '../skill-package.js'
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

const skillConfigClientSchema = z.enum(skillConfigClients)

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

    router.get('/skills/project-os.zip', (_request, response) => {
      const archive = createProjectOsSkillArchive()
      response.status(200)
      response.setHeader('Content-Type', 'application/zip')
      response.setHeader(
        'Content-Disposition',
        'attachment; filename="project-os.zip"',
      )
      response.setHeader('Content-Length', String(archive.byteLength))
      response.end(Buffer.from(archive))
    })

    router.get(
      '/skills/project-os/config-snippets/:client',
      (request, response) => {
        const client = skillConfigClientSchema.parse(request.params.client)
        sendSuccess(response, {
          client,
          transport: 'stdio',
          snippet: createSkillConfigSnippet(client),
        })
      },
    )
  },
}
