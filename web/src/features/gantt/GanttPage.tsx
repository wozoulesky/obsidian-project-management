import {
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type UIEvent,
} from 'react'

import { EntityInspector } from '../../components/data/EntityInspector'
import {
  EmptyState,
  ErrorState,
  LoadingState,
  RefreshState,
} from '../../components/data/DataState'
import type { Task } from '../../data/domain'
import {
  useGanttTasks,
  useUpdateTaskDates,
} from '../../data/query-hooks'
import {
  parseIsoDate,
  shiftDate,
  type DateProposalKind,
  type GanttScale,
  type GanttTaskDates,
} from './gantt-layout'
import {
  GanttTimeline,
  type GanttRange,
  type GanttVisibleRow,
} from './GanttTimeline'

const AS_OF = '2026-07-28'
const ROW_HEIGHT = '2.75rem'
const ROW_HEIGHT_PX = 44
const ROW_OVERSCAN = 10
const VIRTUALIZE_AFTER = 100
const FALLBACK_VIEWPORT_HEIGHT = 440
const FALLBACK_VISIBLE_ROWS = Math.ceil(
  FALLBACK_VIEWPORT_HEIGHT / ROW_HEIGHT_PX,
)
const EMPTY_TASKS: Task[] = []
const scaleLabels = {
  day: '日',
  week: '周',
  month: '月',
} as const satisfies Record<GanttScale, string>

interface PendingProposal extends GanttTaskDates {
  kind: DateProposalKind
  originalDueDate: string
  originalStartDate: string
  taskId: string
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

function validTaskDates(tasks: readonly Task[]): string[] {
  return tasks
    .flatMap((task) => [task.startDate, task.dueDate])
    .filter((date) => parseIsoDate(date) !== null)
}

function monthOffset(date: string, offset: number): string {
  const timestamp = parseIsoDate(`${date.slice(0, 7)}-01`)
  if (timestamp === null) return date
  const value = new Date(timestamp)
  value.setUTCMonth(value.getUTCMonth() + offset)
  return value.toISOString().slice(0, 10)
}

function ganttRange(
  tasks: readonly Task[],
  scale: GanttScale,
  asOf = AS_OF,
): GanttRange {
  if (scale === 'day') {
    return {
      start: shiftDate(asOf, -3) ?? asOf,
      end: shiftDate(asOf, 11) ?? asOf,
    }
  }
  if (scale === 'month') {
    return {
      start: monthOffset(asOf, -1),
      end: monthOffset(asOf, 4),
    }
  }
  const dates = validTaskDates(tasks).sort()
  const first = dates[0] ?? asOf
  const last = dates.at(-1) ?? asOf
  return {
    start: shiftDate(first, -7) ?? first,
    end: shiftDate(last, 7) ?? last,
  }
}

function groupRows(
  tasks: readonly Task[],
  collapsedMilestones: ReadonlySet<string>,
): GanttVisibleRow[] {
  const groups = new Map<string, Task[]>()
  for (const task of tasks) {
    const group = groups.get(task.milestoneId) ?? []
    group.push(task)
    groups.set(task.milestoneId, group)
  }
  return Array.from(groups.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([milestoneId, group]) => {
      const dates = group
        .map((task) => task.dueDate)
        .filter((date) => parseIsoDate(date) !== null)
        .sort()
      const groupRow: GanttVisibleRow = {
        id: `group-${milestoneId}`,
        kind: 'group',
        milestoneId,
        milestoneDate: dates.at(-1) ?? AS_OF,
      }
      if (collapsedMilestones.has(milestoneId)) return [groupRow]
      return [
        groupRow,
        ...group.map(
          (task): GanttVisibleRow => ({
            id: task.id,
            kind: 'task',
            task,
          }),
        ),
      ]
    })
}

function formatChineseDate(date: string): string {
  const [, month = '', day = ''] = date.split('-')
  return `${Number(month)} 月 ${Number(day)} 日`
}

function proposalSummary(task: Task, proposal: PendingProposal): string {
  return `${task.title}：${formatChineseDate(
    proposal.originalStartDate,
  )}–${formatChineseDate(proposal.originalDueDate)} → ${formatChineseDate(
    proposal.startDate,
  )}–${formatChineseDate(proposal.dueDate)}`
}

function GanttTaskInspector({
  onClose,
  returnFocusId,
  task,
}: {
  onClose: () => void
  returnFocusId: string
  task: Task
}) {
  return (
    <EntityInspector
      fallbackFocusId="gantt-page-heading"
      onClose={onClose}
      returnFocusId={returnFocusId}
      title={task.title}
    >
      <div className="gantt-inspector">
        <dl>
          <div>
            <dt>编号</dt>
            <dd>{task.code}</dd>
          </div>
          <div>
            <dt>负责人</dt>
            <dd>{task.assignee.name}</dd>
          </div>
          <div>
            <dt>排期</dt>
            <dd>
              {task.startDate}–{task.dueDate}
            </dd>
          </div>
          <div>
            <dt>进度</dt>
            <dd>{task.progress}%</dd>
          </div>
          <div>
            <dt>里程碑</dt>
            <dd>{task.milestoneId}</dd>
          </div>
        </dl>
        <p>{task.description}</p>
      </div>
    </EntityInspector>
  )
}

export function GanttPage() {
  const tasksQuery = useGanttTasks()
  const updateDates = useUpdateTaskDates()
  const [scale, setScale] = useState<GanttScale>('week')
  const [collapsedMilestones, setCollapsedMilestones] = useState<Set<string>>(
    () => new Set(),
  )
  const [taskTreeCollapsed, setTaskTreeCollapsed] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [selectedTaskTriggerId, setSelectedTaskTriggerId] = useState<
    string | null
  >(null)
  const [proposal, setProposal] = useState<PendingProposal | null>(null)
  const [rowWindow, setRowWindow] = useState({
    end: FALLBACK_VISIBLE_ROWS + ROW_OVERSCAN,
    start: 0,
    viewportEnd: FALLBACK_VISIBLE_ROWS,
    viewportStart: 0,
  })
  const confirmLockRef = useRef(false)

  const tasks = tasksQuery.data ?? EMPTY_TASKS
  const visibleRows = useMemo(
    () => groupRows(tasks, collapsedMilestones),
    [collapsedMilestones, tasks],
  )
  const range = useMemo(() => ganttRange(tasks, scale), [scale, tasks])
  const shouldVirtualize = visibleRows.length > VIRTUALIZE_AFTER
  const windowStart = shouldVirtualize
    ? Math.min(rowWindow.start, Math.max(0, visibleRows.length - 1))
    : 0
  const windowEnd = shouldVirtualize
    ? Math.min(visibleRows.length, Math.max(rowWindow.end, windowStart + 1))
    : visibleRows.length
  const renderedRows = visibleRows.slice(windowStart, windowEnd)
  const visibleRowIndexById = useMemo(
    () => new Map(visibleRows.map((row, index) => [row.id, index])),
    [visibleRows],
  )
  const selectedTask =
    tasks.find((task) => task.id === selectedTaskId) ?? null
  const proposalTask =
    tasks.find((task) => task.id === proposal?.taskId) ?? null

  const toggleMilestone = (milestoneId: string) => {
    setCollapsedMilestones((current) => {
      const next = new Set(current)
      if (next.has(milestoneId)) next.delete(milestoneId)
      else next.add(milestoneId)
      return next
    })
  }

  const updateRowWindow = (event: UIEvent<HTMLDivElement>) => {
    if (!shouldVirtualize) return
    const viewportHeight =
      event.currentTarget.clientHeight || FALLBACK_VIEWPORT_HEIGHT
    const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT_PX)
    const viewportStart = Math.floor(
      event.currentTarget.scrollTop / ROW_HEIGHT_PX,
    )
    const viewportEnd = Math.min(
      visibleRows.length,
      viewportStart + visibleCount,
    )
    const start = Math.max(
      0,
      viewportStart - ROW_OVERSCAN,
    )
    const end = Math.min(
      visibleRows.length,
      viewportEnd + ROW_OVERSCAN,
    )
    const focusedRow =
      document.activeElement instanceof HTMLElement
        ? document.activeElement.closest<HTMLElement>('[data-row-id]')
        : null
    const focusedRowIndex = focusedRow?.dataset.rowId
      ? visibleRowIndexById.get(focusedRow.dataset.rowId)
      : undefined
    if (
      focusedRowIndex !== undefined &&
      (focusedRowIndex < start || focusedRowIndex >= end)
    ) {
      event.currentTarget.focus()
    }
    setRowWindow((current) =>
      current.start === start &&
      current.end === end &&
      current.viewportStart === viewportStart &&
      current.viewportEnd === viewportEnd
        ? current
        : { end, start, viewportEnd, viewportStart },
    )
  }

  const createProposal = (
    task: Task,
    kind: DateProposalKind,
    dates: GanttTaskDates,
  ) => {
    if (updateDates.isPending) return
    updateDates.reset()
    setProposal({
      ...dates,
      kind,
      originalDueDate: task.dueDate,
      originalStartDate: task.startDate,
      taskId: task.id,
    })
  }

  const confirmProposal = () => {
    if (!proposal || updateDates.isPending || confirmLockRef.current) return
    confirmLockRef.current = true
    updateDates.mutate(
      {
        taskId: proposal.taskId,
        input: {
          dueDate: proposal.dueDate,
          startDate: proposal.startDate,
        },
      },
      {
        onSuccess: () => {
          setProposal(null)
        },
        onSettled: () => {
          confirmLockRef.current = false
        },
      },
    )
  }

  if (tasksQuery.isPending && !tasksQuery.data) {
    return (
      <section className="gantt-page">
        <LoadingState />
      </section>
    )
  }
  if (tasksQuery.isError && !tasksQuery.data) {
    return (
      <section className="gantt-page">
        <ErrorState
          error={tasksQuery.error}
          isRetrying={tasksQuery.isFetching}
          onRetry={() => tasksQuery.refetch()}
        />
      </section>
    )
  }

  const layoutStyle = {
    '--gantt-row-height': ROW_HEIGHT,
  } as CSSProperties

  return (
    <section className="gantt-page">
      <RefreshState
        dataUpdatedAt={tasksQuery.dataUpdatedAt}
        error={tasksQuery.error}
        isError={tasksQuery.isError}
        isFetching={tasksQuery.isFetching}
      />
      <header className="gantt-page__header">
        <div>
          <p className="gantt-page__eyebrow">PLAN / DEPENDENCY</p>
          <h1 id="gantt-page-heading" tabIndex={-1}>
            项目排期
          </h1>
          <p data-testid="gantt-range">
            {range.start}–{range.end}
          </p>
        </div>
        <div className="gantt-page__controls">
          <div aria-label="时间轴刻度" className="gantt-scale">
            {(Object.keys(scaleLabels) as GanttScale[]).map((value) => (
              <button
                aria-pressed={scale === value}
                key={value}
                onClick={() => setScale(value)}
                type="button"
              >
                {scaleLabels[value]}
              </button>
            ))}
          </div>
          <button
            aria-expanded={!taskTreeCollapsed}
            className="button button--ghost gantt-task-tree-toggle"
            onClick={() => setTaskTreeCollapsed((current) => !current)}
            type="button"
          >
            {taskTreeCollapsed ? '展开任务树' : '折叠任务树'}
          </button>
        </div>
      </header>

      {tasks.length === 0 ? (
        <EmptyState title="当前项目暂无排期任务" />
      ) : (
        <div className="gantt-page__workspace data-grid-with-inspector">
          <div
            aria-label="甘特图排期滚动区域"
            className="gantt-scroll-region"
            onScroll={updateRowWindow}
            tabIndex={0}
          >
            <div
              className={`gantt-layout${
                taskTreeCollapsed ? ' gantt-layout--task-tree-collapsed' : ''
              }`}
              style={layoutStyle}
            >
              <section className="gantt-task-tree" aria-label="任务树">
                <div className="gantt-task-tree__header">
                  <span className="gantt-task-tree__collapse-placeholder">
                    任务
                  </span>
                  <span className="gantt-task-tree__content">负责人 / 进度</span>
                </div>
                <div
                  className="gantt-task-tree__rows"
                  style={
                    shouldVirtualize
                      ? { height: visibleRows.length * ROW_HEIGHT_PX }
                      : undefined
                  }
                >
                  {renderedRows.map((row, renderedIndex) =>
                    row.kind === 'group' ? (
                      <div
                        className="gantt-task-tree__row gantt-task-tree__row--group"
                        data-row-id={row.id}
                        key={row.id}
                        style={
                          shouldVirtualize
                            ? {
                                insetInline: 0,
                                position: 'absolute',
                                transform: `translateY(${
                                  (windowStart + renderedIndex) *
                                  ROW_HEIGHT_PX
                                }px)`,
                              }
                            : undefined
                        }
                      >
                        <button
                          aria-expanded={
                            !collapsedMilestones.has(row.milestoneId)
                          }
                          aria-label={`里程碑 ${row.milestoneId}`}
                          onClick={() => toggleMilestone(row.milestoneId)}
                          type="button"
                        >
                          <span aria-hidden="true">
                            {collapsedMilestones.has(row.milestoneId)
                              ? '›'
                              : '⌄'}
                          </span>
                          <strong>{row.milestoneId}</strong>
                        </button>
                        <time dateTime={row.milestoneDate}>
                          {row.milestoneDate}
                        </time>
                      </div>
                    ) : (
                      <div
                        className={`gantt-task-tree__row${
                          selectedTaskId === row.task.id ? ' is-selected' : ''
                        }`}
                        data-row-id={row.id}
                        key={row.id}
                        style={
                          shouldVirtualize
                            ? {
                                insetInline: 0,
                                position: 'absolute',
                                transform: `translateY(${
                                  (windowStart + renderedIndex) *
                                  ROW_HEIGHT_PX
                                }px)`,
                              }
                            : undefined
                        }
                      >
                        <button
                          aria-expanded={selectedTaskId === row.task.id}
                          aria-label={`查看 ${row.task.title}`}
                          className="gantt-task-tree__task gantt-task-tree__content"
                          id={`gantt-task-trigger-${row.task.id}`}
                          onClick={(event) => {
                            setSelectedTaskTriggerId(event.currentTarget.id)
                            setSelectedTaskId((current) =>
                              current === row.task.id ? null : row.task.id,
                            )
                          }}
                          type="button"
                        >
                          <span>
                            <small>{row.task.code}</small>
                            <strong>{row.task.title}</strong>
                          </span>
                          <span>
                            <small>{row.task.assignee.name}</small>
                            <strong>{row.task.progress}%</strong>
                          </span>
                        </button>
                      </div>
                    ),
                  )}
                </div>
              </section>

              <GanttTimeline
                asOf={AS_OF}
                onCancelProposal={() => {
                  updateDates.reset()
                  setProposal(null)
                }}
                onPropose={createProposal}
                onSelectTask={(taskId, triggerId) => {
                  setSelectedTaskTriggerId(triggerId)
                  setSelectedTaskId(taskId)
                }}
                range={range}
                allRows={visibleRows}
                rowHeight={ROW_HEIGHT_PX}
                rowStart={windowStart}
                rows={renderedRows}
                scale={scale}
                selectedTaskId={selectedTaskId}
                totalRows={visibleRows.length}
                viewportEnd={
                  shouldVirtualize ? rowWindow.viewportEnd : visibleRows.length
                }
                viewportStart={shouldVirtualize ? rowWindow.viewportStart : 0}
                virtualized={shouldVirtualize}
              />
            </div>
          </div>

          {selectedTask && selectedTaskTriggerId ? (
            <GanttTaskInspector
              onClose={() => setSelectedTaskId(null)}
              returnFocusId={selectedTaskTriggerId}
              task={selectedTask}
            />
          ) : null}
        </div>
      )}

      {proposal && proposalTask ? (
        <section
          aria-label="排期调整确认"
          className="gantt-proposal"
          role="status"
        >
          <p>{proposalSummary(proposalTask, proposal)}</p>
          {updateDates.isError ? (
            <p role="alert">
              {errorMessage(updateDates.error, '保存排期失败，请重试')}
            </p>
          ) : null}
          <div>
            <button
              className="button button--primary"
              disabled={updateDates.isPending}
              onClick={confirmProposal}
              type="button"
            >
              {updateDates.isError ? '重试排期调整' : '确认排期调整'}
            </button>
            <button
              className="button button--ghost"
              disabled={updateDates.isPending}
              onClick={() => {
                updateDates.reset()
                setProposal(null)
              }}
              type="button"
            >
              取消排期调整
            </button>
          </div>
        </section>
      ) : null}
    </section>
  )
}
