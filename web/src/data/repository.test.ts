import { describe, expect, it } from 'vitest'

import { actors, defects, requirements, tasks } from './fixtures'
import { createMockProjectRepository } from './mock-project-repository'

describe('mock project repository', () => {
  it('deletes a project and all seven kinds of owned rows only', async () => {
    const repository = createMockProjectRepository()
    const otherProject = await repository.createProject({
      name: 'Borealis',
      description: 'Release preparation',
      ownerId: actors.lin.id,
      startDate: null,
      dueDate: null,
    })
    const otherTask = await repository.createTask(otherProject.id, {
      title: 'Keep this task',
      assigneeId: actors.lin.id,
      startDate: '2026-08-01',
      dueDate: '2026-08-02',
      priority: 'P1',
    })
    const before = {
      project_members: (await repository.listProjectMembers('atlas')).length,
      tasks: (await repository.listTasks('atlas')).length,
      requirements: (await repository.listRequirements('atlas')).length,
      defects: (await repository.listDefects('atlas')).length,
      sessions: (await repository.listProjectSessions('atlas')).length,
      handoffs: (await repository.listProjectHandoffs('atlas')).length,
      deliverables: (await repository.listProjectDeliverables('atlas')).length,
    }
    expect(Object.values(before).every((count) => count > 0)).toBe(true)

    await expect(repository.deleteProject('atlas', 1)).resolves.toEqual({
      id: 'atlas',
      name: 'Atlas',
      deletedAt: '2026-07-28T12:00:00.000Z',
      deletedCounts: before,
    })

    await expect(repository.getProject('atlas')).rejects.toThrow(
      'Project not found: atlas',
    )
    await expect(repository.listProjectMembers('atlas')).resolves.toEqual([])
    await expect(repository.listTasks('atlas')).resolves.toEqual([])
    await expect(repository.listRequirements('atlas')).resolves.toEqual([])
    await expect(repository.listDefects('atlas')).resolves.toEqual([])
    await expect(repository.listProjectSessions('atlas')).resolves.toEqual([])
    await expect(repository.listProjectHandoffs('atlas')).resolves.toEqual([])
    await expect(repository.listProjectDeliverables('atlas')).resolves.toEqual(
      [],
    )
    await expect(repository.getProject(otherProject.id)).resolves.toEqual(
      otherProject,
    )
    await expect(repository.listProjectMembers(otherProject.id)).resolves
      .toContainEqual(expect.objectContaining({ projectId: otherProject.id }))
    await expect(repository.listTasks(otherProject.id)).resolves.toEqual([
      otherTask,
    ])
  })

  it('leaves all state unchanged when project deletion is stale or missing', async () => {
    const repository = createMockProjectRepository()
    const snapshot = async () => ({
      projects: await repository.listProjects(),
      members: await repository.listProjectMembers('atlas'),
      tasks: await repository.listTasks('atlas'),
      requirements: await repository.listRequirements('atlas'),
      defects: await repository.listDefects('atlas'),
      sessions: await repository.listProjectSessions('atlas'),
      handoffs: await repository.listProjectHandoffs('atlas'),
      deliverables: await repository.listProjectDeliverables('atlas'),
    })
    const before = await snapshot()

    await expect(repository.deleteProject('atlas', 2)).rejects.toThrow(
      'Project version is stale',
    )
    expect(await snapshot()).toEqual(before)
    await expect(repository.deleteProject('missing', 1)).rejects.toThrow(
      'Project not found: missing',
    )
    expect(await snapshot()).toEqual(before)
  })

  it('does not reuse a project id after an earlier project is deleted', async () => {
    const repository = createMockProjectRepository()
    const input = {
      name: 'Borealis',
      description: '',
      ownerId: actors.lin.id,
      startDate: null,
      dueDate: null,
    }
    const first = await repository.createProject(input)

    await repository.deleteProject('atlas', 1)
    const second = await repository.createProject({
      ...input,
      name: 'Cygnus',
    })

    expect(second.id).not.toBe(first.id)
    await expect(repository.listProjects()).resolves.toEqual([first, second])
  })

  it('starts a fresh mock workspace with the approved dark glass settings', async () => {
    const repository = createMockProjectRepository()

    await expect(repository.getSettings()).resolves.toMatchObject({
      theme: 'dark',
      background: 'soft',
      accent: 'teal',
      density: 'comfortable',
      version: 1,
    })
  })

  it('creates and lists a project with the shared nullable-date contract', async () => {
    const repository = createMockProjectRepository()

    const created = await repository.createProject({
      name: 'Borealis',
      description: '发布准备',
      ownerId: actors.lin.id,
      startDate: null,
      dueDate: null,
    })

    expect(created).toMatchObject({
      code: 'PRJ-002',
      name: 'Borealis',
      ownerId: actors.lin.id,
      startDate: null,
      dueDate: null,
      status: 'not_started',
      progress: 0,
    })
    await expect(repository.listProjects()).resolves.toContainEqual(created)
  })

  it('exposes global task records with their real project association', async () => {
    const repository = createMockProjectRepository()

    const allTasks = await repository.listAllTasks()

    expect(allTasks).toHaveLength(tasks.length)
    expect(allTasks.every((task) => task.projectId === 'atlas')).toBe(true)
    expect(
      allTasks.every(
        (task) => Number.isInteger(task.version) && (task.version ?? 0) > 0,
      ),
    ).toBe(true)
  })

  it('gets project membership and persists a project-scoped task', async () => {
    const repository = createMockProjectRepository()
    const project = await repository.getProject('atlas')
    const members = await repository.listProjectMembers(project.id)

    expect(members).toContainEqual(expect.objectContaining({
      actorId: project.ownerId,
      membershipRole: 'owner',
    }))

    const created = await repository.createTask(project.id, {
      title: 'Project detail task',
      assigneeId: project.ownerId,
      startDate: '2026-07-29',
      dueDate: '2026-07-30',
      priority: 'P1',
    })

    expect(created).toMatchObject({
      projectId: project.id,
      title: 'Project detail task',
      assigneeId: project.ownerId,
      status: 'not_started',
      progress: 0,
    })
    await expect(repository.listTasks(project.id)).resolves.toContainEqual(
      created,
    )
  })

  it('rejects unknown assignees and invalid task dates', async () => {
    const repository = createMockProjectRepository()
    const input = {
      title: 'Invalid assignment',
      assigneeId: actors.lin.id,
      startDate: '2026-07-31',
      dueDate: '2026-07-30',
      priority: 'P1' as const,
    }

    await expect(repository.createTask('atlas', input)).rejects.toThrow(
      'Task start date must not be after its due date',
    )
    await expect(repository.createTask('atlas', {
      ...input,
      startDate: '2026-07-29',
      assigneeId: 'not-a-member',
    })).rejects.toThrow('Actor not found: not-a-member')
  })

  it('keeps dashboard metrics derived from coherent fixture collections', async () => {
    const repository = createMockProjectRepository()

    const [dashboard, allTasks, allRequirements, allDefects] =
      await Promise.all([
        repository.getDashboard('atlas'),
        repository.listTasks('atlas'),
        repository.listRequirements('atlas'),
        repository.listDefects('atlas'),
      ])

    expect(allTasks).toHaveLength(50)
    expect(allTasks.filter((task) => task.status === 'done')).toHaveLength(34)
    expect(allRequirements).toHaveLength(20)
    expect(
      allRequirements.filter(
        (item) => item.status === 'delivered' || item.status === 'accepted',
      ),
    ).toHaveLength(14)
    expect(
      allRequirements.find((item) => item.id === 'req-013')
        ?.completedTaskCount,
    ).toBe(4)
    expect(allDefects).toHaveLength(7)
    expect(
      allDefects.filter(
        (defect) =>
          !['closed', 'rejected', 'not_a_defect'].includes(defect.status),
      ),
    ).toHaveLength(7)
    expect(
      allDefects.filter(
        (defect) =>
          defect.severity === 'fatal' || defect.severity === 'serious',
      ),
    ).toHaveLength(2)
    expect(dashboard.metrics).toEqual({
      totalTasks: allTasks.length,
      completedTasks: allTasks.filter((task) => task.status === 'done').length,
      deliveredRequirements: allRequirements.filter(
        (item) => item.status === 'delivered' || item.status === 'accepted',
      ).length,
      totalRequirements: allRequirements.length,
      activeDefects: allDefects.length,
      seriousDefects: allDefects.filter(
        (defect) =>
          defect.severity === 'fatal' || defect.severity === 'serious',
      ).length,
      velocityPerWeek: 16.4,
      activeActors: 6,
      activeAgents: 3,
    })
    expect(dashboard.metrics.deliveredRequirements).toBe(14)
  })

  it('exposes the same global fixture through the workspace dashboard', async () => {
    const repository = createMockProjectRepository()

    const [workspace, project] = await Promise.all([
      repository.getWorkspaceDashboard(7),
      repository.getDashboard('atlas', 7),
    ])

    expect(workspace).toEqual(project)
    expect(workspace.metrics.totalTasks).toBe(tasks.length)
  })

  it('returns the approved dashboard metrics and ordered risk/activity data', async () => {
    const repository = createMockProjectRepository()

    const dashboard = await repository.getDashboard('atlas', 7)

    expect(dashboard.metrics).toMatchObject({
      totalTasks: 50,
      completedTasks: 34,
      velocityPerWeek: 16.4,
    })
    expect(dashboard.risks[0]).toEqual({
      id: 'risk-task-047',
      entityType: 'task',
      entityId: 'task-047',
      title: '断线恢复测试',
      assignee: actors.dev,
      progress: 45,
      dueDate: '2026-07-26',
      level: 'critical',
    })
    expect(dashboard.activities[0]).toEqual({
      id: 'activity-1',
      actor: actors.dev,
      action: '将「SQLite WAL 支持」更新至 80%',
      operation: 'task.update',
      createdAt: '2026-07-28T10:40:00+08:00',
    })
  })

  it('derives a complete task status distribution for the dashboard', async () => {
    const repository = createMockProjectRepository()

    const dashboard = await repository.getDashboard('atlas')
    const statusTotal = Object.values(dashboard.taskStatusCounts).reduce(
      (total, count) => total + count,
      0,
    )

    expect(statusTotal).toBe(dashboard.metrics.totalTasks)
    expect(dashboard.taskStatusCounts.done).toBe(
      dashboard.metrics.completedTasks,
    )
  })

  it('re-derives dashboard status counts after a task status mutation', async () => {
    const repository = createMockProjectRepository()
    const before = await repository.getDashboard('atlas')

    expect(
      (await repository.listTasks('atlas')).find(
        (task) => task.id === 'task-051',
      )?.status,
    ).toBe('in_progress')

    await repository.updateTaskProgress('task-051', {
      progress: 100,
      status: 'done',
      note: '权限路径已完成',
    })

    const after = await repository.getDashboard('atlas')
    const statusTotal = Object.values(after.taskStatusCounts).reduce(
      (total, count) => total + count,
      0,
    )

    expect(after.taskStatusCounts.in_progress).toBe(
      before.taskStatusCounts.in_progress - 1,
    )
    expect(after.taskStatusCounts.done).toBe(
      before.taskStatusCounts.done + 1,
    )
    expect(after.taskStatusCounts.done).toBe(
      after.metrics.completedTasks,
    )
    expect(statusTotal).toBe(after.metrics.totalTasks)
  })

  it('selects the exact deterministic trend for each dashboard range', async () => {
    const repository = createMockProjectRepository()

    const thirtyDay = await repository.getDashboard('atlas', 30)
    const ninetyDay = await repository.getDashboard('atlas', 90)

    expect(thirtyDay.trend).toEqual([
      { date: '2026-06-30', actual: 3, planned: 4 },
      { date: '2026-07-07', actual: 6, planned: 9 },
      { date: '2026-07-14', actual: 11, planned: 15 },
      { date: '2026-07-21', actual: 18, planned: 23 },
      { date: '2026-07-28', actual: 34, planned: 40 },
    ])
    expect(ninetyDay.trend.at(-1)).toEqual({
      date: '2026-07-28',
      actual: 118,
      planned: 114,
    })
  })

  it('exports the named actors and exact prototype records', () => {
    expect(actors).toMatchObject({
      lin: { id: 'human-lin', name: 'Lin', kind: 'human' },
      chen: { id: 'human-chen', name: 'Chen', kind: 'human' },
      dev: {
        id: 'dev-agent-7f3a',
        name: 'dev-agent',
        kind: 'agent',
        role: 'dev-agent',
      },
      qa: {
        id: 'qa-agent-2b91',
        name: 'qa-agent',
        kind: 'agent',
        role: 'qa-agent',
      },
      pm: {
        id: 'pm-agent-18ce',
        name: 'pm-agent',
        kind: 'agent',
        role: 'pm-agent',
      },
      maya: { id: 'human-maya', name: 'Maya', kind: 'human' },
    })
    expect(tasks.find((task) => task.id === 'task-051')?.description).toBe(
      '服务端按 Agent 角色权限表拦截越权写操作，并返回明确错误信息。',
    )
    expect(requirements.find((item) => item.id === 'req-013')).toMatchObject({
      linkedTaskIds: ['task-040', 'task-042', 'task-043', 'task-052'],
      completedTaskCount: 4,
      acceptanceCriteria: [
        '重复注册返回已有身份',
        '所有写操作携带 agent_id',
      ],
    })
    expect(defects.find((defect) => defect.id === 'defect-104')).toMatchObject({
      updatedAt: '2026-07-28T10:34:00+08:00',
      reproductionSteps: [
        '断开 MCP 客户端',
        '重新启动客户端',
        '使用已有 agent_id 查询身份',
      ],
    })
  })

  it('persists task progress and prepends a matching activity', async () => {
    const repository = createMockProjectRepository()

    await repository.updateTaskProgress('task-051', {
      progress: 80,
      status: 'in_progress',
      note: '权限路径已验证',
    })

    const tasks = await repository.listTasks('atlas')
    const dashboard = await repository.getDashboard('atlas')
    expect(tasks.find((task) => task.id === 'task-051')?.progress).toBe(80)
    expect(dashboard.activities[0]?.action).toContain('80%')
    expect(dashboard.activities[0]?.note).toBe('权限路径已验证')
  })

  it('derives requirement completion from current linked task state', async () => {
    const repository = createMockProjectRepository()
    const linkedTaskIds = ['task-040', 'task-042', 'task-043', 'task-052']
    const initialTasks = await repository.listTasks('atlas')
    const initialRequirement = (await repository.listRequirements('atlas'))
      .find((item) => item.id === 'req-013')

    expect(initialRequirement?.linkedTaskIds).toEqual(linkedTaskIds)
    expect(
      initialTasks
        .filter((task) => linkedTaskIds.includes(task.id))
        .every((task) => task.status === 'done'),
    ).toBe(true)
    expect(initialRequirement?.completedTaskCount).toBe(4)

    await repository.updateTaskProgress('task-043', {
      progress: 75,
      status: 'in_progress',
      note: '',
    })
    expect(
      (await repository.listRequirements('atlas'))
        .find((item) => item.id === 'req-013')
        ?.completedTaskCount,
    ).toBe(3)

    await repository.updateTaskProgress('task-043', {
      progress: 100,
      status: 'done',
      note: '',
    })
    expect(
      (await repository.listRequirements('atlas'))
        .find((item) => item.id === 'req-013')
        ?.completedTaskCount,
    ).toBe(4)
  })

  it('persists updated task dates', async () => {
    const repository = createMockProjectRepository()

    await repository.updateTaskDates('task-051', {
      startDate: '2026-07-24',
      dueDate: '2026-07-29',
    })

    const tasks = await repository.listTasks('atlas')
    expect(tasks.find((task) => task.id === 'task-051')?.dueDate).toBe(
      '2026-07-29',
    )
  })

  it('creates one deterministic repair task for a defect', async () => {
    const repository = createMockProjectRepository()

    const first = await repository.createTaskFromDefect('defect-104')
    const second = await repository.createTaskFromDefect('defect-104')
    const tasks = await repository.listTasks('atlas')

    expect(first.title).toBe('修复：离线恢复失败')
    expect(second.id).toBe(first.id)
    expect(
      tasks.filter((task) => task.id === 'task-fix-defect-104'),
    ).toHaveLength(1)
    expect(
      (await repository.listDefects('atlas')).find(
        (defect) => defect.id === 'defect-104',
      )?.linkedTaskId,
    ).toBe('task-fix-defect-104')
  })

  it('rejects invalid task inputs without changing state or activity', async () => {
    const repository = createMockProjectRepository()
    const originalTask = (await repository.listTasks('atlas')).find(
      (task) => task.id === 'task-051',
    )
    const originalActivityCount = (await repository.getDashboard('atlas'))
      .activities.length

    for (const progress of [-1, 101, 1.5, Number.NaN]) {
      await expect(
        repository.updateTaskProgress('task-051', {
          progress,
          status: 'in_progress',
          note: 'must not persist',
        }),
      ).rejects.toThrow('Progress must be an integer between 0 and 100')
    }
    for (const dates of [
      { startDate: '2026/07/24', dueDate: '2026-07-29' },
      { startDate: '2026-07-30', dueDate: '2026-07-29' },
      { startDate: '2026-02-30', dueDate: '2026-03-01' },
    ]) {
      await expect(
        repository.updateTaskDates('task-051', dates),
      ).rejects.toThrow('Task dates are invalid')
    }

    const currentTask = (await repository.listTasks('atlas')).find(
      (task) => task.id === 'task-051',
    )
    expect(currentTask).toEqual(originalTask)
    expect((await repository.getDashboard('atlas')).activities).toHaveLength(
      originalActivityCount,
    )
  })

  it('uses unique deterministic activity IDs for repeated mutations', async () => {
    const repository = createMockProjectRepository()
    const input = {
      progress: 80,
      status: 'in_progress' as const,
      note: '',
    }

    await repository.updateTaskProgress('task-051', input)
    await repository.updateTaskProgress('task-051', input)

    const [first, second] = (await repository.getDashboard('atlas')).activities
    expect(first?.id).not.toBe(second?.id)
  })

  it('rejects missing task, requirement, and defect operations precisely', async () => {
    const repository = createMockProjectRepository()

    await expect(
      repository.updateTaskProgress('missing-task', {
        progress: 50,
        status: 'in_progress',
        note: '',
      }),
    ).rejects.toThrow('Task not found: missing-task')
    await expect(
      repository.updateTaskDates('missing-task', {
        startDate: '2026-07-28',
        dueDate: '2026-07-29',
      }),
    ).rejects.toThrow('Task not found: missing-task')
    await expect(
      repository.updateRequirementStatus('missing-requirement', 'reviewed'),
    ).rejects.toThrow('Requirement not found: missing-requirement')
    await expect(
      repository.createTaskFromDefect('missing-defect'),
    ).rejects.toThrow('Defect not found: missing-defect')
  })

  it('returns cloned arrays that callers cannot use to mutate state', async () => {
    const repository = createMockProjectRepository()
    const firstTasks = await repository.listTasks('atlas')
    const firstRequirements = await repository.listRequirements('atlas')

    const firstTask = firstTasks[0]
    const firstRequirement = firstRequirements[0]
    if (!firstTask || !firstRequirement) {
      throw new Error('Expected deterministic fixtures')
    }
    firstTask.title = 'caller mutation'
    firstRequirement.linkedTaskIds.push('caller-task')

    const secondTasks = await repository.listTasks('atlas')
    const secondRequirements = await repository.listRequirements('atlas')
    expect(secondTasks[0]?.title).not.toBe('caller mutation')
    expect(secondRequirements[0]?.linkedTaskIds).not.toContain('caller-task')
  })

  it('clones dashboard, defects, and gantt results at every boundary', async () => {
    const repository = createMockProjectRepository()
    const dashboard = await repository.getDashboard('atlas')
    const defectList = await repository.listDefects('atlas')
    const gantt = await repository.listGanttTasks('atlas')

    dashboard.activities[0]!.action = 'caller mutation'
    dashboard.risks[0]!.assignee.name = 'caller mutation'
    defectList[0]!.reproductionSteps.push('caller mutation')
    gantt[0]!.dependencyIds.push('caller mutation')

    const freshDashboard = await repository.getDashboard('atlas')
    const freshDefects = await repository.listDefects('atlas')
    const freshGantt = await repository.listGanttTasks('atlas')
    expect(freshDashboard.activities[0]?.action).not.toBe('caller mutation')
    expect(freshDashboard.risks[0]?.assignee.name).not.toBe('caller mutation')
    expect(freshDefects[0]?.reproductionSteps).not.toContain('caller mutation')
    expect(freshGantt[0]?.dependencyIds).not.toContain('caller mutation')
  })

  it('isolates repository instances from mutations and exported fixtures', async () => {
    const firstRepository = createMockProjectRepository()
    await firstRepository.updateTaskProgress('task-051', {
      progress: 99,
      status: 'in_progress',
      note: '',
    })

    const fixtureTask = tasks[0]
    if (!fixtureTask) {
      throw new Error('Expected a fixture task')
    }
    const originalTitle = fixtureTask.title
    expect(() => {
      fixtureTask.title = 'export contamination'
    }).toThrow()
    const secondRepository = createMockProjectRepository()

    const secondTasks = await secondRepository.listTasks('atlas')
    expect(secondTasks.find((task) => task.id === 'task-051')?.progress).toBe(62)
    expect(secondTasks[0]?.title).toBe(originalTitle)
  })
})
