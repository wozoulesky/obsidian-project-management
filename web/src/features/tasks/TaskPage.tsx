import { useSearchParams } from 'react-router-dom'

import {
  ErrorState,
  LoadingState,
  RefreshState,
} from '../../components/data/DataState'
import { MetricGrid } from '../../components/layout/MetricGrid'
import { PageHeader } from '../../components/layout/PageHeader'
import { GlassPanel } from '../../components/ui/GlassPanel'
import type { Task } from '../../data/domain'
import { useTasks } from '../../data/query-hooks'
import { TaskCompactList } from './TaskCompactList'
import { TaskContextPanel } from './TaskContextPanel'
import { filterTasks, TaskFilters } from './TaskFilters'
import { prioritizeFanTasks, TaskFan } from './TaskFan'
import { parseTaskView } from './task-workspace-model'
import { TaskViewSwitch } from './TaskViewSwitch'
import './tasks-glass.css'

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

export function TaskPage() {
  const tasksQuery = useTasks()
  const [searchParams, setSearchParams] = useSearchParams()
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
  const metrics = taskMetrics(filteredTasks, today)

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
    setSelectedTaskId(taskId)
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
          <>
            <TaskViewSwitch value={view} />
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
      <div className="task-workspace" data-testid="task-workspace">
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
        ) : (
          <GlassPanel
            ariaLabel={view === 'board' ? '任务看板工作区' : '任务时间线工作区'}
            data-slot={view}
            style={{ gridColumn: '1 / span 2' }}
          >
            <p>{view === 'board' ? '任务看板' : '任务时间线'}将在下一阶段接入。</p>
          </GlassPanel>
        )}
        <TaskContextPanel
          dataSlot="context"
          task={selectedTask}
        />
      </div>
    </section>
  )
}
