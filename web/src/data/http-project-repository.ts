import {
  createProjectInputSchema,
  dashboardSnapshotSchema,
  persistedActivitySchema,
  persistedActorSchema,
  persistedAppSettingsSchema,
  persistedDefectSchema,
  persistedProjectSchema,
  persistedRequirementSchema,
  persistedTaskSchema,
} from '@project-os/contracts'
import { z } from 'zod'

import { ApiClient, ApiError } from './api-client'
import type {
  ActivityListInput,
  ActivityPage,
  ProjectRepository,
} from './project-repository'

const cursorPageSchema = <Output>(itemSchema: z.ZodType<Output>) =>
  z.object({
    items: z.array(itemSchema),
    next_cursor: z.string().min(1).nullable(),
  }).strict()

function appendSearch(
  path: string,
  values: Record<string, string | number | undefined>,
): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) search.set(key, String(value))
  }
  const query = search.toString()
  return query === '' ? path : `${path}?${query}`
}

async function allPages<Output>(
  client: ApiClient,
  path: string,
  itemSchema: z.ZodType<Output>,
): Promise<Output[]> {
  const items: Output[] = []
  const cursors = new Set<string>()
  let cursor: string | undefined
  do {
    const page = await client.request(
      appendSearch(path, { limit: 200, cursor }),
      cursorPageSchema(itemSchema),
    )
    items.push(...page.items)
    if (
      page.next_cursor !== null
      && cursors.has(page.next_cursor)
    ) {
      throw new ApiError({
        code: 'API_PAGINATION_CURSOR_REPEATED',
        message: 'API pagination cursor was repeated',
        status: 200,
        details: { cursor: page.next_cursor },
      })
    }
    if (page.next_cursor !== null) cursors.add(page.next_cursor)
    cursor = page.next_cursor ?? undefined
  } while (cursor !== undefined)
  return items
}

function jsonBody(value: unknown): Pick<RequestInit, 'body' | 'headers'> {
  return {
    body: JSON.stringify(value),
    headers: { 'Content-Type': 'application/json' },
  }
}

export function createHttpProjectRepository(
  client = new ApiClient('/api/v1'),
): ProjectRepository {
  const getTask = (taskId: string) =>
    client.request(
      `/tasks/${encodeURIComponent(taskId)}`,
      persistedTaskSchema,
    )
  const getRequirement = (requirementId: string) =>
    client.request(
      `/requirements/${encodeURIComponent(requirementId)}`,
      persistedRequirementSchema,
    )
  const getDefect = (defectId: string) =>
    client.request(
      `/defects/${encodeURIComponent(defectId)}`,
      persistedDefectSchema,
    )

  return {
    listActors: () => allPages(client, '/actors', persistedActorSchema),
    listProjects: () =>
      allPages(client, '/projects', persistedProjectSchema),
    createProject(input) {
      const body = createProjectInputSchema.strict().parse(input)
      return client.request('/projects', persistedProjectSchema, {
        method: 'POST',
        ...jsonBody(body),
      })
    },

    getDashboard(projectId, days = 30) {
      return client.request(
        appendSearch('/dashboard', {
          project_id: projectId,
          days,
        }),
        dashboardSnapshotSchema,
      )
    },

    listTasks(projectId) {
      return allPages(
        client,
        `/projects/${encodeURIComponent(projectId)}/tasks`,
        persistedTaskSchema,
      )
    },

    async updateTaskProgress(taskId, input) {
      const version = input.version ?? (await getTask(taskId)).version
      return client.request(
        `/tasks/${encodeURIComponent(taskId)}/progress`,
        persistedTaskSchema,
        {
          method: 'POST',
          ...jsonBody({ ...input, version }),
        },
      )
    },

    async updateTaskDates(taskId, input) {
      const version = input.version ?? (await getTask(taskId)).version
      return client.request(
        `/tasks/${encodeURIComponent(taskId)}`,
        persistedTaskSchema,
        {
          method: 'PATCH',
          ...jsonBody({ ...input, version }),
        },
      )
    },

    listRequirements(projectId) {
      return allPages(
        client,
        `/projects/${encodeURIComponent(projectId)}/requirements`,
        persistedRequirementSchema,
      )
    },

    async updateRequirementStatus(requirementId, status) {
      const requirement = await getRequirement(requirementId)
      return client.request(
        `/requirements/${encodeURIComponent(requirementId)}`,
        persistedRequirementSchema,
        {
          method: 'PATCH',
          ...jsonBody({ status, version: requirement.version }),
        },
      )
    },

    listDefects(projectId) {
      return allPages(
        client,
        `/projects/${encodeURIComponent(projectId)}/defects`,
        persistedDefectSchema,
      )
    },

    async createTaskFromDefect(defectId) {
      const defect = await getDefect(defectId)
      const today = new Date().toISOString().slice(0, 10)
      return client.request(
        `/defects/${encodeURIComponent(defectId)}/to-task`,
        persistedTaskSchema,
        {
          method: 'POST',
          ...jsonBody({
            startDate: today,
            dueDate: today,
            version: defect.version,
          }),
        },
      )
    },

    listGanttTasks(projectId) {
      return this.listTasks(projectId)
    },

    async listActivities(
      input: ActivityListInput = {},
    ): Promise<ActivityPage> {
      const page = await client.request(
        appendSearch('/activities', {
          limit: 200,
          after: input.after,
          project_id: input.projectId,
        }),
        cursorPageSchema(persistedActivitySchema),
      )
      return { items: page.items, nextCursor: page.next_cursor }
    },

    getSettings() {
      return client.request('/settings', persistedAppSettingsSchema)
    },
  }
}

export const httpProjectRepository = createHttpProjectRepository()
