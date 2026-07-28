import {
  useMemo,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'

import type { Task } from '../../data/domain'
import {
  buildDateProposal,
  dateDeltaFromPixels,
  dateToPercent,
  parseIsoDate,
  shiftDate,
  taskBarLayout,
  type DateProposalKind,
  type GanttScale,
  type GanttTaskDates,
} from './gantt-layout'

export type GanttVisibleRow =
  | {
      id: string
      kind: 'group'
      milestoneId: string
      milestoneDate: string
    }
  | {
      id: string
      kind: 'task'
      task: Task
    }

export interface GanttRange {
  end: string
  start: string
}

interface GanttTimelineProps {
  asOf: string
  onCancelProposal: () => void
  onPropose: (
    task: Task,
    kind: DateProposalKind,
    dates: GanttTaskDates,
  ) => void
  range: GanttRange
  rows: GanttVisibleRow[]
  scale: GanttScale
  selectedTaskId: string | null
  onSelectTask: (taskId: string) => void
}

interface DragState {
  kind: DateProposalKind
  pointerId: number
  startX: number
  task: Task
  timelineWidth: number
}

const DAY_MS = 86_400_000

function dateDifference(start: string, end: string): number {
  const startMs = parseIsoDate(start)
  const endMs = parseIsoDate(end)
  return startMs === null || endMs === null
    ? 0
    : Math.max(0, Math.round((endMs - startMs) / DAY_MS))
}

function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`
}

function nextMonth(date: string): string {
  const timestamp = parseIsoDate(monthStart(date))
  if (timestamp === null) return date
  const value = new Date(timestamp)
  value.setUTCMonth(value.getUTCMonth() + 1)
  return value.toISOString().slice(0, 10)
}

function formatTick(date: string, scale: GanttScale): string {
  const timestamp = parseIsoDate(date)
  if (timestamp === null) return date
  const value = new Date(timestamp)
  if (scale === 'month') {
    return `${value.getUTCFullYear()}.${value.getUTCMonth() + 1}`
  }
  return `${value.getUTCMonth() + 1}/${value.getUTCDate()}`
}

function buildTicks(range: GanttRange, scale: GanttScale): string[] {
  const rangeDays = dateDifference(range.start, range.end)
  if (rangeDays <= 0) return [range.start]
  const ticks: string[] = []
  if (scale === 'month') {
    let cursor = monthStart(range.start)
    while (cursor <= range.end && ticks.length < 24) {
      if (cursor >= range.start) ticks.push(cursor)
      cursor = nextMonth(cursor)
    }
    return ticks
  }
  const step = scale === 'day' ? 1 : 7
  for (let offset = 0; offset <= rangeDays; offset += step) {
    const tick = shiftDate(range.start, offset)
    if (tick) ticks.push(tick)
  }
  return ticks
}

function keyboardDelta(
  event: KeyboardEvent<HTMLButtonElement>,
  kind: DateProposalKind,
): number | null {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return null
  if (kind === 'resize' && !event.shiftKey) return null
  if (kind === 'move' && event.shiftKey) return null
  return event.key === 'ArrowLeft' ? -1 : 1
}

export function GanttTimeline({
  asOf,
  onCancelProposal,
  onPropose,
  onSelectTask,
  range,
  rows,
  scale,
  selectedTaskId,
}: GanttTimelineProps) {
  const dragRef = useRef<DragState | null>(null)
  const ticks = useMemo(() => buildTicks(range, scale), [range, scale])
  const rangeDays = dateDifference(range.start, range.end)
  const taskRows = rows.filter(
    (row): row is Extract<GanttVisibleRow, { kind: 'task' }> =>
      row.kind === 'task',
  )
  const taskIndex = new Map(
    taskRows.map((row) => [row.task.id, rows.indexOf(row)]),
  )
  const taskById = new Map(taskRows.map((row) => [row.task.id, row.task]))
  const dependencies = taskRows.flatMap(({ task }) =>
    task.dependencyIds.flatMap((dependencyId) => {
      const predecessor = taskById.get(dependencyId)
      const fromIndex = taskIndex.get(dependencyId)
      const toIndex = taskIndex.get(task.id)
      return predecessor && fromIndex !== undefined && toIndex !== undefined
        ? [{ predecessor, successor: task, fromIndex, toIndex }]
        : []
    }),
  )

  const beginDrag = (
    event: PointerEvent<HTMLButtonElement>,
    task: Task,
    kind: DateProposalKind,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    const timeline =
      event.currentTarget.closest<HTMLElement>('.gantt-timeline__body')
    const width = timeline?.getBoundingClientRect().width || 720
    dragRef.current = {
      kind,
      pointerId: event.pointerId,
      startX: event.clientX,
      task,
      timelineWidth: width,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const updateDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const delta = dateDeltaFromPixels(
      event.clientX - drag.startX,
      drag.timelineWidth,
      rangeDays,
    )
    if (delta === 0) return
    const dates = buildDateProposal(
      drag.kind,
      drag.task.startDate,
      drag.task.dueDate,
      delta,
    )
    if (dates) onPropose(drag.task, drag.kind, dates)
  }

  const endDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    dragRef.current = null
  }

  const cancelDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    dragRef.current = null
    onCancelProposal()
  }

  const proposeFromKeyboard = (
    event: KeyboardEvent<HTMLButtonElement>,
    task: Task,
    kind: DateProposalKind,
  ) => {
    const delta = keyboardDelta(event, kind)
    if (delta === null) return
    event.preventDefault()
    event.stopPropagation()
    const dates = buildDateProposal(
      kind,
      task.startDate,
      task.dueDate,
      delta,
    )
    if (dates) onPropose(task, kind, dates)
  }

  return (
    <section className="gantt-timeline" aria-label="甘特时间轴">
      <div className="gantt-timeline__header">
        {ticks.map((tick) => (
          <span
            className="gantt-timeline__tick"
            key={tick}
            style={{
              left: `${dateToPercent(tick, range.start, range.end)}%`,
            }}
          >
            {formatTick(tick, scale)}
          </span>
        ))}
      </div>
      <div className="gantt-timeline__body">
        <div className="gantt-timeline__grid" aria-hidden="true">
          {ticks.map((tick) => (
            <span
              key={tick}
              style={{
                left: `${dateToPercent(tick, range.start, range.end)}%`,
              }}
            />
          ))}
        </div>
        {dateToPercent(asOf, range.start, range.end) > 0 &&
        dateToPercent(asOf, range.start, range.end) < 100 ? (
          <span
            aria-hidden="true"
            className="gantt-timeline__today"
            data-date={asOf}
            style={{
              left: `${dateToPercent(asOf, range.start, range.end)}%`,
            }}
          />
        ) : null}
        <div className="gantt-timeline__rows">
          {rows.map((row) => {
            if (row.kind === 'group') {
              return (
                <div
                  className="gantt-timeline__row gantt-timeline__row--group"
                  data-row-id={row.id}
                  key={row.id}
                >
                  <span
                    aria-label={`里程碑 ${row.milestoneId}：${row.milestoneDate}`}
                    className="gantt-milestone"
                    style={{
                      left: `${dateToPercent(
                        row.milestoneDate,
                        range.start,
                        range.end,
                      )}%`,
                    }}
                  />
                </div>
              )
            }
            const { task } = row
            const layout = taskBarLayout(task, range.start, range.end)
            const barStyle = {
              left: `${layout.left}%`,
              width: `${Math.max(layout.width, 1.2)}%`,
            } satisfies CSSProperties
            return (
              <div
                className="gantt-timeline__row"
                data-row-id={row.id}
                key={row.id}
              >
                <div
                  className={`gantt-task-bar gantt-task-bar--${task.status}${
                    selectedTaskId === task.id ? ' is-selected' : ''
                  }`}
                  style={barStyle}
                >
                  <button
                    aria-label={`移动 ${task.title}`}
                    className="gantt-task-bar__move"
                    onClick={() => onSelectTask(task.id)}
                    onKeyDown={(event) =>
                      proposeFromKeyboard(event, task, 'move')
                    }
                    onPointerCancel={cancelDrag}
                    onPointerDown={(event) => beginDrag(event, task, 'move')}
                    onPointerMove={updateDrag}
                    onPointerUp={endDrag}
                    type="button"
                  >
                    <span
                      aria-hidden="true"
                      className="gantt-task-bar__progress"
                      style={{ width: `${Math.min(100, Math.max(0, task.progress))}%` }}
                    />
                    <span className="gantt-task-bar__label">{task.code}</span>
                  </button>
                  <button
                    aria-label={`调整 ${task.title} 截止日期`}
                    className="gantt-task-bar__resize"
                    onKeyDown={(event) =>
                      proposeFromKeyboard(event, task, 'resize')
                    }
                    onPointerCancel={cancelDrag}
                    onPointerDown={(event) => beginDrag(event, task, 'resize')}
                    onPointerMove={updateDrag}
                    onPointerUp={endDrag}
                    type="button"
                  />
                </div>
              </div>
            )
          })}
        </div>
        {dependencies.length > 0 ? (
          <svg
            aria-hidden="true"
            className="gantt-dependencies"
            preserveAspectRatio="none"
            viewBox={`0 0 100 ${rows.length}`}
          >
            {dependencies.map(
              ({ predecessor, successor, fromIndex, toIndex }) => {
                const startX = dateToPercent(
                  predecessor.dueDate,
                  range.start,
                  range.end,
                )
                const endX = dateToPercent(
                  successor.startDate,
                  range.start,
                  range.end,
                )
                const midpoint = Math.max(startX + 1, (startX + endX) / 2)
                const risk = predecessor.status === 'overdue'
                return (
                  <path
                    className={risk ? 'is-risk' : undefined}
                    d={`M ${startX} ${fromIndex + 0.5} H ${midpoint} V ${
                      toIndex + 0.5
                    } H ${endX}`}
                    data-dependency={`${predecessor.id}-${successor.id}`}
                    key={`${predecessor.id}-${successor.id}`}
                    vectorEffect="non-scaling-stroke"
                  />
                )
              },
            )}
          </svg>
        ) : null}
      </div>
      {dependencies.length > 0 ? (
        <section className="gantt-dependency-summary" aria-label="任务依赖关系">
          <h2>依赖关系</h2>
          <ul>
            {dependencies.map(({ predecessor, successor }) => (
              <li key={`${predecessor.id}-${successor.id}`}>
                {predecessor.title} → {successor.title}
                {predecessor.status === 'overdue' ? '（前置任务已逾期）' : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  )
}
