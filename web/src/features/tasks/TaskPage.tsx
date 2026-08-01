import { useSearchParams } from 'react-router-dom'

import {
  EmptyState,
  ErrorState,
  LoadingState,
  RefreshState,
} from '../../components/data/DataState'
import { MetricGrid } from '../../components/layout/MetricGrid'
import { PageHeader } from '../../components/layout/PageHeader'
import { GlassPanel } from '../../components/ui/GlassPanel'
import type { Task } from '../../data/domain'
import { useTasks } from '../../data/query-hooks'
import { DeliveryTimeline } from './DeliveryTimeline'
import { filterTasks, TaskFilters } from './TaskFilters'
import { TaskFan } from './TaskFan'
import { TaskInspector } from './TaskInspector'
import { TaskTable } from './TaskTable'
import './tasks-glass.css'

const TASK_REFERENCE_DATE = '2026-07-28'

const metricCopy = {
  today: { label: '今日待办', empty: '今日清零', active: '今日聚焦' },
  active: { label: '进行中', empty: '暂无推进', active: '持续推进' },
  done: { label: '已完成', empty: '等待交付', active: '已有交付' },
  overdue: { label: '逾期', empty: '风险清零', active: '需立即关注' },
} as const

function taskMetrics(tasks: readonly Task[]) {
  const values = {
    today: tasks.filter(
      (task) =>
        task.dueDate === TASK_REFERENCE_DATE &&
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

export function TaskPage() {
  const tasksQuery = useTasks()
  const [searchParams, setSearchParams] = useSearchParams()
  const tasks = tasksQuery.data ?? []
  const filteredTasks = filterTasks(tasks, searchParams)
  const selectedTaskId = searchParams.get('selected')
  const selectedTask =
    filteredTasks.find((task) => task.id === selectedTaskId) ?? null
  const metrics = taskMetrics(filteredTasks)

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
    <section className="task-page">
      <RefreshState
        dataUpdatedAt={tasksQuery.dataUpdatedAt}
        error={tasksQuery.error}
        isError={tasksQuery.isError}
        isFetching={tasksQuery.isFetching}
      />
      <PageHeader
        actions={(
          <span className="task-page__count">
            {filteredTasks.length} / {tasks.length} 项
          </span>
        )}
        eyebrow="PLAN / TASKS"
        subtitle={`以 ${TASK_REFERENCE_DATE} 为今日基准，聚合筛选范围内的执行状态与交付风险。`}
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
      <div className="task-console__hero">
        <TaskFan
          onSelect={setSelectedTaskId}
          selectedTaskId={selectedTaskId}
          tasks={filteredTasks}
        />
        <DeliveryTimeline
          selectedTaskId={selectedTaskId}
          tasks={filteredTasks}
        />
      </div>
      <GlassPanel ariaLabel="任务清单" className="task-console__list">
        <header className="task-console__list-header">
          <div>
            <p>FULL TASK INDEX</p>
            <h2>全部任务</h2>
          </div>
          <span>{filteredTasks.length} 项结果</span>
        </header>
        <TaskFilters tasks={tasks} />
        <div className="data-grid-with-inspector task-page__workspace">
          {tasks.length === 0 ? (
            <EmptyState title="当前项目暂无任务" />
          ) : filteredTasks.length === 0 ? (
            <p className="task-page__empty">没有符合筛选条件的任务。</p>
          ) : (
            <TaskTable
              onSelect={setSelectedTaskId}
              selectedTaskId={selectedTaskId}
              tasks={filteredTasks}
            />
          )}
          {selectedTask ? (
            <TaskInspector
              fallbackFocusId="task-page-heading"
              onClose={() => setSelectedTaskId(null)}
              task={selectedTask}
            />
          ) : null}
        </div>
      </GlassPanel>
    </section>
  )
}
