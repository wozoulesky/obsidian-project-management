import {
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'

import { Button } from '../../components/ui/Button'
import type { Actor, Priority } from '../../data/domain'
import { useCreateTask } from '../../data/query-hooks'
import { createProjectTaskInputSchema } from '../../data/project-repository'

type FormValues = {
  title: string
  description: string
  assigneeId: string
  startDate: string
  dueDate: string
  priority: Priority
  milestoneId: string
}

const emptyForm: FormValues = {
  title: '',
  description: '',
  assigneeId: '',
  startDate: '',
  dueDate: '',
  priority: 'P1',
  milestoneId: '',
}

export function CreateTaskDialog({
  activeMembers,
  onClose,
  projectId,
  projectName,
}: {
  activeMembers: Actor[]
  onClose: () => void
  projectId: string
  projectName: string
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const createTask = useCreateTask(projectId)
  const [values, setValues] = useState(emptyForm)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const setValue = <Key extends keyof FormValues>(
    key: Key,
    value: FormValues[Key],
  ) => {
    setValues((current) => ({ ...current, [key]: value }))
    setErrors((current) => {
      const next = { ...current }
      delete next[key]
      delete next.submit
      return next
    })
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const nextErrors: Record<string, string> = {}
    const title = values.title.trim()
    if (!title) nextErrors.title = '请输入任务标题'
    if (!activeMembers.some(({ id }) => id === values.assigneeId)) {
      nextErrors.assigneeId = '请选择有效的项目成员'
    }
    if (!values.startDate) nextErrors.startDate = '请选择开始日期'
    if (!values.dueDate) nextErrors.dueDate = '请选择截止日期'
    if (
      values.startDate
      && values.dueDate
      && values.startDate > values.dueDate
    ) {
      nextErrors.dueDate = '开始日期不能晚于截止日期'
    }

    const input = {
      title,
      description: values.description.trim(),
      assigneeId: values.assigneeId,
      startDate: values.startDate,
      dueDate: values.dueDate,
      priority: values.priority,
      ...(values.milestoneId.trim()
        ? { milestoneId: values.milestoneId.trim() }
        : {}),
    }
    if (
      Object.keys(nextErrors).length === 0
      && !createProjectTaskInputSchema.safeParse(input).success
    ) {
      nextErrors.submit = '请检查任务信息后重试'
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }

    try {
      await createTask.mutateAsync(input)
      onClose()
    } catch (error) {
      setErrors({
        submit: error instanceof Error ? error.message : '任务创建失败',
      })
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
      ) ?? [],
    )
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

  return (
    <div
      aria-labelledby="create-task-title"
      aria-modal="true"
      className="project-dialog"
      onKeyDown={handleKeyDown}
      ref={dialogRef}
      role="dialog"
    >
      <form className="project-dialog__panel" onSubmit={submit}>
        <header>
          <h2 id="create-task-title">在 {projectName} 中创建任务</h2>
          <Button aria-label="关闭新建任务" onClick={onClose} variant="ghost">
            关闭
          </Button>
        </header>
        <label>
          任务标题
          <input
            aria-label="任务标题"
            aria-invalid={Boolean(errors.title)}
            autoFocus
            onChange={(event) => setValue('title', event.target.value)}
            value={values.title}
          />
          {errors.title ? (
            <span className="project-dialog__field-error">{errors.title}</span>
          ) : null}
        </label>
        <label>
          任务描述
          <textarea
            aria-label="任务描述"
            onChange={(event) => setValue('description', event.target.value)}
            value={values.description}
          />
        </label>
        <label>
          负责人
          <select
            aria-label="负责人"
            aria-invalid={Boolean(errors.assigneeId)}
            onChange={(event) => setValue('assigneeId', event.target.value)}
            value={values.assigneeId}
          >
            <option value="">请选择</option>
            {activeMembers.map((actor) => (
              <option key={actor.id} value={actor.id}>{actor.name}</option>
            ))}
          </select>
          {errors.assigneeId ? (
            <span className="project-dialog__field-error">
              {errors.assigneeId}
            </span>
          ) : null}
        </label>
        <div className="project-dialog__dates">
          <label>
            开始日期
            <input
              aria-label="开始日期"
              aria-invalid={Boolean(errors.startDate)}
              onChange={(event) => setValue('startDate', event.target.value)}
              type="date"
              value={values.startDate}
            />
            {errors.startDate ? (
              <span className="project-dialog__field-error">
                {errors.startDate}
              </span>
            ) : null}
          </label>
          <label>
            截止日期
            <input
              aria-label="截止日期"
              aria-invalid={Boolean(errors.dueDate)}
              onChange={(event) => setValue('dueDate', event.target.value)}
              type="date"
              value={values.dueDate}
            />
            {errors.dueDate ? (
              <span className="project-dialog__field-error">
                {errors.dueDate}
              </span>
            ) : null}
          </label>
        </div>
        <label>
          优先级
          <select
            aria-label="优先级"
            onChange={(event) =>
              setValue('priority', event.target.value as Priority)}
            value={values.priority}
          >
            {(['P0', 'P1', 'P2', 'P3'] as const).map((priority) => (
              <option key={priority} value={priority}>{priority}</option>
            ))}
          </select>
        </label>
        <label>
          里程碑
          <input
            aria-label="里程碑"
            onChange={(event) => setValue('milestoneId', event.target.value)}
            value={values.milestoneId}
          />
        </label>
        {errors.submit ? <p role="alert">{errors.submit}</p> : null}
        <footer>
          <Button onClick={onClose}>取消</Button>
          <Button disabled={createTask.isPending} type="submit" variant="primary">
            {createTask.isPending ? '正在创建…' : '创建任务'}
          </Button>
        </footer>
      </form>
    </div>
  )
}
