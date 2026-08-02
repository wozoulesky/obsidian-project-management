import { useState, type CSSProperties } from 'react'

import { GlassPanel } from '../../components/ui/GlassPanel'
import type { Task } from '../../data/domain'

const statusLabels: Record<Task['status'], string> = {
  not_started: '未开始',
  in_progress: '进行中',
  done: '已完成',
  overdue: '逾期',
}

const ranges = ['week', 'month', 'quarter'] as const
type TimelineRange = (typeof ranges)[number]

const rangeLabels: Record<TimelineRange, string> = {
  week: '周',
  month: '月',
  quarter: '季度',
}

function localDateKey(date: Date): string {
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function dateWithOffset(source: Date, dayOffset: number): Date {
  return new Date(
    source.getFullYear(),
    source.getMonth(),
    source.getDate() + dayOffset,
  )
}

function timelineRangeBounds(
  range: TimelineRange,
  today: Date,
): { end: string; start: string } {
  if (range === 'week') {
    return {
      start: localDateKey(dateWithOffset(today, -7)),
      end: localDateKey(dateWithOffset(today, 7)),
    }
  }

  if (range === 'month') {
    return {
      start: localDateKey(new Date(today.getFullYear(), today.getMonth(), 1)),
      end: localDateKey(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
    }
  }

  const quarterStartMonth = Math.floor(today.getMonth() / 3) * 3
  return {
    start: localDateKey(new Date(today.getFullYear(), quarterStartMonth, 1)),
    end: localDateKey(new Date(today.getFullYear(), quarterStartMonth + 3, 0)),
  }
}

export interface DeliveryTimelineProps {
  onSelect: (taskId: string, triggerId: string) => void
  selectedTaskId: string | null
  tasks: readonly Task[]
}

export function DeliveryTimeline({
  onSelect,
  selectedTaskId,
  tasks,
}: DeliveryTimelineProps) {
  const [range, setRange] = useState<TimelineRange>('month')
  const bounds = timelineRangeBounds(range, new Date())
  const visibleTasks = tasks
    .filter((task) =>
      task.dueDate >= bounds.start && task.dueDate <= bounds.end,
    )
    .slice()
    .sort((left, right) =>
      left.dueDate.localeCompare(right.dueDate)
      || left.id.localeCompare(right.id),
    )
  const listStyle = {
    '--delivery-count': Math.max(visibleTasks.length, 1),
  } as CSSProperties

  return (
    <GlassPanel
      ariaLabel="独立交付时间线"
      className="delivery-timeline delivery-timeline-panel"
    >
      <header className="delivery-timeline__header">
        <div>
          <p>DELIVERY DATES</p>
          <h2>独立交付时间线</h2>
        </div>
        <div className="delivery-timeline__controls">
          <div aria-label="任务交付时间范围" className="segmented" role="group">
            {ranges.map((value) => (
              <button
                aria-pressed={range === value}
                key={value}
                onClick={() => setRange(value)}
                type="button"
              >
                {rangeLabels[value]}
              </button>
            ))}
          </div>
          <span>{visibleTasks.length} 个节点</span>
        </div>
      </header>
      {visibleTasks.length === 0 ? (
        <p className="delivery-timeline__empty" role="status">
          当前时间范围暂无交付节点
        </p>
      ) : (
        <div
          aria-label="交付时间线，可横向滚动"
          className="delivery-timeline__scroll"
          tabIndex={0}
        >
          <ol className="delivery-timeline__list" style={listStyle}>
            {visibleTasks.map((task) => {
              const triggerId = `task-timeline-trigger-${task.id}`
              return (
                <li
                  className="delivery-timeline__item"
                  data-status={task.status}
                  key={task.id}
                >
                  <button
                    aria-label={`选择 ${task.code} ${task.title}`}
                    aria-pressed={task.id === selectedTaskId}
                    id={triggerId}
                    onClick={() => onSelect(task.id, triggerId)}
                    type="button"
                  >
                    <span
                      aria-hidden="true"
                      className="delivery-timeline__bar"
                    />
                    <strong>{task.title}</strong>
                    <span>{statusLabels[task.status]}</span>
                    <time dateTime={task.dueDate}>{task.dueDate}</time>
                  </button>
                </li>
              )
            })}
          </ol>
        </div>
      )}
    </GlassPanel>
  )
}
