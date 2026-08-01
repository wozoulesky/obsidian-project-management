import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type KeyboardCoordinateGetter,
  type ScreenReaderInstructions,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react'

import { EntityInspector } from '../../components/data/EntityInspector'
import {
  EmptyState,
  ErrorState,
  LoadingState,
  RefreshState,
} from '../../components/data/DataState'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { MetricGrid } from '../../components/layout/MetricGrid'
import { PageHeader } from '../../components/layout/PageHeader'
import type {
  Requirement,
  RequirementStatus,
} from '../../data/domain'
import {
  useRequirements,
  useUpdateRequirementStatus,
} from '../../data/query-hooks'
import './requirements-glass.css'

const boardStates = [
  { status: 'reviewed', label: '评审' },
  { status: 'developing', label: '开发中' },
  { status: 'delivered', label: '已交付' },
] as const satisfies ReadonlyArray<{
  status: RequirementStatus
  label: string
}>

const boardStatusSet = new Set<RequirementStatus>(
  boardStates.map(({ status }) => status),
)

const pipelineStates = [
  { status: 'draft', label: '收集', draggable: false },
  { status: 'reviewed', label: '评审', draggable: true },
  { status: 'developing', label: '开发中', draggable: true },
  { status: 'delivered', label: '已交付', draggable: true },
  { status: 'accepted', label: '已验收', draggable: false },
] as const satisfies ReadonlyArray<{
  status: RequirementStatus
  label: string
  draggable: boolean
}>

const pipelineStatusSet = new Set<RequirementStatus>(
  pipelineStates.map(({ status }) => status),
)

const statusLabels: Record<RequirementStatus, string> = {
  draft: '草稿',
  reviewed: '已评审',
  developing: '开发中',
  delivered: '已交付',
  accepted: '已验收',
  rejected: '已拒绝',
  shelved: '已搁置',
}

type BoardStatus = (typeof boardStates)[number]['status']
type TerminalFilter = 'board' | 'rejected' | 'shelved'
type RequirementStatusInput = {
  requirementId: string
  status: RequirementStatus
}
type StatusCommitCallbacks = {
  onError?: (error: Error) => void
  onSuccess?: () => void
}
type CommitStatus = (
  requirementId: string,
  status: RequirementStatus,
  callbacks?: StatusCommitCallbacks,
) => boolean

const requirementScreenReaderInstructions: ScreenReaderInstructions = {
  draggable:
    '按空格键拿起需求卡片，使用左右方向键切换生命周期列，再按空格键放下；按 Escape 键取消。',
}

// eslint-disable-next-line react-refresh/only-export-components
export function canSuggestDelivery(requirement: Requirement): boolean {
  return (
    requirement.status === 'developing' &&
    requirement.linkedTaskIds.length > 0 &&
    requirement.completedTaskCount === requirement.linkedTaskIds.length
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function getAdjacentBoardStatus(
  status: string,
  key: string,
): BoardStatus | null {
  const currentIndex = boardStates.findIndex(
    (candidate) => candidate.status === status,
  )
  if (currentIndex < 0) {
    return null
  }
  const nextIndex = key === 'ArrowLeft'
    ? currentIndex - 1
    : key === 'ArrowRight'
      ? currentIndex + 1
      : currentIndex

  if (nextIndex === currentIndex) {
    return null
  }
  return boardStates[nextIndex]?.status ?? null
}

const requirementKeyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  { context, currentCoordinates },
) => {
  const currentStatus = context.over &&
    boardStatusSet.has(String(context.over.id) as RequirementStatus)
    ? String(context.over.id)
    : String(context.active?.data.current?.status ?? '')
  const targetStatus = getAdjacentBoardStatus(currentStatus, event.key)
  if (!targetStatus) {
    return undefined
  }

  const currentRect = context.droppableRects.get(currentStatus)
  const targetRect = context.droppableRects.get(targetStatus)
  if (!currentRect || !targetRect) {
    return undefined
  }

  return {
    x: currentCoordinates.x + targetRect.left - currentRect.left,
    y: currentCoordinates.y + targetRect.top - currentRect.top,
  }
}

// eslint-disable-next-line react-refresh/only-export-components
export function createRequirementAnnouncements(
  requirements: Requirement[],
): Announcements {
  const getTitle = (id: UniqueIdentifier) =>
    requirements.find((requirement) => requirement.id === String(id))
      ?.title ?? '当前需求'
  const getStatusLabel = (id: UniqueIdentifier | undefined) => {
    const status = id ? String(id) as RequirementStatus : null
    return status && boardStatusSet.has(status)
      ? statusLabels[status]
      : null
  }

  return {
    onDragStart: ({ active }) => `已拿起需求「${getTitle(active.id)}」。`,
    onDragOver: ({ active, over }) => {
      const label = getStatusLabel(over?.id)
      return label
        ? `需求「${getTitle(active.id)}」已移动到${label}列。`
        : `需求「${getTitle(active.id)}」未位于有效生命周期列。`
    },
    onDragEnd: ({ active, over }) => {
      const label = getStatusLabel(over?.id)
      return label
        ? `已将需求「${getTitle(active.id)}」放入${label}列。`
        : `需求「${getTitle(active.id)}」未发生状态变更。`
    },
    onDragCancel: ({ active }) =>
      `已取消移动需求「${getTitle(active.id)}」。`,
  }
}

// Exported for stable DnD transition tests without pointer-geometry coupling.
// eslint-disable-next-line react-refresh/only-export-components
export function applyRequirementDrop<T>(
  requirements: Requirement[],
  activeId: UniqueIdentifier,
  overId: UniqueIdentifier | null,
  update: (input: RequirementStatusInput) => T,
): T | null {
  if (overId === null) {
    return null
  }

  const requirement = requirements.find(
    (candidate) => candidate.id === String(activeId),
  )
  const status = String(overId) as RequirementStatus

  if (
    !requirement ||
    !boardStatusSet.has(status) ||
    requirement.status === status
  ) {
    return null
  }

  return update({ requirementId: requirement.id, status })
}

function RequirementCardBody({
  onSelect,
  requirement,
  selected,
}: {
  onSelect: (id: string) => void
  requirement: Requirement
  selected: boolean
}) {
  return (
    <>
      <div className="requirement-card__heading">
        <div>
          <small>{requirement.code}</small>
          <h3>{requirement.title}</h3>
        </div>
        <Badge tone={requirement.priority === 'P0' ? 'critical' : 'neutral'}>
          {requirement.priority}
        </Badge>
      </div>
      {canSuggestDelivery(requirement) ? (
        <p className="requirement-card__suggestion">
          关联任务完成后可流转至已交付
        </p>
      ) : null}
      <div className="requirement-card__footer">
        <span>
          {requirement.completedTaskCount}/{requirement.linkedTaskIds.length}
          {' '}任务
        </span>
        <button
          aria-pressed={selected}
          className="requirement-card__view"
          id={`requirement-trigger-${requirement.id}`}
          onClick={() => onSelect(requirement.id)}
          type="button"
        >
          查看 {requirement.title}
        </button>
      </div>
    </>
  )
}

function DraggableRequirementCard({
  disabled,
  onSelect,
  requirement,
  selected,
}: {
  disabled: boolean
  onSelect: (id: string) => void
  requirement: Requirement
  selected: boolean
}) {
  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef,
    transform,
  } = useDraggable({
    id: requirement.id,
    data: { status: requirement.status },
    disabled,
  })
  const style: CSSProperties | undefined = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined

  return (
    <article
      className={`requirement-card${isDragging ? ' is-dragging' : ''}`}
      ref={setNodeRef}
      style={style}
    >
      <button
        {...attributes}
        {...listeners}
        aria-label={`拖动 ${requirement.title}`}
        className="requirement-card__drag-handle"
        disabled={disabled}
        type="button"
      >
        拖动
      </button>
      <RequirementCardBody
        onSelect={onSelect}
        requirement={requirement}
        selected={selected}
      />
    </article>
  )
}

function StaticRequirementCard({
  onSelect,
  requirement,
  selected,
}: {
  onSelect: (id: string) => void
  requirement: Requirement
  selected: boolean
}) {
  return (
    <article className="requirement-card">
      <RequirementCardBody
        onSelect={onSelect}
        requirement={requirement}
        selected={selected}
      />
    </article>
  )
}

function RequirementColumn({
  draggable,
  dragDisabled,
  label,
  onSelect,
  requirements,
  selectedRequirementId,
  status,
}: {
  draggable: boolean
  dragDisabled: boolean
  label: string
  onSelect: (id: string) => void
  requirements: Requirement[]
  selectedRequirementId: string | null
  status: RequirementStatus
}) {
  const { isOver, setNodeRef } = useDroppable({
    disabled: !draggable,
    id: status,
  })

  return (
    <section
      aria-label={`${label}需求`}
      className={`requirement-column${isOver ? ' is-over' : ''}`}
      ref={setNodeRef}
    >
      <header className="requirement-column__header">
        <h2 aria-label={label}>
          {label} <span>{requirements.length}</span>
        </h2>
      </header>
      <div className="requirement-column__cards">
        {requirements.length === 0 ? (
          <p className="requirement-column__empty">暂无需求</p>
        ) : (
          requirements.map((requirement) => draggable ? (
            <DraggableRequirementCard
              disabled={dragDisabled}
              key={requirement.id}
              onSelect={onSelect}
              requirement={requirement}
              selected={selectedRequirementId === requirement.id}
            />
          ) : (
            <StaticRequirementCard
              key={requirement.id}
              onSelect={onSelect}
              requirement={requirement}
              selected={selectedRequirementId === requirement.id}
            />
          ))
        )}
      </div>
    </section>
  )
}

function RequirementInspectorFields({
  commitStatus,
  isStatusPending,
  requirement,
}: {
  commitStatus: CommitStatus
  isStatusPending: boolean
  requirement: Requirement
}) {
  const [status, setStatus] = useState<RequirementStatus>(requirement.status)
  const [formError, setFormError] = useState('')
  const linkedTaskTotal = requirement.linkedTaskIds.length

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError('')
    commitStatus(
      requirement.id,
      status,
      {
        onError: (error) => {
          setFormError(
            error.message || '需求状态保存失败，请稍后重试。',
          )
        },
      },
    )
  }

  return (
    <div className="requirement-inspector">
      <dl className="requirement-inspector__details">
        <div>
          <dt>编号</dt>
          <dd>{requirement.code}</dd>
        </div>
        <div>
          <dt>优先级</dt>
          <dd>{requirement.priority}</dd>
        </div>
      </dl>

      {canSuggestDelivery(requirement) ? (
        <p className="requirement-inspector__suggestion">
          关联任务完成后可流转至已交付
        </p>
      ) : null}

      <section className="requirement-inspector__section">
        <h3>验收标准</h3>
        {requirement.acceptanceCriteria.length > 0 ? (
          <ul>
            {requirement.acceptanceCriteria.map((criterion) => (
              <li key={criterion}>{criterion}</li>
            ))}
          </ul>
        ) : (
          <p>暂无验收标准</p>
        )}
      </section>

      <section className="requirement-inspector__section">
        <h3>关联任务进度</h3>
        <p>
          {requirement.completedTaskCount}/{linkedTaskTotal} 任务已完成
        </p>
        {linkedTaskTotal > 0 ? (
          <progress
            aria-label="关联任务完成比例"
            max={linkedTaskTotal}
            value={requirement.completedTaskCount}
          />
        ) : null}
        {linkedTaskTotal > 0 ? (
          <p className="requirement-inspector__task-ids">
            {requirement.linkedTaskIds.join('、')}
          </p>
        ) : null}
      </section>

      <section className="requirement-inspector__section">
        <h3>活动历史</h3>
        <p>暂无相关活动</p>
      </section>

      <form
        className="requirement-inspector__form"
        onSubmit={handleSubmit}
      >
        <label>
          需求状态
          <select
            onChange={(event) => {
              setStatus(event.target.value as RequirementStatus)
              setFormError('')
            }}
            value={status}
          >
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {formError ? <p role="alert">{formError}</p> : null}
        <Button
          aria-label="保存需求状态"
          disabled={isStatusPending}
          type="submit"
          variant="primary"
        >
          {isStatusPending ? '正在保存…' : '保存状态'}
        </Button>
      </form>
    </div>
  )
}

function RequirementInspector({
  commitStatus,
  isStatusPending,
  onClose,
  requirement,
}: {
  commitStatus: CommitStatus
  isStatusPending: boolean
  onClose: () => void
  requirement: Requirement
}) {
  return (
    <EntityInspector
      fallbackFocusId="requirement-page-heading"
      onClose={onClose}
      returnFocusId={`requirement-trigger-${requirement.id}`}
      title={requirement.title}
    >
      <RequirementInspectorFields
        commitStatus={commitStatus}
        isStatusPending={isStatusPending}
        key={`${requirement.id}-${requirement.status}`}
        requirement={requirement}
      />
    </EntityInspector>
  )
}

export function RequirementPage() {
  const requirementsQuery = useRequirements()
  const updateStatus = useUpdateRequirementStatus()
  const [selectedRequirementId, setSelectedRequirementId] = useState<
    string | null
  >(null)
  const [terminalFilter, setTerminalFilter] =
    useState<TerminalFilter>('board')
  const [dragError, setDragError] = useState('')
  const [isStatusPending, setIsStatusPending] = useState(false)
  const statusPendingRef = useRef(false)
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: requirementKeyboardCoordinates,
    }),
  )
  const commitStatus = useCallback<CommitStatus>(
    (requirementId, status, callbacks = {}) => {
      if (statusPendingRef.current) {
        return false
      }

      statusPendingRef.current = true
      setIsStatusPending(true)
      updateStatus.mutate(
        { requirementId, status },
        {
          onError: (error) => {
            callbacks.onError?.(
              error instanceof Error
                ? error
                : new Error('需求状态更新失败，请稍后重试。'),
            )
          },
          onSuccess: () => {
            callbacks.onSuccess?.()
          },
          onSettled: () => {
            statusPendingRef.current = false
            setIsStatusPending(false)
          },
        },
      )
      return true
    },
    [updateStatus],
  )

  if (requirementsQuery.isPending && !requirementsQuery.data) {
    return (
      <section className="requirement-page">
        <LoadingState />
      </section>
    )
  }

  if (requirementsQuery.isError && !requirementsQuery.data) {
    return (
      <section className="requirement-page">
        <ErrorState
          error={requirementsQuery.error}
          isRetrying={requirementsQuery.isFetching}
          onRetry={() => requirementsQuery.refetch()}
        />
      </section>
    )
  }

  const requirements = requirementsQuery.data ?? []
  const visibleRequirements =
    terminalFilter === 'board'
      ? requirements.filter((requirement) =>
          pipelineStatusSet.has(requirement.status),
        )
      : requirements.filter(
          (requirement) => requirement.status === terminalFilter,
        )
  const selectedRequirement =
    visibleRequirements.find(
      (requirement) => requirement.id === selectedRequirementId,
    ) ?? null
  const developingCount = requirements.filter(
    (requirement) => requirement.status === 'developing',
  ).length
  const acceptedCount = requirements.filter(
    (requirement) => requirement.status === 'accepted',
  ).length

  return (
    <section className="requirement-page">
      <RefreshState
        dataUpdatedAt={requirementsQuery.dataUpdatedAt}
        error={requirementsQuery.error}
        isError={requirementsQuery.isError}
        isFetching={requirementsQuery.isFetching}
      />
      <PageHeader
        actions={(
          <div className="requirement-page__controls">
          <label>
            终态筛选
            <select
              onChange={(event) => {
                setTerminalFilter(event.target.value as TerminalFilter)
                setSelectedRequirementId(null)
              }}
              value={terminalFilter}
            >
              <option value="board">五阶段管线</option>
              <option value="rejected">已拒绝</option>
              <option value="shelved">已搁置</option>
            </select>
          </label>
          </div>
        )}
        eyebrow="计划 / 需求"
        subtitle="从收集到验收追踪真实需求状态，异常终态保留独立筛选。"
        title={(
          <span id="requirement-page-heading" tabIndex={-1}>
            需求管线
          </span>
        )}
      />

      <MetricGrid ariaLabel="需求管线指标" className="requirement-metrics">
        <article className="metric-card">
          <span className="metric-card__label">需求总数</span>
          <strong className="metric-value">{requirements.length}</strong>
        </article>
        <article className="metric-card">
          <span className="metric-card__label">开发中</span>
          <strong className="metric-value">{developingCount}</strong>
        </article>
        <article className="metric-card">
          <span className="metric-card__label">已验收</span>
          <strong className="metric-value">{acceptedCount}</strong>
        </article>
      </MetricGrid>

      <div className="data-grid-with-inspector requirement-page__workspace">
        <div className="requirement-page__content">
          {requirements.length === 0 ? (
          <EmptyState title="当前项目暂无需求" />
          ) : terminalFilter === 'board' ? (
            <DndContext
              accessibility={{
                announcements: createRequirementAnnouncements(requirements),
                screenReaderInstructions: requirementScreenReaderInstructions,
              }}
              onDragEnd={({ active, over }) => {
                if (statusPendingRef.current) {
                  return
                }
                setDragError('')
                applyRequirementDrop(
                  requirements,
                  active.id,
                  over?.id ?? null,
                  (input) => commitStatus(
                    input.requirementId,
                    input.status,
                    {
                      onError: (error) => {
                        setDragError(
                          error.message ||
                            '需求状态更新失败，请稍后重试。',
                        )
                      },
                    },
                  ),
                )
              }}
              sensors={sensors}
            >
              <div className="requirement-page__board-scroll" tabIndex={0}>
                <div className="requirement-board">
                {pipelineStates.map(({ draggable, label, status }) => (
                  <RequirementColumn
                    draggable={draggable}
                    dragDisabled={isStatusPending}
                    key={status}
                    label={label}
                    onSelect={setSelectedRequirementId}
                    requirements={requirements.filter(
                      (requirement) => requirement.status === status,
                    )}
                    selectedRequirementId={selectedRequirementId}
                    status={status}
                  />
                ))}
                </div>
              </div>
            </DndContext>
          ) : (
            <section
              aria-label={`${statusLabels[terminalFilter]}需求`}
              className="requirement-terminal-list"
            >
              <h2>
                {statusLabels[terminalFilter]} <span>{visibleRequirements.length}</span>
              </h2>
              {visibleRequirements.length > 0 ? (
                <div className="requirement-terminal-list__cards">
                  {visibleRequirements.map((requirement) => (
                    <StaticRequirementCard
                      key={requirement.id}
                      onSelect={setSelectedRequirementId}
                      requirement={requirement}
                      selected={selectedRequirementId === requirement.id}
                    />
                  ))}
                </div>
              ) : (
                <p className="requirement-page__empty">
                  当前没有{statusLabels[terminalFilter]}需求。
                </p>
              )}
            </section>
          )}
          {dragError ? <p role="alert">{dragError}</p> : null}
        </div>
        {selectedRequirement ? (
          <RequirementInspector
            commitStatus={commitStatus}
            isStatusPending={isStatusPending}
            onClose={() => setSelectedRequirementId(null)}
            requirement={selectedRequirement}
          />
        ) : null}
      </div>
    </section>
  )
}
