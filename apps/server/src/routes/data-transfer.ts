import { persistedActorSchema } from '@project-os/contracts'
import type { PersistedActor } from '@project-os/contracts'
import {
  DomainError,
  validateExportDocument,
} from '@project-os/core'
import type { ExportDocument } from '@project-os/core'
import type { RequestHandler, Router } from 'express'
import multer from 'multer'
import { z } from 'zod'
import type { AppRouteModule } from '../app.js'
import {
  callService,
  internalOperation,
  parseResponse,
  requestActorId,
  sendSuccess,
} from './actors.js'

const maxImportBytes = 25 * 1024 * 1024
const exportDocumentSchema = z.custom<ExportDocument>((value) => {
  try {
    validateExportDocument(value)
    return true
  } catch {
    return false
  }
})
const importCountsSchema = z.object({
  ok: z.literal(true),
  counts: z.object({
    actors: z.number().int().nonnegative(),
    projects: z.number().int().nonnegative(),
    projectMembers: z.number().int().nonnegative(),
    tasks: z.number().int().nonnegative(),
    requirements: z.number().int().nonnegative(),
    defects: z.number().int().nonnegative(),
  }).strict(),
}).strict()

function importInvalid(): DomainError {
  return new DomainError('IMPORT_INVALID', 'Import document is invalid')
}

function sameLocalActorIdentity(
  current: PersistedActor,
  imported: PersistedActor | undefined,
): boolean {
  return imported !== undefined
    && current.kind === 'human'
    && current.status === 'active'
    && current.client === null
    && imported.kind === 'human'
    && imported.status === 'active'
    && imported.client === null
    && imported.id === current.id
    && imported.name === current.name
    && imported.role === current.role
    && imported.registeredAt === current.registeredAt
    && imported.capabilities.length === current.capabilities.length
    && imported.capabilities.every(
      (capability, index) => capability === current.capabilities[index],
    )
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxImportBytes,
    files: 1,
    fields: 0,
    parts: 2,
  },
  fileFilter: (_request, file, callback) => {
    if (file.mimetype !== 'application/json') {
      callback(importInvalid())
      return
    }
    callback(null, true)
  },
})

const singleImportUpload = upload.single('file')
const expectedMultipartErrors = new Set([
  'Malformed content type',
  'Malformed part header',
  'Multipart: Boundary not found',
  'Unexpected end of file',
  'Unexpected end of form',
])

function expectedMultipartError(error: unknown): boolean {
  return error instanceof Error
    && (
      expectedMultipartErrors.has(error.message)
      || error.message.startsWith('Unsupported content type:')
    )
}

const parseImportUpload: RequestHandler = (request, response, next) => {
  singleImportUpload(request, response, (error) => {
    if (
      error === undefined
      || error instanceof multer.MulterError
      || error instanceof DomainError
    ) {
      next(error)
      return
    }
    next(expectedMultipartError(error) ? importInvalid() : error)
  })
}

function parseUpload(file: Express.Multer.File | undefined): unknown {
  if (file === undefined || file.size === 0) {
    throw importInvalid()
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(file.buffer)
    return JSON.parse(text) as unknown
  } catch {
    throw importInvalid()
  }
}

export const dataTransferRoutes: AppRouteModule = {
  register(router: Router, getContext) {
    router.get('/export', (_request, response) => {
      const context = getContext()
      const document = callService(
        exportDocumentSchema,
        () => context.services.exports.exportJson(),
      )
      sendSuccess(response, document)
    })

    router.post(
      '/import',
      parseImportUpload,
      (request, response) => {
        const document = parseUpload(request.file)
        const parsed = exportDocumentSchema.safeParse(document)
        if (!parsed.success) {
          throw importInvalid()
        }
        const context = getContext()
        const actorId = requestActorId(context)
        const currentActor = callService(
          persistedActorSchema,
          () => context.services.actors.get(actorId),
        )
        const importedActor = parsed.data.actors.find(
          ({ id }) => id === actorId,
        )
        if (!sameLocalActorIdentity(currentActor, importedActor)) {
          throw importInvalid()
        }
        internalOperation(() => context.services.exports.importJson(
          document,
          actorId,
          'web',
        ))
        const counts = parseResponse(importCountsSchema, {
          ok: true,
          counts: {
            actors: parsed.data.actors.length,
            projects: parsed.data.projects.length,
            projectMembers: parsed.data.projectMembers.length,
            tasks: parsed.data.tasks.length,
            requirements: parsed.data.requirements.length,
            defects: parsed.data.defects.length,
          },
        })
        sendSuccess(response, counts)
      },
    )
  },
}
