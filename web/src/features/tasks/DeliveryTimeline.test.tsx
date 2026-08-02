import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Task } from '../../data/domain'
import { DeliveryTimeline } from './DeliveryTimeline'

function task(overrides: Partial<Task>): Task {
  return {
    id: 'task-default',
    code: 'TASK-DEFAULT',
    title: '默认任务',
    description: '用于验证交付时间线。',
    assignee: { id: 'human-lin', name: 'Lin', kind: 'human' },
    startDate: '2026-07-20',
    dueDate: '2026-07-28',
    priority: 'P1',
    status: 'in_progress',
    progress: 50,
    milestoneId: 'm2',
    dependencyIds: [],
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('DeliveryTimeline', () => {
  it('filters only timeline nodes by local week, month and quarter ranges', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 7, 12, 12))
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { container } = render(
      <DeliveryTimeline
        onSelect={vi.fn()}
        selectedTaskId="selected"
        tasks={[
          task({
            id: 'week',
            code: 'TASK-1',
            title: '本周项',
            dueDate: '2026-08-13',
          }),
          task({
            id: 'selected',
            code: 'TASK-2',
            title: '本月项',
            startDate: '2026-08-01',
            dueDate: '2026-08-28',
            status: 'overdue',
          }),
          task({
            id: 'quarter',
            code: 'TASK-3',
            title: '本季度项',
            dueDate: '2026-09-20',
          }),
          task({
            id: 'outside',
            code: 'TASK-4',
            title: '季度外',
            dueDate: '2026-10-01',
          }),
        ]}
      />,
    )

    const timeline = screen.getByRole('region', { name: '独立交付时间线' })
    expect(within(timeline).getByRole('button', { name: '月' }))
      .toHaveAttribute('aria-pressed', 'true')
    expect(within(timeline).getByText('本周项')).toBeVisible()
    expect(within(timeline).getByText('本月项')).toBeVisible()
    expect(within(timeline).queryByText('本季度项')).not.toBeInTheDocument()

    await user.click(within(timeline).getByRole('button', { name: '周' }))
    expect(within(timeline).getByText('本周项')).toBeVisible()
    expect(within(timeline).queryByText('本月项')).not.toBeInTheDocument()

    await user.click(within(timeline).getByRole('button', { name: '季度' }))
    expect(within(timeline).getByText('本季度项')).toBeVisible()
    expect(within(timeline).queryByText('季度外')).not.toBeInTheDocument()
    expect(container.querySelectorAll('.delivery-timeline__item')).toHaveLength(3)
  })

  it('renders task nodes as accessible selection buttons', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 6, 28, 12))
    const onSelect = vi.fn()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(
      <DeliveryTimeline
        onSelect={onSelect}
        selectedTaskId="selected"
        tasks={[
          task({ id: 'first', code: 'TASK-1', title: '第一项' }),
          task({ id: 'selected', code: 'TASK-2', title: '选中项' }),
        ]}
      />,
    )

    const selected = screen.getByRole('button', { name: /选中项/ })
    expect(selected).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: /第一项/ }))
    expect(onSelect).toHaveBeenCalledWith('first', 'task-timeline-trigger-first')
  })

  it('announces an empty filtered result', () => {
    render(
      <DeliveryTimeline onSelect={vi.fn()} selectedTaskId={null} tasks={[]} />,
    )

    expect(screen.getByRole('status')).toHaveTextContent(
      '当前时间范围暂无交付节点',
    )
  })
})
