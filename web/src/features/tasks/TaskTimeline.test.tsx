import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Task } from '../../data/domain'
import { TaskTimeline } from './TaskTimeline'

function task(overrides: Partial<Task>): Task {
  return {
    id: 'task-default',
    code: 'TASK-DEFAULT',
    title: '默认任务',
    description: '用于验证任务时间线。',
    assignee: { id: 'human-lin', name: 'Lin', kind: 'human' },
    startDate: '2026-07-20',
    dueDate: '2026-07-20',
    priority: 'P1',
    status: 'in_progress',
    progress: 50,
    milestoneId: 'm2',
    dependencyIds: [],
    ...overrides,
  }
}

afterEach(cleanup)

describe('TaskTimeline', () => {
  it('derives an exclusive date range and uses Gantt layout values', () => {
    const { container } = render(
      <TaskTimeline
        onSelect={vi.fn()}
        selectedTaskId={null}
        tasks={[
          task({ id: 'anchor', code: 'TASK-1', title: '范围起点' }),
          task({
            id: 'integration',
            code: 'TASK-2',
            title: '接口联调',
            startDate: '2026-07-21',
            dueDate: '2026-07-23',
          }),
        ]}
        today="2026-07-22"
      />,
    )

    const timeline = screen.getByRole('region', { name: '任务时间线工作区' })
    expect(timeline).toHaveAttribute('data-range-start', '2026-07-20')
    expect(timeline).toHaveAttribute('data-range-end', '2026-07-24')
    expect(screen.getByText('2026-07-20 至 2026-07-24（结束日不含）'))
      .toBeVisible()
    expect(screen.getByRole('button', { name: '选择 TASK-2 接口联调' }))
      .toHaveStyle({ left: '25%', width: '50%' })
    expect(screen.getByRole('img', { name: '今天 2026-07-22' }))
      .toHaveStyle({ left: '50%' })
    expect(within(screen.getByRole('list', { name: '日期刻度' }))
      .getByText('07-20')).toBeVisible()
    expect(container.querySelector('[data-status="in_progress"]'))
      .toHaveTextContent('进行中')
    expect(screen.getByRole('button', { name: '选择 TASK-2 接口联调' }))
      .toHaveTextContent('接口联调')
    expect(screen.getByRole('button', { name: '选择 TASK-2 接口联调' }))
      .toHaveTextContent('07-21 — 07-23')
  })

  it('omits invalid bars and announces how many tasks lack valid dates', () => {
    render(
      <TaskTimeline
        onSelect={vi.fn()}
        selectedTaskId={null}
        tasks={[
          task({ id: 'valid', title: '有效任务' }),
          task({ id: 'bad-start', title: '坏开始', startDate: 'not-a-date' }),
          task({ id: 'bad-due', title: '坏截止', dueDate: '2026-02-30' }),
          task({
            id: 'reversed',
            title: '反向日期',
            startDate: '2026-07-23',
            dueDate: '2026-07-21',
          }),
        ]}
        today="2026-07-20"
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent(
      '3 项任务缺少有效日期',
    )
    expect(screen.getByRole('button', { name: /有效任务/ })).toBeVisible()
    expect(screen.queryByRole('button', { name: /坏开始|坏截止|反向日期/ }))
      .not.toBeInTheDocument()
  })

  it('shares click and keyboard selection and marks the selected task', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <TaskTimeline
        onSelect={onSelect}
        selectedTaskId="selected"
        tasks={[
          task({ id: 'first', code: 'TASK-1', title: '第一项' }),
          task({
            id: 'selected',
            code: 'TASK-2',
            title: '选中项',
            startDate: '2026-07-21',
            dueDate: '2026-07-22',
          }),
        ]}
        today="2026-07-21"
      />,
    )

    const selected = screen.getByRole('button', { name: '选择 TASK-2 选中项' })
    const first = screen.getByRole('button', { name: '选择 TASK-1 第一项' })
    expect(selected).toHaveAttribute('aria-pressed', 'true')
    expect(first).toHaveAttribute('aria-pressed', 'false')

    await user.click(first)
    selected.focus()
    await user.keyboard('{Enter}')

    expect(onSelect).toHaveBeenNthCalledWith(1, 'first')
    expect(onSelect).toHaveBeenNthCalledWith(2, 'selected')
  })

  it('renders accessible empty states for no tasks and all-invalid tasks', () => {
    const { rerender } = render(
      <TaskTimeline
        onSelect={vi.fn()}
        selectedTaskId={null}
        tasks={[]}
        today="2026-07-20"
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent('暂无时间线任务')

    rerender(
      <TaskTimeline
        onSelect={vi.fn()}
        selectedTaskId={null}
        tasks={[task({ startDate: '', dueDate: '' })]}
        today="2026-07-20"
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent(
      '没有具有有效日期的任务。1 项任务缺少有效日期',
    )
    expect(screen.queryByRole('button', { name: /选择/ }))
      .not.toBeInTheDocument()
  })

  it('uses the shared date helpers across low years and month boundaries', () => {
    render(
      <TaskTimeline
        onSelect={vi.fn()}
        selectedTaskId={null}
        tasks={[
          task({
            id: 'early-year',
            code: 'TASK-0099',
            title: '早期跨月任务',
            startDate: '0099-01-31',
            dueDate: '0099-02-02',
          }),
        ]}
        today="0099-02-01"
      />,
    )

    expect(screen.getByRole('button', { name: '选择 TASK-0099 早期跨月任务' }))
      .toHaveStyle({ left: '0%', width: '66.67%' })
    expect(screen.getByRole('img', { name: '今天 0099-02-01' }))
      .toHaveStyle({ left: '33.33333333333333%' })
  })

  it('does not render the today line outside the derived range', () => {
    render(
      <TaskTimeline
        onSelect={vi.fn()}
        selectedTaskId={null}
        tasks={[task({ startDate: '2026-07-20', dueDate: '2026-07-23' })]}
        today="2026-08-01"
      />,
    )

    expect(screen.queryByRole('img', { name: /今天/ })).not.toBeInTheDocument()
  })
})
