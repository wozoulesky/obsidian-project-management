import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import type { Router } from 'express'
import { z } from 'zod'
import type { AppRouteModule } from '../app.js'
import {
  internalOperation,
  parseResponse,
  requestActorId,
  sendSuccess,
} from './actors.js'

const filenameSchema = z.string()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9._-]+\.sqlite$/)
const createBackupBodySchema = z.object({
  filename: filenameSchema.optional(),
}).strict()
const restoreBackupBodySchema = z.object({
  filename: filenameSchema,
}).strict()
const backupResponseSchema = z.object({
  filename: filenameSchema,
  path: z.string().regex(/^backups\/[A-Za-z0-9._-]+\.sqlite$/),
}).strict()

function generatedFilename(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `project-os-${timestamp}-${randomUUID()}.sqlite`
}

function responseData(filename: string) {
  return parseResponse(backupResponseSchema, {
    filename,
    path: `backups/${filename}`,
  })
}

export const backupRoutes: AppRouteModule = {
  register(router: Router, getContext) {
    router.post('/backups', async (request, response) => {
      const input = createBackupBodySchema.parse(request.body)
      const context = getContext()
      const actorId = requestActorId(context)
      const filename = input.filename ?? generatedFilename()
      const createdPath = await internalOperation(
        () => context.services.backups.create(filename, actorId, 'web'),
      )
      parseResponse(z.string().min(1), createdPath)
      sendSuccess(response, responseData(filename), 201)
    })

    router.post('/backups/restore', (request, response) => {
      const { filename } = restoreBackupBodySchema.parse(request.body)
      const context = getContext()
      const actorId = requestActorId(context)
      internalOperation(() => context.services.backups.restore(
        resolve(context.backupRoot, filename),
        actorId,
        'web',
      ))
      sendSuccess(response, responseData(filename))
    })
  },
}
