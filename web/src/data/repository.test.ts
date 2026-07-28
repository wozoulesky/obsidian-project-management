import { describe, expect, it } from 'vitest'

import { actors, defects, requirements, tasks } from './fixtures'
import { createMockProjectRepository } from './mock-project-repository'

describe('mock project repository', () => {
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
      linkedTaskIds: ['task-040', 'task-047', 'task-051', 'task-052'],
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
})
