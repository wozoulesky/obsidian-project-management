import {
  createProjectInputSchema,
  persistedProjectMemberSchema,
  persistedProjectSchema,
  projectStatusSchema,
} from '@project-os/contracts'
import type { Router } from 'express'
import { DomainError } from '@project-os/core'
import type {
  CreateProjectServiceInput,
  ProjectListFilter,
  UpdateProjectInput,
} from '@project-os/core'
import { z } from 'zod'
import type { AppRouteModule } from '../app.js'
import {
  cursorError,
  paginate,
  parseResponse,
  readCursorPosition,
  requestActorId,
  routeIdSchema,
  routeVersionSchema,
  sendSuccess,
} from './actors.js'

const limitQuerySchema = z.string()
  .regex(/^[1-9]\d{0,2}$/)
  .transform(Number)
  .pipe(z.number().int().min(1).max(200))
  .default(50)

const projectIdParamsSchema = z.object({
  id: routeIdSchema,
}).strict()

const projectListQuerySchema = z.object({
  owner_id: routeIdSchema.optional(),
  status: projectStatusSchema.optional(),
  limit: limitQuerySchema,
  cursor: z.string().min(1).max(4096).optional(),
}).strict()

const createProjectBodySchema = createProjectInputSchema.extend({
  name: z.string().min(1).max(200),
  description: z.string().max(10_000).optional().default(''),
  startDate: z.iso.date().nullable().optional().default(null),
  dueDate: z.iso.date().nullable().optional().default(null),
}).strict()

const updateProjectBodySchema = persistedProjectSchema.pick({
  name: true,
  description: true,
  ownerId: true,
  startDate: true,
  dueDate: true,
  status: true,
  progress: true,
}).partial().extend({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(10_000).optional(),
  version: routeVersionSchema,
}).strict()

const memberProjectParamsSchema = z.object({
  projectId: routeIdSchema,
}).strict()

const addMemberBodySchema = z.object({
  actorId: routeIdSchema,
}).strict()

type MemberRow = {
  project_id: string
  actor_id: string
  membership_role: 'owner' | 'member'
  joined_at: string
}

export const projectRoutes: AppRouteModule = {
  register(router: Router, getContext) {
    router.get('/projects', (request, response) => {
      const query = projectListQuerySchema.parse(request.query)
      const context = getContext()
      const filters = {
        ownerId: query.owner_id,
        status: query.status,
      }
      const cursorFilters = {
        owner_id: query.owner_id,
        status: query.status,
      }
      const position = readCursorPosition({
        scope: 'projects',
        filters: cursorFilters,
        cursor: query.cursor,
      })
      let after: ProjectListFilter['after']
      if (position !== undefined) {
        if (position.length !== 2) {
          throw cursorError(query.cursor!)
        }
        let anchor
        try {
          anchor = parseResponse(
            persistedProjectSchema,
            context.services.projects.get(position[1]!),
          )
        } catch (error) {
          if (
            error instanceof DomainError
            && error.code === 'PROJECT_NOT_FOUND'
          ) {
            throw cursorError(query.cursor!)
          }
          throw error
        }
        if (
          anchor.code !== position[0]
          || anchor.id !== position[1]
          || (
            query.owner_id !== undefined
            && anchor.ownerId !== query.owner_id
          )
          || (
            query.status !== undefined
            && anchor.status !== query.status
          )
        ) {
          throw cursorError(query.cursor!)
        }
        after = { code: anchor.code, id: anchor.id }
      }
      const fetchLimit = query.limit + 1
      const rawProjects = context.services.projects.list({
        ...filters,
        ...(after === undefined ? {} : { after }),
        limit: fetchLimit,
      } as ProjectListFilter)
      const projects = rawProjects.slice(0, fetchLimit).map(
        (project) => parseResponse(persistedProjectSchema, project),
      )
      const page = paginate(projects, {
        scope: 'projects',
        filters: cursorFilters,
        limit: query.limit,
        position: (project) => [project.code, project.id],
      })
      sendSuccess(response, page)
    })

    router.post('/projects', (request, response) => {
      const input = createProjectBodySchema.parse(request.body)
      const context = getContext()
      const project = context.services.projects.create(
        input as CreateProjectServiceInput,
        requestActorId(context),
        'web',
      )
      sendSuccess(response, parseResponse(persistedProjectSchema, project), 201)
    })

    router.get('/projects/:id', (request, response) => {
      const { id } = projectIdParamsSchema.parse(request.params)
      const project = getContext().services.projects.get(id)
      sendSuccess(response, parseResponse(persistedProjectSchema, project))
    })

    router.patch('/projects/:id', (request, response) => {
      const { id } = projectIdParamsSchema.parse(request.params)
      const input = updateProjectBodySchema.parse(request.body)
      const context = getContext()
      const project = context.services.projects.update(
        id,
        input as UpdateProjectInput,
        requestActorId(context),
        'web',
      )
      sendSuccess(response, parseResponse(persistedProjectSchema, project))
    })

    router.get('/projects/:projectId/members', (request, response) => {
      const { projectId } = memberProjectParamsSchema.parse(request.params)
      const context = getContext()
      parseResponse(
        persistedProjectSchema,
        context.services.projects.get(projectId),
      )
      const rows = context.database.prepare(`
        SELECT project_id, actor_id, membership_role, joined_at
        FROM project_members
        WHERE project_id = ?
        ORDER BY membership_role, joined_at, actor_id
      `).all(projectId) as unknown as MemberRow[]
      const items = rows.map((row) => parseResponse(
        persistedProjectMemberSchema,
        {
          projectId: row.project_id,
          actorId: row.actor_id,
          membershipRole: row.membership_role,
          joinedAt: row.joined_at,
        },
      ))
      sendSuccess(response, { items })
    })

    router.post('/projects/:projectId/members', (request, response) => {
      const { projectId } = memberProjectParamsSchema.parse(request.params)
      const { actorId } = addMemberBodySchema.parse(request.body)
      const context = getContext()
      const member = context.services.projects.addMember(
        projectId,
        actorId,
        requestActorId(context),
        'web',
      )
      sendSuccess(
        response,
        parseResponse(persistedProjectMemberSchema, member),
        201,
      )
    })
  },
}
