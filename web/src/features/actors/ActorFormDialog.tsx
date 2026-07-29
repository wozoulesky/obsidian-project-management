import {
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'

import { Button } from '../../components/ui/Button'
import type { Actor } from '../../data/domain'
import {
  useCreateHuman,
  useUpdateActor,
} from '../../data/query-hooks'

type HumanRole = 'owner' | 'member'

function parseCapabilities(value: string): string[] {
  return value
    .split(',')
    .map((capability) => capability.trim())
    .filter(Boolean)
}

export function ActorFormDialog({
  actor,
  onClose,
}: {
  actor?: Actor
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const createHuman = useCreateHuman()
  const updateActor = useUpdateActor()
  const [name, setName] = useState(actor?.name ?? '')
  const [role, setRole] = useState<HumanRole>(
    actor?.kind === 'human' && actor.role === 'owner' ? 'owner' : 'member',
  )
  const [capabilities, setCapabilities] = useState(
    (actor?.capabilities ?? []).join(', '),
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const isEdit = actor !== undefined
  const title = isEdit ? '编辑负责人' : '新增负责人'
  const mutationPending = createHuman.isPending || updateActor.isPending

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) {
      setErrors({ name: '请输入姓名' })
      return
    }
    const parsedCapabilities = parseCapabilities(capabilities)
    try {
      if (actor === undefined) {
        await createHuman.mutateAsync({
          name: trimmedName,
          role,
          capabilities: parsedCapabilities,
        })
      } else {
        if (actor.kind !== 'human' || actor.version === undefined) {
          setErrors({ submit: '此负责人缺少可编辑的版本信息' })
          return
        }
        await updateActor.mutateAsync({
          actorId: actor.id,
          input: {
            name: trimmedName,
            role,
            capabilities: parsedCapabilities,
            version: actor.version,
          },
        })
      }
      onClose()
    } catch (error) {
      setErrors({
        submit: error instanceof Error ? error.message : '负责人保存失败',
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
        'button:not([disabled]), input:not([disabled]), select:not([disabled])',
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
      aria-labelledby="actor-form-title"
      aria-modal="true"
      className="project-dialog"
      onKeyDown={handleKeyDown}
      ref={dialogRef}
      role="dialog"
    >
      <form className="project-dialog__panel actor-form" onSubmit={submit}>
        <header>
          <div>
            <p className="project-page__eyebrow">HUMAN</p>
            <h2 id="actor-form-title">{title}</h2>
          </div>
          <Button
            aria-label={`关闭${title}`}
            onClick={onClose}
            variant="ghost"
          >
            关闭
          </Button>
        </header>
        <label>
          类型
          <select aria-label="类型" disabled value="human">
            <option value="human">人类成员</option>
          </select>
        </label>
        <label>
          姓名
          <input
            aria-invalid={Boolean(errors.name)}
            autoFocus
            onChange={(event) => {
              setName(event.target.value)
              setErrors({})
            }}
            required
            value={name}
          />
          {errors.name ? (
            <span className="project-dialog__field-error">{errors.name}</span>
          ) : null}
        </label>
        <label>
          人类角色
          <select
            aria-label="人类角色"
            onChange={(event) => setRole(event.target.value as HumanRole)}
            value={role}
          >
            <option value="owner">负责人</option>
            <option value="member">成员</option>
          </select>
        </label>
        <label>
          能力
          <input
            aria-label="能力"
            aria-describedby="actor-capabilities-help"
            onChange={(event) => setCapabilities(event.target.value)}
            placeholder="例如：planning, research"
            value={capabilities}
          />
          <small id="actor-capabilities-help">多个能力请用逗号分隔，可选。</small>
        </label>
        {errors.submit ? <p role="alert">{errors.submit}</p> : null}
        <footer>
          <Button onClick={onClose}>取消</Button>
          <Button disabled={mutationPending} type="submit" variant="primary">
            {mutationPending
              ? '正在保存…'
              : isEdit ? '保存负责人' : '创建负责人'}
          </Button>
        </footer>
      </form>
    </div>
  )
}
