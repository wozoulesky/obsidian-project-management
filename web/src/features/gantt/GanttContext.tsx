import { useState, type FormEvent } from 'react'

import { Button } from '../../components/ui/Button'
import { GlassPanel } from '../../components/ui/GlassPanel'
import type { Task, TaskStatus } from '../../data/domain'
import {
  useUpdateTaskDates,
  useUpdateTaskProgress,
} from '../../data/query-hooks'
import { parseIsoDate } from './gantt-layout'

const statusLabels: Record<TaskStatus, string> = {
  not_started: '未开始',
  in_progress: '进行中',
  done: '已完成',
  overdue: '已延期',
}

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function GanttScheduleForm({ task }: { task: Task }) {
  const updateDates = useUpdateTaskDates()
  const [startDate, setStartDate] = useState(task.startDate)
  const [dueDate, setDueDate] = useState(task.dueDate)
  const [formError, setFormError] = useState('')
  const [saveMessage, setSaveMessage] = useState('')

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const start = parseIsoDate(startDate)
    const due = parseIsoDate(dueDate)
    setSaveMessage('')
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
        onSuccess: () => {
          setSaveMessage('排期已保存')
        },
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
      {saveMessage ? (
        <p aria-live="polite" role="status">{saveMessage}</p>
      ) : null}
      <Button disabled={updateDates.isPending} type="submit" variant="secondary">
        {updateDates.isPending ? '正在保存…' : '保存排期'}
      </Button>
    </form>
  )
}

function GanttProgressForm({ task }: { task: Task }) {
  const updateProgress = useUpdateTaskProgress()
  const [progress, setProgress] = useState(String(task.progress))
  const [status, setStatus] = useState<TaskStatus>(task.status)
  const [note, setNote] = useState('')
  const [formError, setFormError] = useState('')
  const [saveMessage, setSaveMessage] = useState('')

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const numericProgress = Number(progress)
    setSaveMessage('')
    if (
      progress.trim() === '' ||
      !Number.isInteger(numericProgress) ||
      numericProgress < 0 ||
      numericProgress > 100
    ) {
      setFormError('进度必须是 0 到 100 的整数。')
      return
    }

    setFormError('')
    updateProgress.mutate(
      {
        taskId: task.id,
        input: { progress: numericProgress, status, note },
      },
      {
        onSuccess: () => {
          setSaveMessage('进度已保存')
        },
        onError: (error) => {
          setFormError(messageFrom(error, '保存进度失败，请稍后重试'))
        },
      },
    )
  }

  return (
    <form className="task-inspector__form" noValidate onSubmit={handleSubmit}>
      <label>
        任务进度
        <input
          inputMode="numeric"
          max="100"
          min="0"
          onChange={(event) => setProgress(event.target.value)}
          step="1"
          type="number"
          value={progress}
        />
      </label>
      <label>
        状态
        <select
          onChange={(event) => setStatus(event.target.value as TaskStatus)}
          value={status}
        >
          {Object.entries(statusLabels).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      <label>
        进度备注
        <textarea
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          value={note}
        />
      </label>
      {formError ? <p role="alert">{formError}</p> : null}
      {saveMessage ? (
        <p aria-live="polite" role="status">{saveMessage}</p>
      ) : null}
      <Button
        aria-label="提交进度"
        disabled={updateProgress.isPending}
        type="submit"
        variant="primary"
      >
        {updateProgress.isPending ? '正在提交…' : '提交进度'}
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
    <GlassPanel
      ariaLabel="甘特任务上下文"
      className="gantt-context"
      id="gantt-task-context"
    >
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
            <GanttProgressForm key={`progress-${task.id}`} task={task} />
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
