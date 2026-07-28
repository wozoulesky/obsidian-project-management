import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { useTasks } from '../../data/query-hooks'
import { filterTasks, TaskFilters } from './TaskFilters'
import { TaskInspector } from './TaskInspector'
import { TaskTable } from './TaskTable'

export function TaskPage() {
  const tasksQuery = useTasks()
  const [searchParams] = useSearchParams()
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const tasks = tasksQuery.data ?? []
  const filteredTasks = filterTasks(tasks, searchParams)
  const selectedTask =
    filteredTasks.find((task) => task.id === selectedTaskId) ?? null

  if (tasksQuery.isPending) {
    return (
      <section aria-busy="true" className="task-page">
        <p role="status">正在加载任务…</p>
      </section>
    )
  }

  if (tasksQuery.isError) {
    return (
      <section className="task-page">
        <p role="alert">任务加载失败，请稍后重试。</p>
      </section>
    )
  }

  return (
    <section className="task-page">
      <header className="task-page__header">
        <div>
          <p className="task-page__eyebrow">计划 / 任务</p>
          <h1 id="task-page-heading" tabIndex={-1}>
            任务工作台
          </h1>
        </div>
        <p>{filteredTasks.length} / {tasks.length} 项</p>
      </header>
      <TaskFilters
        onFiltersChange={() => setSelectedTaskId(null)}
        tasks={tasks}
      />
      <div className="data-grid-with-inspector task-page__workspace">
        {tasks.length === 0 ? (
          <p className="task-page__empty">当前没有任务。</p>
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
