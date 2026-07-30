import type { PersistedAppSettings } from '@project-os/contracts'
import type {
  ActivityEvent,
  Actor,
  CreateProjectInput,
  DashboardSnapshot,
  Project,
  ProjectMember,
  Requirement,
  RequirementStatus,
  Task,
  TaskDateInput,
  TaskProgressInput,
} from './domain'
import { createFixtureSeed } from './fixtures'
import {
  createHumanActorInputSchema,
  createProjectTaskInputSchema,
  type ProjectRepository,
  updateActorInputSchema,
} from './project-repository'

const clone = <T>(value: T): T => structuredClone(value)
const inactiveDefectStatuses = new Set([
  'closed',
  'rejected',
  'not_a_defect',
])

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }
  const timestamp = Date.parse(`${value}T00:00:00Z`)
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === value
  )
}

export function createMockProjectRepository(): ProjectRepository {
  const seed = createFixtureSeed()
  const taskState = seed.tasks
  const requirementState = seed.requirements
  const defectState = seed.defects
  const activityState = seed.activities
  const sessionState = seed.sessions
  const handoffState = seed.handoffs
  const deliverableState = seed.deliverables
  const projectState: Project[] = [{
    id: 'atlas',
    code: 'ATLAS',
    name: 'Atlas',
    description: '',
    ownerId: seed.actors.lin?.id ?? Object.values(seed.actors)[0]!.id,
    startDate: '2026-07-01',
    dueDate: '2026-08-31',
    status: 'in_progress',
    progress: 62,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-28T04:00:00.000Z',
    version: 1,
  }]
  const settingsState: PersistedAppSettings = {
    theme: 'system',
    background: 'soft',
    accent: 'blue',
    density: 'comfortable',
    updatedAt: '2026-07-28T04:00:00.000Z',
    version: 1,
  }
  const tokenState: Array<{
    id: string
    name: string
    createdAt: string
    lastUsedAt: string | null
    revokedAt: string | null
    version: number
  }> = []
  let backupSequence = 0
  const actorState: Actor[] = Object.values(seed.actors).map((actor) => ({
    ...actor,
    status: actor.status ?? 'active',
  }))
  const memberState: ProjectMember[] = actorState.map((actor) => ({
    projectId: 'atlas',
    actorId: actor.id,
    membershipRole:
      actor.id === projectState[0]!.ownerId ? 'owner' : 'member',
    joinedAt: '2026-07-01T00:00:00.000Z',
  }))
  let activitySequence = activityState.length

  const nextActivityId = () => {
    activitySequence += 1
    return `activity-${activitySequence}`
  }

  const getTask = (taskId: string): Task => {
    const task = taskState.find((candidate) => candidate.id === taskId)
    if (!task) {
      throw new Error(`Task not found: ${taskId}`)
    }
    return task
  }
  const getActor = (actorId: string): Actor => {
    const actor = actorState.find(({ id }) => id === actorId)
    if (!actor) throw new Error(`Actor not found: ${actorId}`)
    return actor
  }
  const deriveRequirementProgress = (
    requirement: Requirement,
  ): Requirement => ({
    ...requirement,
    completedTaskCount: requirement.linkedTaskIds.filter(
      (taskId) => taskState.find((task) => task.id === taskId)?.status === 'done',
    ).length,
  })

  return {
    async listActors() {
      return clone(actorState)
    },

    async createHuman(input) {
      const validated = createHumanActorInputSchema.parse(input)
      const now = new Date().toISOString()
      const actor: Actor = {
        id: `human-${actorState.length + 1}`,
        name: validated.name,
        kind: 'human',
        role: validated.role,
        status: 'active',
        client: null,
        capabilities: validated.capabilities ?? [],
        registeredAt: now,
        lastActiveAt: null,
        version: 1,
      }
      actorState.push(actor)
      return clone(actor)
    },

    async updateActor(actorId, input) {
      const actor = getActor(actorId)
      const validated = updateActorInputSchema.parse(input)
      if (actor.kind !== 'human') {
        throw new Error('Agent profile changes happen through MCP')
      }
      if (actor.version !== validated.version) {
        throw new Error('Actor version is stale')
      }
      if (validated.name !== undefined) actor.name = validated.name
      if (validated.role !== undefined) actor.role = validated.role
      if (validated.capabilities !== undefined) {
        actor.capabilities = validated.capabilities
      }
      actor.version += 1
      return clone(actor)
    },

    async deactivateActor(actorId, version) {
      const actor = getActor(actorId)
      if (actor.version !== version) throw new Error('Actor version is stale')
      actor.status = 'inactive'
      actor.version += 1
      return clone(actor)
    },

    async listProjects() {
      return clone(projectState)
    },

    async getProject(projectId) {
      const project = projectState.find(({ id }) => id === projectId)
      if (!project) throw new Error(`Project not found: ${projectId}`)
      return clone(project)
    },

    async listProjectMembers(projectId) {
      return clone(
        memberState.filter((member) => member.projectId === projectId),
      )
    },

    async listProjectSessions(projectId) {
      return clone(
        sessionState.filter((session) => session.projectId === projectId),
      )
    },

    async listProjectHandoffs(projectId) {
      return clone(
        handoffState.filter((handoff) => handoff.projectId === projectId),
      )
    },

    async listProjectDeliverables(projectId) {
      return clone(
        deliverableState.filter(
          (deliverable) => deliverable.projectId === projectId,
        ),
      )
    },

    async createProject(input: CreateProjectInput) {
      const now = new Date().toISOString()
      const sequence = projectState.length + 1
      const project: Project = {
        ...clone(input),
        id: `project-${sequence}`,
        code: `PRJ-${String(sequence).padStart(3, '0')}`,
        status: 'not_started',
        progress: 0,
        createdAt: now,
        updatedAt: now,
        version: 1,
      }
      projectState.push(project)
      memberState.push({
        projectId: project.id,
        actorId: project.ownerId,
        membershipRole: 'owner',
        joinedAt: now,
      })
      return clone(project)
    },

    async createTask(projectId, input) {
      if (!projectState.some(({ id }) => id === projectId)) {
        throw new Error(`Project not found: ${projectId}`)
      }
      const validated = createProjectTaskInputSchema.parse(input)
      const actor = getActor(validated.assigneeId)
      if (
        actor.status !== 'active'
        || !memberState.some(
          (member) =>
            member.projectId === projectId
            && member.actorId === actor.id,
        )
      ) {
        throw new Error('Task assignee must be an active project member')
      }
      const now = new Date().toISOString()
      const task: Task = {
        id: `task-${taskState.length + 1}`,
        code: `TASK-${String(taskState.length + 1).padStart(3, '0')}`,
        projectId,
        title: validated.title,
        description: validated.description ?? '',
        assignee: actor,
        assigneeId: actor.id,
        startDate: validated.startDate,
        dueDate: validated.dueDate,
        priority: validated.priority,
        status: 'not_started',
        progress: 0,
        milestoneId: validated.milestoneId ?? '',
        dependencyIds: [],
        createdAt: now,
        updatedAt: now,
        version: 1,
      }
      taskState.push(task)
      return clone(task)
    },

    async listAllTasks() {
      return clone(taskState.map((task) => ({
        ...task,
        projectId: task.projectId ?? 'atlas',
        version: task.version ?? 1,
      })))
    },

    async getDashboard(projectId, days = 30): Promise<DashboardSnapshot> {
      void projectId
      const activeDefects = defectState.filter(
        (defect) => !inactiveDefectStatuses.has(defect.status),
      )
      const actorList = Object.values(seed.actors)
      const taskStatusCounts = taskState.reduce<
        DashboardSnapshot['taskStatusCounts']
      >(
        (counts, task) => {
          counts[task.status] += 1
          return counts
        },
        {
          not_started: 0,
          in_progress: 0,
          done: 0,
          overdue: 0,
        },
      )
      return clone({
        metrics: {
          totalTasks: taskState.length,
          completedTasks: taskState.filter((task) => task.status === 'done')
            .length,
          deliveredRequirements: requirementState.filter(
            (requirement) =>
              requirement.status === 'delivered' ||
              requirement.status === 'accepted',
          ).length,
          totalRequirements: requirementState.length,
          activeDefects: activeDefects.length,
          seriousDefects: activeDefects.filter(
            (defect) =>
              defect.severity === 'fatal' || defect.severity === 'serious',
          ).length,
          velocityPerWeek: 16.4,
          activeActors: actorList.length,
          activeAgents: actorList.filter((actor) => actor.kind === 'agent')
            .length,
        },
        taskStatusCounts,
        trend: seed.trendByDays[days],
        risks: seed.risks,
        activities: activityState,
      })
    },

    async listTasks(projectId) {
      return clone(
        taskState.filter((task) => (task.projectId ?? 'atlas') === projectId),
      )
    },

    async updateTaskProgress(taskId, input: TaskProgressInput) {
      const task = getTask(taskId)
      if (
        !Number.isFinite(input.progress) ||
        !Number.isInteger(input.progress) ||
        input.progress < 0 ||
        input.progress > 100
      ) {
        throw new Error('Progress must be an integer between 0 and 100')
      }

      task.progress = input.progress
      task.status = input.status
      const note = input.note.trim()
      const activity: ActivityEvent = {
        id: nextActivityId(),
        actor: task.assignee,
        action: `将「${task.title}」更新至 ${input.progress}%`,
        operation: 'task.update',
        createdAt: '2026-07-28T12:00:00+08:00',
        ...(note ? { note: input.note } : {}),
      }
      activityState.unshift(activity)

      return clone(task)
    },

    async updateTaskDates(taskId, input: TaskDateInput) {
      const task = getTask(taskId)
      if (
        !isIsoDate(input.startDate) ||
        !isIsoDate(input.dueDate) ||
        input.startDate > input.dueDate
      ) {
        throw new Error('Task dates are invalid')
      }

      task.startDate = input.startDate
      task.dueDate = input.dueDate
      const activity: ActivityEvent = {
        id: nextActivityId(),
        actor: task.assignee,
        action: `调整「${task.title}」排期至 ${input.startDate}–${input.dueDate}`,
        operation: 'task.schedule',
        createdAt: '2026-07-28T12:05:00+08:00',
      }
      activityState.unshift(activity)

      return clone(task)
    },

    async listRequirements(projectId) {
      void projectId
      return clone(requirementState.map(deriveRequirementProgress))
    },

    async updateRequirementStatus(
      requirementId,
      status: RequirementStatus,
    ) {
      const requirement = requirementState.find(
        (candidate) => candidate.id === requirementId,
      )
      if (!requirement) {
        throw new Error(`Requirement not found: ${requirementId}`)
      }
      requirement.status = status
      return clone(deriveRequirementProgress(requirement))
    },

    async listDefects(projectId) {
      void projectId
      return clone(defectState)
    },

    async createTaskFromDefect(defectId) {
      const defect = defectState.find((candidate) => candidate.id === defectId)
      if (!defect) {
        throw new Error(`Defect not found: ${defectId}`)
      }

      const taskId = `task-fix-${defectId}`
      const existingTask = taskState.find((task) => task.id === taskId)
      if (existingTask) {
        defect.linkedTaskId = taskId
        return clone(existingTask)
      }

      const task: Task = {
        id: taskId,
        code: `FIX-${defect.code}`,
        title: `修复：${defect.title}`,
        description: defect.reproductionSteps.join('\n'),
        assignee: defect.assignee,
        startDate: '2026-07-28',
        dueDate: '2026-07-30',
        priority: defect.severity === 'fatal' ? 'P0' : 'P1',
        status: 'not_started',
        progress: 0,
        milestoneId: 'm2',
        dependencyIds: [],
      }
      taskState.push(task)
      defect.linkedTaskId = taskId
      return clone(task)
    },

    async listGanttTasks(projectId) {
      void projectId
      return clone(taskState)
    },

    async listActivities({ after } = {}) {
      const cursorIndex = after === undefined
        ? -1
        : activityState.findIndex((activity) => activity.id === after)
      const items = after === undefined
        ? clone(activityState)
        : cursorIndex <= 0
          ? []
          : clone(activityState.slice(0, cursorIndex))
      return {
        items,
        nextCursor: activityState[0]?.id ?? after ?? null,
      }
    },

    async getSettings() {
      return clone(settingsState)
    },
    async updateSettings(input) {
      if (settingsState.version !== input.version) {
        throw new Error('Settings version is stale')
      }
      settingsState.theme = input.theme
      settingsState.background = input.background
      settingsState.accent = input.accent
      settingsState.density = input.density
      settingsState.updatedAt = new Date().toISOString()
      settingsState.version += 1
      return clone(settingsState)
    },
    async getHealth() {
      return { status: 'ok', database: 'ok' }
    },
    async listTokens() {
      return clone(tokenState)
    },
    async issueToken(name) {
      const now = new Date().toISOString()
      const metadata = {
        id: `token-${tokenState.length + 1}`,
        name: name.trim(),
        createdAt: now,
        lastUsedAt: null,
        revokedAt: null,
        version: 1,
      }
      tokenState.push(metadata)
      return {
        ...clone(metadata),
        token: `pos_${'a'.repeat(24)}_${'b'.repeat(43)}`,
      }
    },
    async revokeToken(tokenId, version) {
      const token = tokenState.find(({ id }) => id === tokenId)
      if (!token) throw new Error('Token not found')
      if (token.version !== version) throw new Error('Token version is stale')
      token.revokedAt = new Date().toISOString()
      token.version += 1
      return clone(token)
    },
    async createBackup(filename) {
      backupSequence += 1
      const safeFilename = filename
        ?? `project-os-test-${backupSequence}.sqlite`
      return {
        filename: safeFilename,
        path: `backups/${safeFilename}`,
      }
    },
    async restoreBackup(filename) {
      return { filename, path: `backups/${filename}` }
    },
    async exportData() {
      return {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        actors: clone(actorState),
        projects: clone(projectState),
        projectMembers: clone(memberState),
        tasks: clone(taskState),
        requirements: clone(requirementState),
        defects: clone(defectState),
        settings: clone(settingsState),
      }
    },
    async importData() {
      return {
        ok: true,
        counts: {
          actors: actorState.length,
          projects: projectState.length,
          projectMembers: memberState.length,
          tasks: taskState.length,
          requirements: requirementState.length,
          defects: defectState.length,
        },
      }
    },
    async downloadSkill() {
      return new Blob(['project-os-skill'], { type: 'application/zip' })
    },
    async getSkillConfigSnippet(client) {
      const root = 'E:/project_manage'
      const entry = `${root}/apps/mcp/dist/stdio.js`
      const database = `${root}/data/project_manage.db`
      const snippets = {
        codex: [
          '[mcp_servers.project-os]',
          'command = "node"',
          `args = ["${entry}"]`,
          `env = { PROJECT_OS_DB = "${database}" }`,
        ].join('\n'),
        'claude-code': [
          'claude mcp add --transport stdio',
          `--env PROJECT_OS_DB=${database}`,
          `project-os -- node ${entry}`,
        ].join(' '),
        'kimi-code': JSON.stringify({
          mcpServers: {
            'project-os': {
              command: 'node',
              args: [entry],
              env: { PROJECT_OS_DB: database },
            },
          },
        }, null, 2),
      }
      return {
        client,
        transport: 'stdio',
        snippet: snippets[client],
      }
    },
  }
}
