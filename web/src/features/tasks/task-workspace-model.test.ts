import { describe, expect, expectTypeOf, it } from 'vitest'

import type { Task } from '../../data/domain'
import { createFixtureSeed } from '../../data/fixtures'
import {
  parseTaskView,
  taskInsights,
  taskStatusLabels,
  taskStatuses,
  taskViews,
} from './task-workspace-model'

const TODAY = '2026-08-03'

function fixtureTask(overrides: Partial<Task> = {}): Task {
  const fixture = createFixtureSeed().tasks.find(({ id }) => id === 'task-068')
  if (!fixture) throw new Error('expected task-068 fixture')
  return {
    ...fixture,
    assigneeId: fixture.assignee.id,
    dependencyIds: [],
    dueDate: '2026-08-10',
    progress: 50,
    status: 'in_progress',
    ...overrides,
  }
}

function malformedUnassignedTask(overrides: Partial<Task> = {}): Task {
  // Defensive boundary coverage for malformed/legacy input missing both fields.
  const task: Partial<Task> = fixtureTask(overrides)
  delete task.assignee
  delete task.assigneeId
  return task as Task
}

describe('task workspace views', () => {
  it('defines every supported view in stable order', () => {
    expect(taskViews).toEqual(['fan', 'board', 'timeline'])
  })

  it.each(taskViews)('parses the %s view', (view) => {
    expect(parseTaskView(view)).toBe(view)
  })

  it.each([null, undefined, '', 'unknown', 'Fan', 1, {}])(
    'falls back to fan for unsupported input %j',
    (value) => {
      expect(parseTaskView(value)).toBe('fan')
    },
  )
})

describe('task workspace statuses', () => {
  it('exposes statuses as a readonly tuple', () => {
    expectTypeOf(taskStatuses).toEqualTypeOf<readonly [
      'not_started',
      'in_progress',
      'done',
      'overdue',
    ]>()
  })

  it('defines statuses and Chinese labels in stable order', () => {
    expect(taskStatuses).toEqual([
      'not_started',
      'in_progress',
      'done',
      'overdue',
    ])
    expect(taskStatuses.map((status) => taskStatusLabels[status])).toEqual([
      '未开始',
      '进行中',
      '已完成',
      '已逾期',
    ])
  })
})

describe('taskInsights', () => {
  it('reports an explicit overdue status once even when its date is overdue', () => {
    expect(taskInsights(fixtureTask({
      dueDate: '2026-08-01',
      status: 'overdue',
    }), TODAY)).toEqual([
      '任务已逾期，请重新确认交付时间。',
    ])
  })

  it('reports an unfinished task whose due date has passed', () => {
    expect(taskInsights(fixtureTask({ dueDate: '2026-08-02' }), TODAY)).toEqual([
      '任务已逾期，请重新确认交付时间。',
    ])
  })

  it.each([
    ['2026-08-03', 0],
    ['2026-08-04', 1],
    ['2026-08-05', 2],
  ])('reports low progress when due in %i days', (dueDate) => {
    expect(taskInsights(fixtureTask({ dueDate, progress: 29 }), TODAY)).toEqual([
      '临近截止日期且进度偏低。',
    ])
  })

  it('does not report low progress when due in three days', () => {
    expect(taskInsights(fixtureTask({
      dueDate: '2026-08-06',
      progress: 29,
    }), TODAY)).toEqual([
      '当前任务未发现明确风险。',
    ])
  })

  it('does not report overdue or low-progress date risks for done tasks', () => {
    expect(taskInsights(fixtureTask({
      dueDate: '2026-08-01',
      progress: 0,
      status: 'done',
    }), TODAY)).toEqual([
      '当前任务未发现明确风险。',
    ])
    expect(taskInsights(fixtureTask({
      dueDate: TODAY,
      progress: 0,
      status: 'done',
    }), TODAY)).toEqual([
      '当前任务未发现明确风险。',
    ])
  })

  it('uses the canonical assignee from an unchanged fixture task', () => {
    const task = createFixtureSeed().tasks[0]
    if (!task) throw new Error('expected the first fixture task')

    expect(task.assigneeId).toBeUndefined()
    expect(taskInsights(task, TODAY)).not.toContain('尚未分配负责人。')
  })

  it('defensively reports malformed legacy input without any assignee', () => {
    expect(taskInsights(malformedUnassignedTask(), TODAY)).toEqual([
      '尚未分配负责人。',
    ])
  })

  it.each([
    [['task-001'], '存在 1 项前置依赖，请确认阻塞状态。'],
    [['task-001', 'task-002', 'task-003'], '存在 3 项前置依赖，请确认阻塞状态。'],
  ])('reports %i dependencies', (dependencyIds, expected) => {
    expect(taskInsights(fixtureTask({ dependencyIds }), TODAY)).toEqual([
      expected,
    ])
  })

  it('combines independent insights in stable order', () => {
    expect(taskInsights(malformedUnassignedTask({
      dependencyIds: ['task-001', 'task-002'],
      dueDate: '2026-08-02',
    }), TODAY)).toEqual([
      '任务已逾期，请重新确认交付时间。',
      '尚未分配负责人。',
      '存在 2 项前置依赖，请确认阻塞状态。',
    ])
  })

  it('returns a fallback when there are no explicit risks', () => {
    expect(taskInsights(fixtureTask(), TODAY)).toEqual([
      '当前任务未发现明确风险。',
    ])
  })

  it('ignores date insights when the due date is invalid', () => {
    expect(taskInsights(fixtureTask({
      dueDate: '2026-02-30',
      progress: 0,
    }), TODAY)).toEqual([
      '当前任务未发现明确风险。',
    ])
  })

  it('ignores date insights when today is invalid', () => {
    expect(taskInsights(fixtureTask({
      dueDate: '2026-08-01',
      progress: 0,
    }), 'not-a-date')).toEqual([
      '当前任务未发现明确风险。',
    ])
  })

  it.each([
    ['0000-01-01', '0000-01-01'],
    ['0099-12-31', '0099-12-31'],
    ['0100-01-01', '0100-01-01'],
    ['0000-02-29', '0000-02-29'],
  ])('supports valid early ISO dates from %s through %s', (today, dueDate) => {
    expect(taskInsights(fixtureTask({ dueDate, progress: 0 }), today)).toEqual([
      '临近截止日期且进度偏低。',
    ])
  })

  it.each([
    ['0099-02-29', '0099-02-28'],
    ['0100-02-29', '0100-02-28'],
  ])('rejects invalid non-leap date %s', (dueDate, today) => {
    expect(taskInsights(fixtureTask({ dueDate, progress: 0 }), today)).toEqual([
      '当前任务未发现明确风险。',
    ])
  })
})
