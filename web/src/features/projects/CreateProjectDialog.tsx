import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'

import { Button } from '../../components/ui/Button'
import type { Actor } from '../../data/domain'
import { useCreateProject } from '../../data/query-hooks'

type FormValues = {
  name: string
  ownerId: string
  description: string
  startDate: string
  dueDate: string
}

const emptyForm: FormValues = {
  name: '',
  ownerId: '',
  description: '',
  startDate: '',
  dueDate: '',
}

export function CreateProjectDialog({
  activeActors,
  onClose,
}: {
  activeActors: Actor[]
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const submitErrorRef = useRef<HTMLParagraphElement>(null)
  const createProject = useCreateProject()
  const [values, setValues] = useState(emptyForm)
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (errors.submit) submitErrorRef.current?.focus()
  }, [errors.submit])

  const setValue = (key: keyof FormValues, value: string) => {
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
    const name = values.name.trim()
    if (!name) nextErrors.name = '请输入项目名称'
    if (!activeActors.some(({ id }) => id === values.ownerId)) {
      nextErrors.ownerId = '请选择有效负责人'
    }
    if (
      values.startDate
      && values.dueDate
      && values.startDate > values.dueDate
    ) {
      nextErrors.dueDate = '开始日期不能晚于截止日期'
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }
    setErrors({})
    try {
      await createProject.mutateAsync({
        name,
        ownerId: values.ownerId,
        description: values.description.trim(),
        startDate: values.startDate || null,
        dueDate: values.dueDate || null,
      })
      onClose()
    } catch (error) {
      setErrors({
        submit: error instanceof Error ? error.message : '项目创建失败',
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
      aria-labelledby="create-project-title"
      aria-modal="true"
      className="project-dialog"
      onKeyDown={handleKeyDown}
      ref={dialogRef}
      role="dialog"
    >
      <form className="project-dialog__panel" onSubmit={submit}>
        <header>
          <h2 id="create-project-title">新建项目</h2>
          <Button aria-label="关闭新建项目" onClick={onClose} variant="ghost">
            关闭
          </Button>
        </header>
        <label>
          项目名称
          <input
            aria-label="项目名称"
            aria-invalid={Boolean(errors.name)}
            autoFocus
            onChange={(event) => setValue('name', event.target.value)}
            value={values.name}
          />
          {errors.name ? <span className="project-dialog__field-error">{errors.name}</span> : null}
        </label>
        <label>
          主要负责人
          <select
            aria-label="主要负责人"
            aria-invalid={Boolean(errors.ownerId)}
            onChange={(event) => setValue('ownerId', event.target.value)}
            value={values.ownerId}
          >
            <option value="">请选择</option>
            {activeActors.map((actor) => (
              <option key={actor.id} value={actor.id}>{actor.name}</option>
            ))}
          </select>
          {errors.ownerId ? (
            <span className="project-dialog__field-error">{errors.ownerId}</span>
          ) : null}
        </label>
        <label>
          项目描述
          <textarea
            aria-label="项目描述"
            onChange={(event) => setValue('description', event.target.value)}
            value={values.description}
          />
        </label>
        <div className="project-dialog__dates">
          <label>
            开始日期
            <input
              aria-label="开始日期"
              onChange={(event) => setValue('startDate', event.target.value)}
              type="date"
              value={values.startDate}
            />
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
              <span className="project-dialog__field-error">{errors.dueDate}</span>
            ) : null}
          </label>
        </div>
        {errors.submit ? (
          <p ref={submitErrorRef} role="alert" tabIndex={-1}>
            {errors.submit}
          </p>
        ) : null}
        <footer>
          <Button onClick={onClose}>取消</Button>
          <Button disabled={createProject.isPending} type="submit" variant="primary">
            {createProject.isPending ? '正在创建…' : '创建项目'}
          </Button>
        </footer>
      </form>
    </div>
  )
}
