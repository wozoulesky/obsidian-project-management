import type { CSSProperties } from 'react'

import { GlassPanel } from '../../components/ui/GlassPanel'
import type { Task } from '../../data/domain'
import {
  dateToPercent,
  parseIsoDate,
  shiftDate,
  taskBarLayout,
} from '../gantt/gantt-layout'
import { taskStatusLabels, taskStatuses } from './task-workspace-model'

const DAY_MS = 86_400_000

export interface TaskTimelineProps {
  dataSlot?: string
  onSelect: (taskId: string) => void
  selectedTaskId: string | null
  tasks: readonly Task[]
  today: string
}

function hasValidRange(task: Task): boolean {
  const start = parseIsoDate(task.startDate)
  const due = parseIsoDate(task.dueDate)
  return start !== null && due !== null && start <= due
}

function compactDate(date: string): string {
  return date.slice(5)
}

function dateTicks(start: string, end: string): string[] {
  const startMs = parseIsoDate(start)
  const endMs = parseIsoDate(end)
  if (startMs === null || endMs === null || endMs <= startMs) return []

  const days = Math.round((endMs - startMs) / DAY_MS)
  const step = days <= 14 ? 1 : Math.ceil(days / 7)
  const ticks: string[] = []
  for (let offset = 0; offset < days; offset += step) {
    const tick = shiftDate(start, offset)
    if (tick) ticks.push(tick)
  }
  if (ticks.at(-1) !== end) ticks.push(end)
  return ticks
}

function Notice({ datedCount, total }: { datedCount: number; total: number }) {
  const undatedCount = total - datedCount
  if (total === 0) {
    return <p className="task-timeline__empty" role="status">暂无时间线任务</p>
  }
  if (datedCount === 0) {
    return (
      <p className="task-timeline__empty" role="status">
        没有具有有效日期的任务。{undatedCount} 项任务缺少有效日期
      </p>
    )
  }
  return undatedCount > 0 ? (
    <p className="task-timeline__notice" role="status">
      {undatedCount} 项任务缺少有效日期
    </p>
  ) : null
}

export function TaskTimeline({
  dataSlot,
  onSelect,
  selectedTaskId,
  tasks,
  today,
}: TaskTimelineProps) {
  const datedTasks = tasks.filter(hasValidRange)
  const rangeStart = datedTasks.map((task) => task.startDate).sort()[0]
  const lastDue = datedTasks.map((task) => task.dueDate).sort().at(-1)
  const rangeEnd = lastDue ? shiftDate(lastDue, 1) : null
  const ticks = rangeStart && rangeEnd ? dateTicks(rangeStart, rangeEnd) : []
  const todayPosition = rangeStart && rangeEnd
    ? dateToPercent(today, rangeStart, rangeEnd)
    : 0
  const todayInRange = rangeStart && rangeEnd
    ? parseIsoDate(today) !== null && today >= rangeStart && today < rangeEnd
    : false

  return (
    <GlassPanel
      ariaLabel="任务时间线工作区"
      className="task-timeline"
      data-range-end={rangeEnd ?? undefined}
      data-range-start={rangeStart}
      data-slot={dataSlot}
    >
      <header className="task-timeline__header">
        <div>
          <p>DELIVERY RANGE</p>
          <h2>任务时间线</h2>
        </div>
        {rangeStart && rangeEnd ? (
          <p className="task-timeline__range">
            {rangeStart} 至 {rangeEnd}（结束日不含）
          </p>
        ) : null}
      </header>

      <Notice datedCount={datedTasks.length} total={tasks.length} />

      {rangeStart && rangeEnd ? (
        <div
          aria-label="任务日期范围，可横向滚动"
          className="task-timeline__scroll"
          tabIndex={0}
        >
          <ol aria-label="日期刻度" className="task-timeline__ticks">
            {ticks.map((tick) => (
              <li
                key={tick}
                style={{ left: `${dateToPercent(tick, rangeStart, rangeEnd)}%` }}
              >
                <time dateTime={tick}>{compactDate(tick)}</time>
              </li>
            ))}
          </ol>

          <div className="task-timeline__chart">
            {todayInRange ? (
              <span
                aria-label={`今天 ${today}`}
                className="task-timeline__today"
                data-date={today}
                role="img"
                style={{ left: `${todayPosition}%` }}
              />
            ) : null}

            {taskStatuses.map((status) => {
              const statusTasks = datedTasks.filter(
                (task) => task.status === status,
              )
              return (
                <section
                  aria-label={`${taskStatusLabels[status]}任务时间线`}
                  className="task-timeline__status"
                  data-status={status}
                  key={status}
                >
                  <header>
                    <h3>{taskStatusLabels[status]}</h3>
                    <span>{statusTasks.length}</span>
                  </header>
                  {statusTasks.length === 0 ? (
                    <p className="task-timeline__status-empty">暂无任务</p>
                  ) : statusTasks.map((task) => {
                    const layout = taskBarLayout(task, rangeStart, rangeEnd)
                    const style = {
                      left: `${layout.left}%`,
                      width: `${layout.width}%`,
                    } satisfies CSSProperties
                    return (
                      <div className="task-timeline__row" key={task.id}>
                        <span className="task-timeline__row-label">
                          <span>{task.code}</span>
                          <strong>{task.title}</strong>
                        </span>
                        <div className="task-timeline__track">
                          <button
                            aria-label={`选择 ${task.code} ${task.title}`}
                            aria-pressed={selectedTaskId === task.id}
                            className="task-timeline__bar"
                            onClick={() => onSelect(task.id)}
                            style={style}
                            type="button"
                          >
                            <strong>{task.title}</strong>
                            <span>
                              <time dateTime={task.startDate}>
                                {compactDate(task.startDate)}
                              </time>
                              {' — '}
                              <time dateTime={task.dueDate}>
                                {compactDate(task.dueDate)}
                              </time>
                            </span>
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </section>
              )
            })}
          </div>
        </div>
      ) : null}
    </GlassPanel>
  )
}
