import { describe, expect, it } from 'vitest'

import { createMockProjectRepository } from './mock-project-repository'

describe('mock project repository', () => {
  it('returns the approved dashboard metrics and ordered risk/activity data', async () => {
    const repository = createMockProjectRepository()

    const dashboard = await repository.getDashboard('atlas', 7)

    expect(dashboard.metrics.totalTasks).toBe(50)
    expect(dashboard.risks[0]?.level).toBe('critical')
    expect(dashboard.activities[0]?.actor.kind).toBe('agent')
  })

  it('selects the exact deterministic trend for each dashboard range', async () => {
    const repository = createMockProjectRepository()

    const thirtyDay = await repository.getDashboard('atlas', 30)
    const ninetyDay = await repository.getDashboard('atlas', 90)

    expect(thirtyDay.trend).toEqual([
      { date: '6/30', actual: 3, planned: 4 },
      { date: '7/7', actual: 6, planned: 9 },
      { date: '7/14', actual: 11, planned: 15 },
      { date: '7/21', actual: 18, planned: 23 },
      { date: '7/28', actual: 34, planned: 40 },
    ])
    expect(ninetyDay.trend.at(-1)).toEqual({
      date: '7/28',
      actual: 118,
      planned: 114,
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
    expect(dashboard.activities[0]?.message).toContain('80%')
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
