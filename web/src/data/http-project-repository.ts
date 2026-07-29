import {
  createProjectInputSchema,
  dashboardSnapshotSchema,
  persistedActivitySchema,
  persistedActorSchema,
  persistedAppSettingsSchema,
  persistedDefectSchema,
  persistedProjectMemberSchema,
  persistedProjectSchema,
  persistedRequirementSchema,
  persistedTaskSchema,
  themeSchema,
  backgroundSchema,
  accentSchema,
  densitySchema,
} from '@project-os/contracts'
import { z } from 'zod'

import { ApiClient, ApiError } from './api-client'
import type {
  ActivityListInput,
  ActivityPage,
  ProjectRepository,
  SkillConfigClient,
} from './project-repository'
import {
  createHumanActorInputSchema,
  createProjectTaskInputSchema,
  updateActorInputSchema,
} from './project-repository'

const cursorPageSchema = <Output>(itemSchema: z.ZodType<Output>) =>
  z.object({
    items: z.array(itemSchema),
    next_cursor: z.string().min(1).nullable(),
  }).strict()

const healthSchema = z.object({
  status: z.literal('ok'),
  database: z.literal('ok'),
}).strict()
const tokenSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.iso.datetime({ offset: false }),
  lastUsedAt: z.iso.datetime({ offset: false }).nullable(),
  revokedAt: z.iso.datetime({ offset: false }).nullable(),
  version: z.number().int().positive(),
}).strict()
const issuedTokenSchema = tokenSchema.extend({
  token: z.string().min(1),
}).strict()
const backupSchema = z.object({
  filename: z.string().regex(/^[A-Za-z0-9._-]+\.sqlite$/),
  path: z.string().min(1),
}).strict()
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
const skillConfigClientSchema = z.enum([
  'codex',
  'claude-code',
  'kimi-code',
])
const skillConfigSnippetSchema = z.object({
  client: skillConfigClientSchema,
  transport: z.literal('stdio'),
  snippet: z.string().min(1),
}).strict()
const settingsUpdateSchema = z.object({
  theme: themeSchema,
  background: backgroundSchema,
  accent: accentSchema,
  density: densitySchema,
  version: z.number().int().positive(),
}).strict()
const safeBackupFilenameSchema = z.string()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9._-]+\.sqlite$/)

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
    createHuman(input) {
      const body = createHumanActorInputSchema.parse(input)
      return client.request('/actors', persistedActorSchema, {
        method: 'POST',
        ...jsonBody(body),
      })
    },
    updateActor(actorId, input) {
      const body = updateActorInputSchema.parse(input)
      return client.request(
        `/actors/${encodeURIComponent(actorId)}`,
        persistedActorSchema,
        {
          method: 'PATCH',
          ...jsonBody(body),
        },
      )
    },
    deactivateActor(actorId, version) {
      const body = z.object({
        version: z.number().int().positive(),
      }).strict().parse({ version })
      return client.request(
        `/actors/${encodeURIComponent(actorId)}/deactivate`,
        persistedActorSchema,
        {
          method: 'POST',
          ...jsonBody(body),
        },
      )
    },
    listProjects: () =>
      allPages(client, '/projects', persistedProjectSchema),
    getProject(projectId) {
      return client.request(
        `/projects/${encodeURIComponent(projectId)}`,
        persistedProjectSchema,
      )
    },
    async listProjectMembers(projectId) {
      const response = await client.request(
        `/projects/${encodeURIComponent(projectId)}/members`,
        z.object({
          items: z.array(persistedProjectMemberSchema),
        }).strict(),
      )
      return response.items
    },
    createProject(input) {
      const body = createProjectInputSchema.strict().parse(input)
      return client.request('/projects', persistedProjectSchema, {
        method: 'POST',
        ...jsonBody(body),
      })
    },
    async createTask(projectId, input) {
      const body = createProjectTaskInputSchema.parse(input)
      return await client.request(
        `/projects/${encodeURIComponent(projectId)}/tasks`,
        persistedTaskSchema,
        {
          method: 'POST',
          ...jsonBody(body),
        },
      )
    },
    listAllTasks: () => allPages(client, '/tasks', persistedTaskSchema),

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
    updateSettings(input) {
      return client.request('/settings', persistedAppSettingsSchema, {
        method: 'PATCH',
        ...jsonBody(settingsUpdateSchema.parse(input)),
      })
    },
    getHealth() {
      return client.request('/health', healthSchema)
    },
    listTokens() {
      return client.request('/tokens', z.array(tokenSchema))
    },
    issueToken(name) {
      return client.request('/tokens', issuedTokenSchema, {
        method: 'POST',
        ...jsonBody(z.object({
          name: z.string().trim().min(1).max(200),
        }).parse({ name })),
      })
    },
    revokeToken(tokenId, version) {
      return client.request(
        `/tokens/${encodeURIComponent(tokenId)}/revoke`,
        tokenSchema,
        {
          method: 'POST',
          ...jsonBody({ version: z.number().int().positive().parse(version) }),
        },
      )
    },
    createBackup(filename) {
      const body = filename === undefined
        ? {}
        : { filename: safeBackupFilenameSchema.parse(filename) }
      return client.request('/backups', backupSchema, {
        method: 'POST',
        ...jsonBody(body),
      })
    },
    restoreBackup(filename) {
      return client.request('/backups/restore', backupSchema, {
        method: 'POST',
        ...jsonBody({ filename: safeBackupFilenameSchema.parse(filename) }),
      })
    },
    exportData() {
      return client.request('/export', z.unknown())
    },
    importData(file) {
      const form = new FormData()
      form.append('file', file)
      return client.request('/import', importCountsSchema, {
        method: 'POST',
        body: form,
      })
    },
    downloadSkill() {
      return client.download('/skills/project-os.zip')
    },
    getSkillConfigSnippet(configClient: SkillConfigClient) {
      const selected = skillConfigClientSchema.parse(configClient)
      return client.request(
        `/skills/project-os/config-snippets/${
          encodeURIComponent(selected)
        }`,
        skillConfigSnippetSchema,
      )
    },
  }
}

export const httpProjectRepository = createHttpProjectRepository()
