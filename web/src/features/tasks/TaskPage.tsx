import { useSearchParams } from 'react-router-dom'

import {
  EmptyState,
  ErrorState,
  LoadingState,
  RefreshState,
} from '../../components/data/DataState'
import { useTasks } from '../../data/query-hooks'
import { filterTasks, TaskFilters } from './TaskFilters'
import { TaskInspector } from './TaskInspector'
import { TaskTable } from './TaskTable'

export function TaskPage() {
  const tasksQuery = useTasks()
  const [searchParams, setSearchParams] = useSearchParams()
  const tasks = tasksQuery.data ?? []
  const filteredTasks = filterTasks(tasks, searchParams)
  const selectedTaskId = searchParams.get('selected')
  const selectedTask =
    filteredTasks.find((task) => task.id === selectedTaskId) ?? null

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
      <header className="task-page__header">
        <div>
          <p className="task-page__eyebrow">计划 / 任务</p>
          <h1 id="task-page-heading" tabIndex={-1}>
            任务工作台
          </h1>
        </div>
        <p>{filteredTasks.length} / {tasks.length} 项</p>
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
    </section>
  )
}
