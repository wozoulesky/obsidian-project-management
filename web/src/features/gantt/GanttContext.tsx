import { useState, type FormEvent } from 'react'

import { Button } from '../../components/ui/Button'
import { GlassPanel } from '../../components/ui/GlassPanel'
import type { Task } from '../../data/domain'
import { useUpdateTaskDates } from '../../data/query-hooks'
import { TaskProgressForm } from '../tasks/TaskInspector'
import { parseIsoDate } from './gantt-layout'

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function GanttScheduleForm({ task }: { task: Task }) {
  const updateDates = useUpdateTaskDates()
  const [startDate, setStartDate] = useState(task.startDate)
  const [dueDate, setDueDate] = useState(task.dueDate)
  const [formError, setFormError] = useState('')

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const start = parseIsoDate(startDate)
    const due = parseIsoDate(dueDate)
    if (start === null || due === null) {
      setFormError('请输入有效的开始日期和截止日期')
      return
    }
    if (start > due) {
      setFormError('开始日期不能晚于截止日期')
      return
    }

    setFormError('')
    updateDates.mutate(
      {
        taskId: task.id,
        input: { startDate, dueDate },
      },
      {
        onError: (error) => {
          setFormError(messageFrom(error, '保存排期失败，请稍后重试'))
        },
      },
    )
  }

  return (
    <form className="gantt-context__form" noValidate onSubmit={handleSubmit}>
      <div className="gantt-context__form-heading">
        <h3>排期</h3>
        <span>{task.startDate}–{task.dueDate}</span>
      </div>
      <label>
        开始日期
        <input
          onChange={(event) => setStartDate(event.target.value)}
          type="date"
          value={startDate}
        />
      </label>
      <label>
        截止日期
        <input
          onChange={(event) => setDueDate(event.target.value)}
          type="date"
          value={dueDate}
        />
      </label>
      {formError ? <p role="alert">{formError}</p> : null}
      <Button disabled={updateDates.isPending} type="submit" variant="secondary">
        {updateDates.isPending ? '正在保存…' : '保存排期'}
      </Button>
    </form>
  )
}

function TaskDetails({ task }: { task: Task }) {
  return (
    <>
      <dl className="gantt-context__details">
        <div><dt>编号</dt><dd>{task.code}</dd></div>
        <div><dt>负责人</dt><dd>{task.assignee.name}</dd></div>
        <div><dt>优先级</dt><dd>{task.priority}</dd></div>
        <div><dt>里程碑</dt><dd>{task.milestoneId}</dd></div>
        <div>
          <dt>依赖</dt>
          <dd>{task.dependencyIds.join('、') || '无'}</dd>
        </div>
      </dl>
      <p className="gantt-context__description">{task.description}</p>
    </>
  )
}

export function GanttContext({ task }: { task: Task | null }) {
  return (
    <GlassPanel ariaLabel="甘特任务上下文" className="gantt-context">
      <header className="gantt-context__header">
        <span>ACTIVE TASK / CONTEXT</span>
        <h2>{task?.title ?? '任务上下文'}</h2>
        {task ? (
          <p>{task.code} · {task.progress}%</p>
        ) : null}
      </header>

      {task ? (
        <div className="gantt-context__body">
          <TaskDetails task={task} />
          <GanttScheduleForm key={`dates-${task.id}`} task={task} />
          <section className="gantt-context__progress" aria-label="任务进度更新">
            <h3>进度</h3>
            <TaskProgressForm key={`progress-${task.id}`} task={task} />
          </section>
        </div>
      ) : (
        <div className="gantt-context__empty" role="status">
          <strong>当前项目暂无任务上下文</strong>
          <p>创建排期任务后，可在这里查看依赖并更新日期与进度。</p>
        </div>
      )}
    </GlassPanel>
  )
}
