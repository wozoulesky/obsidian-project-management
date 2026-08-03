import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'

import {
  ErrorState,
  LoadingState,
  RefreshState,
} from '../../components/data/DataState'
import { MetricGrid } from '../../components/layout/MetricGrid'
import { PageHeader } from '../../components/layout/PageHeader'
import { GlassPanel } from '../../components/ui/GlassPanel'
import type { Task, TaskStatus } from '../../data/domain'
import {
  useMoveTaskStatus,
  useProjectRepository,
  useProjects,
  useTasks,
} from '../../data/query-hooks'
import { TaskBoard } from './TaskBoard'
import { TaskCompactList } from './TaskCompactList'
import { TaskContextPanel } from './TaskContextPanel'
import { filterTasks, TaskFilters } from './TaskFilters'
import { prioritizeFanTasks, TaskFan } from './TaskFan'
import { parseTaskView } from './task-workspace-model'
import { TaskTimeline } from './TaskTimeline'
import { TaskViewSwitch } from './TaskViewSwitch'
import './tasks-glass.css'

const compactTaskLayoutQuery = '(max-width: 760px)'

type PreservedModalTarget = {
  ariaHidden: string | null
  element: HTMLElement
  inert: string | null
}

function preserveAndIsolate(element: HTMLElement): PreservedModalTarget {
  const preserved = {
    ariaHidden: element.getAttribute('aria-hidden'),
    element,
    inert: element.getAttribute('inert'),
  }
  element.setAttribute('aria-hidden', 'true')
  element.setAttribute('inert', '')
  return preserved
}

function restoreModalTarget({ ariaHidden, element, inert }: PreservedModalTarget) {
  if (ariaHidden === null) element.removeAttribute('aria-hidden')
  else element.setAttribute('aria-hidden', ariaHidden)

  if (inert === null) element.removeAttribute('inert')
  else element.setAttribute('inert', inert)
}

const metricCopy = {
  today: { label: '今日待办', empty: '今日清零', active: '今日聚焦' },
  active: { label: '进行中', empty: '暂无推进', active: '持续推进' },
  done: { label: '已完成', empty: '等待交付', active: '已有交付' },
  overdue: { label: '逾期', empty: '风险清零', active: '需立即关注' },
} as const

function taskMetrics(tasks: readonly Task[], today: string) {
  const values = {
    today: tasks.filter(
      (task) =>
        task.dueDate === today &&
        task.status !== 'done' &&
        task.status !== 'overdue',
    ).length,
    active: tasks.filter((task) => task.status === 'in_progress').length,
    done: tasks.filter((task) => task.status === 'done').length,
    overdue: tasks.filter((task) => task.status === 'overdue').length,
  }

  return (Object.keys(values) as Array<keyof typeof values>).map((key) => ({
    key,
    label: metricCopy[key].label,
    note: values[key] > 0 ? metricCopy[key].active : metricCopy[key].empty,
    value: values[key],
  }))
}

function projectFallbackName(projectId: string): string {
  const readableId = projectId.length > 24
    ? `${projectId.slice(0, 8)}…${projectId.slice(-4)}`
    : projectId
  return `项目 ${readableId}`
}

export function TaskPage() {
  const location = useLocation()
  const tasksQuery = useTasks()
  const projectsQuery = useProjects()
  const moveStatus = useMoveTaskStatus()
  const { projectId: workspaceProjectId } = useProjectRepository()
  const [searchParams, setSearchParams] = useSearchParams()
  const locationSignature = [
    location.pathname,
    location.search,
    location.hash,
  ].join('|')
  const [isCompactLayout, setIsCompactLayout] = useState(() =>
    typeof window.matchMedia === 'function'
      ? window.matchMedia(compactTaskLayoutQuery).matches
      : false,
  )
  const [contextDrawer, setContextDrawer] = useState(() => ({
    locationSignature,
    open: false,
  }))
  const contextPanelId = useId()
  const taskPageRef = useRef<HTMLElement>(null)
  const contextDrawerOpenerRef = useRef<HTMLButtonElement>(null)
  const contextDrawerCloseRef = useRef<HTMLButtonElement>(null)
  if (contextDrawer.locationSignature !== locationSignature) {
    setContextDrawer({ locationSignature, open: false })
  }
  const contextDrawerOpen = isCompactLayout
    && contextDrawer.open
    && contextDrawer.locationSignature === locationSignature
  const now = new Date()
  const today = [
    String(now.getFullYear()).padStart(4, '0'),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-')
  const tasks = tasksQuery.data ?? []
  const filteredTasks = filterTasks(tasks, searchParams)
  const view = parseTaskView(searchParams.get('view'))
  const requestedTaskId = searchParams.get('selected')
  const prioritizedTasks = prioritizeFanTasks(filteredTasks)
  const selectedTask =
    filteredTasks.find((task) => task.id === requestedTaskId)
    ?? prioritizedTasks[0]
    ?? null
  const selectedTaskId = selectedTask?.id ?? null
  const selectedProjectId = selectedTask?.projectId ?? workspaceProjectId
  const selectedProjectName = projectsQuery.data?.find(
    ({ id }) => id === selectedProjectId,
  )?.name ?? projectFallbackName(selectedProjectId)
  const metrics = taskMetrics(filteredTasks, today)

  const closeContextDrawer = useCallback(() => {
    setContextDrawer((current) => ({ ...current, open: false }))
    queueMicrotask(() => contextDrawerOpenerRef.current?.focus())
  }, [])
  const dismissContextDrawer = useCallback(() => {
    setContextDrawer((current) => ({ ...current, open: false }))
  }, [])

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia(compactTaskLayoutQuery)
    const handleChange = (event: MediaQueryListEvent) => {
      setIsCompactLayout(event.matches)
      if (!event.matches) dismissContextDrawer()
    }
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [dismissContextDrawer])

  useEffect(() => {
    if (!contextDrawerOpen) return
    contextDrawerCloseRef.current?.focus()
  }, [contextDrawerOpen])

  useEffect(() => {
    if (!contextDrawerOpen) return
    const handleDrawerKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeContextDrawer()
        return
      }
      if (event.key !== 'Tab') return
      const drawer = document.getElementById(contextPanelId)
      const focusable = Array.from(drawer?.querySelectorAll<HTMLElement>([
        'button:not([disabled])',
        'input:not([disabled])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        '[href]',
        '[tabindex]:not([tabindex="-1"])',
      ].join(',')) ?? [])
      const first = focusable[0]
      const last = focusable.at(-1)
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleDrawerKeyDown)
    return () => document.removeEventListener('keydown', handleDrawerKeyDown)
  }, [closeContextDrawer, contextDrawerOpen, contextPanelId])

  useEffect(() => {
    if (!contextDrawerOpen) return
    const page = taskPageRef.current
    const drawer = document.getElementById(contextPanelId)
    if (!page || !drawer) return

    const workspace = page.querySelector<HTMLElement>(
      '.task-multiview-workspace',
    )
    const stage = workspace?.querySelector<HTMLElement>('.task-view-stage')
    const modalTargets = new Set<HTMLElement>()
    document.querySelectorAll<HTMLElement>('.app-rail')
      .forEach((element) => modalTargets.add(element))
    Array.from(page.children).forEach((element) => {
      if (!(element instanceof HTMLElement)) return
      if (element === workspace || element === drawer) return
      if (element.classList.contains('task-context-drawer__backdrop')) return
      modalTargets.add(element)
    })
    if (stage) modalTargets.add(stage)

    const preservedTargets = Array.from(modalTargets, preserveAndIsolate)
    const main = page.closest<HTMLElement>('.app-main')
    const previousMainOverflow = main?.style.overflow ?? null
    if (main) main.style.overflow = 'hidden'

    const keepFocusInDrawer = (event: FocusEvent) => {
      if (!(event.target instanceof Node) || drawer.contains(event.target)) return
      contextDrawerCloseRef.current?.focus()
    }
    document.addEventListener('focusin', keepFocusInDrawer)

    return () => {
      document.removeEventListener('focusin', keepFocusInDrawer)
      preservedTargets.forEach(restoreModalTarget)
      if (main && previousMainOverflow !== null) {
        main.style.overflow = previousMainOverflow
      }
    }
  }, [contextDrawerOpen, contextPanelId])

  const setSelectedTaskId = (taskId: string | null) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (taskId) {
        next.set('selected', taskId)
      } else {
        next.delete('selected')
      }
      return next
    })
  }

  const selectTask = (taskId: string) => {
    dismissContextDrawer()
    setSelectedTaskId(taskId)
  }

  const moveTask = (task: Task, status: TaskStatus) =>
    moveStatus.mutateAsync({
      projectId: task.projectId ?? workspaceProjectId,
      status,
      task,
    }).then(() => undefined)

  if (tasksQuery.isPending && !tasksQuery.data) {
    return (
      <section className="task-page">
        <LoadingState />
      </section>
    )
  }

  if (tasksQuery.isError && !tasksQuery.data) {
    return (
      <section className="task-page">
        <ErrorState
          error={tasksQuery.error}
          isRetrying={tasksQuery.isFetching}
          onRetry={() => tasksQuery.refetch()}
        />
      </section>
    )
  }

  return (
    <section className="task-page" ref={taskPageRef}>
      <RefreshState
        dataUpdatedAt={tasksQuery.dataUpdatedAt}
        error={tasksQuery.error}
        isError={tasksQuery.isError}
        isFetching={tasksQuery.isFetching}
      />
      <PageHeader
        actions={(
          <>
            <span onClickCapture={dismissContextDrawer}>
              <TaskViewSwitch value={view} />
            </span>
            <span className="task-page__count">
              {filteredTasks.length} / {tasks.length} 项
            </span>
          </>
        )}
        eyebrow="PLAN / TASKS"
        subtitle={`以 ${today} 为今日基准，聚合筛选范围内的执行状态与交付风险。`}
        title={(
          <span id="task-page-heading" tabIndex={-1}>
            任务控制台
          </span>
        )}
      />
      <MetricGrid ariaLabel="任务关键指标" className="task-metrics">
        {metrics.map((metric) => (
          <GlassPanel
            as="div"
            className={`task-metric task-metric--${metric.key}`}
            data-metric={metric.label}
            key={metric.key}
          >
            <span>{metric.label}</span>
            <strong data-testid="metric-value">{metric.value}</strong>
            <small>{metric.note}</small>
          </GlassPanel>
        ))}
      </MetricGrid>
      <div className="task-filter-toolbar" data-testid="task-filter-toolbar">
        <TaskFilters tasks={tasks} />
      </div>
      <div
        className="task-multiview-workspace"
        data-testid="task-workspace"
      >
        <div
          className="task-view-stage"
          data-slot="stage"
          data-testid="task-view-stage"
          data-view={view}
        >
          <button
            aria-controls={contextPanelId}
            aria-expanded={contextDrawerOpen}
            className="task-context-drawer__trigger"
            onClick={() => setContextDrawer({
              locationSignature,
              open: true,
            })}
            ref={contextDrawerOpenerRef}
            type="button"
          >
            查看任务详情
          </button>
          {view === 'fan' ? (
            <>
              <TaskCompactList
                allTasks={tasks}
                dataSlot="list"
                onSelect={selectTask}
                selectedTaskId={selectedTaskId}
                tasks={filteredTasks}
              />
              <TaskFan
                dataSlot="fan"
                onSelect={selectTask}
                selectedTaskId={selectedTaskId}
                tasks={filteredTasks}
              />
            </>
          ) : view === 'board' ? (
            <TaskBoard
              dataSlot="board"
              onMoveTask={moveTask}
              onSelect={selectTask}
              selectedTaskId={selectedTaskId}
              tasks={filteredTasks}
            />
          ) : (
            <TaskTimeline
              dataSlot="timeline"
              onSelect={selectTask}
              selectedTaskId={selectedTaskId}
              tasks={filteredTasks}
              today={today}
            />
          )}
        </div>
        <TaskContextPanel
          closeButtonRef={contextDrawerCloseRef}
          dataSlot="context"
          drawerOpen={contextDrawerOpen}
          onClose={closeContextDrawer}
          panelId={contextPanelId}
          projectName={selectedProjectName}
          task={selectedTask}
          today={today}
        />
      </div>
      {contextDrawerOpen ? (
        <button
          aria-label="关闭任务详情遮罩"
          className="task-context-drawer__backdrop"
          onClick={closeContextDrawer}
          type="button"
        />
      ) : null}
    </section>
  )
}
