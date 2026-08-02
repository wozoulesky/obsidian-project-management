import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Task } from '../../data/domain'
import { prioritizeFanTasks, TaskFan } from './TaskFan'
import tasksGlassCss from './tasks-glass.css?raw'

function task(index: number): Task {
  return {
    id: `task-${index}`,
    code: `TASK-${index}`,
    title: `扇面任务 ${index}`,
    description: '用于验证任务扇面。',
    assignee: { id: 'human-lin', name: 'Lin', kind: 'human' },
    startDate: '2026-07-20',
    dueDate: `2026-07-${String(20 + index).padStart(2, '0')}`,
    priority: index === 1 ? 'P0' : 'P1',
    status: index === 1 ? 'overdue' : 'in_progress',
    progress: index * 10,
    milestoneId: 'm2',
    dependencyIds: [],
  }
}

afterEach(cleanup)

describe('TaskFan', () => {
  it('prioritizes status, priority, due date, and id before limiting to six', () => {
    const source = [
      {
        ...task(9),
        id: 'done-p3',
        priority: 'P3' as const,
        status: 'done' as const,
        dueDate: '2026-07-01',
      },
      {
        ...task(9),
        id: 'overdue-p0',
        priority: 'P0' as const,
        status: 'overdue' as const,
        dueDate: '2026-07-30',
      },
      {
        ...task(9),
        id: 'active-p0',
        priority: 'P0' as const,
        status: 'in_progress' as const,
        dueDate: '2026-07-02',
      },
    ]

    expect(prioritizeFanTasks(source).slice(0, 2).map(({ id }) => id))
      .toEqual(['overdue-p0', 'active-p0'])
    expect(prioritizeFanTasks(source)).toHaveLength(3)
  })

  it('renders only the first six tasks and gives every card its own button', () => {
    const { container } = render(
      <TaskFan
        onSelect={vi.fn()}
        selectedTaskId={null}
        tasks={Array.from({ length: 8 }, (_, index) => task(index + 1))}
      />,
    )

    const fan = screen.getByRole('region', { name: '关键任务扇面' })
    expect(within(fan).getAllByRole('button')).toHaveLength(6)
    expect(within(fan).queryByText('扇面任务 7')).not.toBeInTheDocument()
    const cards = container.querySelectorAll('.task-fan__item')
    expect(cards).toHaveLength(6)
    cards.forEach((card) => {
      expect(card.children).toHaveLength(1)
      expect(card.firstElementChild).toHaveClass('task-fan__button')
      expect(card.firstElementChild?.tagName).toBe('BUTTON')
    })
  })

  it('reports selection and invokes the task callback', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(
      <TaskFan
        onSelect={onSelect}
        selectedTaskId="task-2"
        tasks={[task(1), task(2)]}
      />,
    )

    expect(
      screen.getByRole('button', { name: '选择 TASK-2 扇面任务 2' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await user.click(
      screen.getByRole('button', { name: '选择 TASK-1 扇面任务 1' }),
    )
    expect(onSelect).toHaveBeenCalledWith(
      'task-1',
      'task-fan-trigger-task-1',
    )
  })

  it('uses full-size non-overlapping hit targets around visual-only surfaces', () => {
    expect(tasksGlassCss).toMatch(
      /\.task-fan__button\s*{[^}]*width:\s*100%[^}]*height:\s*100%/s,
    )
    expect(tasksGlassCss).toMatch(
      /\.task-fan__surface\s*{[^}]*pointer-events:\s*none/s,
    )
  })

  it('announces an empty filtered result', () => {
    render(
      <TaskFan onSelect={vi.fn()} selectedTaskId={null} tasks={[]} />,
    )

    expect(screen.getByRole('status')).toHaveTextContent(
      '当前筛选范围暂无可展示任务',
    )
  })
})
