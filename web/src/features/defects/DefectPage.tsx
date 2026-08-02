import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import {
  EmptyState,
  ErrorState,
  LoadingState,
  RefreshState,
} from '../../components/data/DataState'
import { MetricGrid } from '../../components/layout/MetricGrid'
import { PageHeader } from '../../components/layout/PageHeader'
import { Badge } from '../../components/ui/Badge'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import type { Defect, DefectStatus, Task } from '../../data/domain'
import {
  useCreateTaskFromDefect,
  useDefects,
  useRequirements,
  useTasks,
} from '../../data/query-hooks'
import {
  defectStageForStatus,
  severityLabels,
  severityOrder,
  statusLabels,
  statusOrder,
} from './defect-matrix-config'
import { DefectMatrix } from './DefectMatrix'
import './defects-glass.css'

const terminalStatuses = new Set<DefectStatus>([
  'closed',
  'rejected',
  'not_a_defect',
])

type RelatedState = 'cached' | 'error' | 'pending' | 'success'

function enumRank<T extends string>(order: readonly T[], value: T): number {
  const rank = order.indexOf(value)
  return rank < 0 ? order.length : rank
}

function timestamp(value: string | undefined): number {
  const parsed = Date.parse(value ?? '')
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY
}

// eslint-disable-next-line react-refresh/only-export-components
export function sortDefects(defects: readonly Defect[]): Defect[] {
  return [...defects].sort((left, right) =>
    enumRank(severityOrder, left.severity) -
      enumRank(severityOrder, right.severity) ||
    enumRank(statusOrder, left.status) - enumRank(statusOrder, right.status) ||
    timestamp(left.createdAt ?? left.updatedAt) -
      timestamp(right.createdAt ?? right.updatedAt) ||
    left.id.localeCompare(right.id),
  )
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

// eslint-disable-next-line react-refresh/only-export-components
export function formatUpdatedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Hong_Kong',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function DefectConversionAction({
  defect,
  linkedTask,
}: {
  defect: Defect
  linkedTask?: Task
}) {
  const conversion = useCreateTaskFromDefect()
  const repairTask = conversion.data ?? (
    linkedTask?.id.startsWith('task-fix-') ? linkedTask : undefined
  )

  return (
    <div className="defect-context__conversion">
      {repairTask ? (
        <Link to={`/tasks?selected=${encodeURIComponent(repairTask.id)}`}>
          {repairTask.code} {repairTask.title}
        </Link>
      ) : (
        <button
          className="button button--primary"
          disabled={conversion.isPending}
          onClick={() => conversion.mutate(defect.id)}
          type="button"
        >
          {conversion.isPending ? '正在创建修复任务' : '转为修复任务'}
        </button>
      )}
      {conversion.isError ? (
        <p role="alert">
          {errorMessage(conversion.error, '创建修复任务失败')}
        </p>
      ) : null}
    </div>
  )
}

function DefectContext({
  defect,
  linkedRequirementCode,
  linkedRequirementState,
  linkedTask,
  linkedTaskState,
}: {
  defect: Defect | null
  linkedRequirementCode?: string
  linkedRequirementState: RelatedState
  linkedTask?: Task
  linkedTaskState: RelatedState
}) {
  return (
    <aside
      aria-label="缺陷上下文"
      className="defect-context"
      id="defect-context"
    >
      <header className="defect-context__header">
        <div>
          <small>DEFECT CONTEXT</small>
          <h2>{defect?.title ?? '缺陷上下文'}</h2>
        </div>
        <Badge tone={defect?.severity === 'fatal' ? 'critical' : 'neutral'}>
          {defect ? severityLabels[defect.severity] : '无选择'}
        </Badge>
      </header>

      {defect ? (
        <div className="defect-context__body">
          <dl className="defect-context__details">
            <div><dt>编号</dt><dd>{defect.code}</dd></div>
            <div><dt>严重度</dt><dd>{severityLabels[defect.severity]}</dd></div>
            <div><dt>状态</dt><dd>{statusLabels[defect.status]}</dd></div>
            <div><dt>负责人</dt><dd>{defect.assignee.name}</dd></div>
            <div><dt>更新时间</dt><dd>{formatUpdatedAt(defect.updatedAt)}</dd></div>
          </dl>

          {defect.description?.trim() ? (
            <section className="defect-context__section">
              <h3>描述</h3>
              <p>{defect.description}</p>
            </section>
          ) : null}

          <section className="defect-context__section">
            <h3>复现步骤</h3>
            {defect.reproductionSteps.length > 0 ? (
              <ol aria-label="复现步骤">
                {defect.reproductionSteps.map((step, index) => (
                  <li key={`${index}-${step}`}>{step}</li>
                ))}
              </ol>
            ) : (
              <p>暂无复现步骤</p>
            )}
          </section>

          <section className="defect-context__section">
            <h3>关联工作</h3>
            {linkedTaskState === 'pending' ? (
              <p>任务：正在加载关联任务</p>
            ) : linkedTaskState === 'error' ? (
              <p>任务：关联任务读取失败</p>
            ) : (
              <p>
                任务：{linkedTask
                  ? `${linkedTask.code} ${linkedTask.title}`
                  : '暂无关联任务'}
                {linkedTaskState === 'cached' ? <small> 上次数据</small> : null}
              </p>
            )}
            {linkedRequirementState === 'pending' ? (
              <p>需求：正在加载关联需求</p>
            ) : linkedRequirementState === 'error' ? (
              <p>需求：关联需求读取失败</p>
            ) : (
              <p>
                需求：{linkedRequirementCode ?? '暂无关联需求'}
                {linkedRequirementState === 'cached' ? (
                  <small> 上次数据</small>
                ) : null}
              </p>
            )}
          </section>

          <DefectConversionAction
            defect={defect}
            key={defect.id}
            linkedTask={linkedTask}
          />
        </div>
      ) : (
        <div className="defect-context__empty">
          <strong>暂无缺陷上下文</strong>
          <p>矩阵与分诊队列当前均为空。</p>
        </div>
      )}
    </aside>
  )
}

function TriageQueue({
  defects,
  onSelect,
  selectedDefectId,
}: {
  defects: readonly Defect[]
  onSelect: (defectId: string) => void
  selectedDefectId: string | null
}) {
  return (
    <section aria-label="优先分诊队列" className="defect-triage">
      <header>
        <div>
          <small>PRIORITY TRIAGE</small>
          <h2>优先分诊队列</h2>
        </div>
        <span>Top {Math.min(defects.length, 3)}</span>
      </header>
      {defects.length > 0 ? (
        <ol>
          {defects.slice(0, 3).map((defect) => (
            <li key={defect.id}>
              <button
                aria-controls="defect-context"
                aria-label={`分诊 ${defect.title}`}
                aria-pressed={defect.id === selectedDefectId}
                onClick={() => onSelect(defect.id)}
                type="button"
              >
                <strong>{defect.code} · {severityLabels[defect.severity]}</strong>
                <span>{defect.title}</span>
                <small>
                  {defect.assignee.name} · {statusLabels[defect.status]}
                </small>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p>当前没有待分诊缺陷</p>
      )}
    </section>
  )
}

export function DefectPage() {
  const defectsQuery = useDefects()
  const tasksQuery = useTasks()
  const requirementsQuery = useRequirements()
  const [scope, setScope] = useState<'all' | 'active'>('all')
  const [selectedDefectId, setSelectedDefectId] = useState<string | null>(null)

  const allDefects = useMemo(
    () => sortDefects(defectsQuery.data ?? []),
    [defectsQuery.data],
  )
  const visibleDefects = useMemo(
    () => scope === 'active'
      ? allDefects.filter((defect) => !terminalStatuses.has(defect.status))
      : allDefects,
    [allDefects, scope],
  )
  const selectedDefect = visibleDefects.find(
    (defect) => defect.id === selectedDefectId,
  ) ?? visibleDefects[0] ?? null
  const effectiveSelectedId = selectedDefect?.id ?? null
  const linkedTask = tasksQuery.data?.find(
    (task) => task.id === selectedDefect?.linkedTaskId,
  )
  const linkedRequirement = requirementsQuery.data?.find(
    (requirement) => requirement.id === selectedDefect?.linkedRequirementId,
  )
  const linkedTaskState: RelatedState =
    tasksQuery.isPending && !tasksQuery.data
      ? 'pending'
      : tasksQuery.error && !tasksQuery.data
        ? 'error'
        : tasksQuery.error ? 'cached' : 'success'
  const linkedRequirementState: RelatedState =
    requirementsQuery.isPending && !requirementsQuery.data
      ? 'pending'
      : requirementsQuery.error && !requirementsQuery.data
        ? 'error'
        : requirementsQuery.error ? 'cached' : 'success'
  const cachedFailureSources = [
    ...(linkedTaskState === 'cached' ? ['关联任务'] : []),
    ...(linkedRequirementState === 'cached' ? ['关联需求'] : []),
  ]
  const summary = {
    severe: visibleDefects.filter(({ severity }) =>
      severity === 'fatal' || severity === 'serious',
    ).length,
    pending: visibleDefects.filter(({ status }) =>
      defectStageForStatus(status) === 'pending',
    ).length,
    repairing: visibleDefects.filter(({ status }) =>
      defectStageForStatus(status) === 'repairing',
    ).length,
    resolved: visibleDefects.filter(({ status }) =>
      defectStageForStatus(status) === 'resolved',
    ).length,
  }

  if (defectsQuery.isPending && !defectsQuery.data) {
    return <section className="defect-page"><LoadingState /></section>
  }
  if (defectsQuery.isError && !defectsQuery.data) {
    return (
      <section className="defect-page">
        <ErrorState
          error={defectsQuery.error}
          isRetrying={defectsQuery.isFetching}
          onRetry={() => defectsQuery.refetch()}
        />
      </section>
    )
  }

  return (
    <section className="defect-page">
      <RefreshState
        dataUpdatedAt={defectsQuery.dataUpdatedAt}
        error={defectsQuery.error}
        isError={defectsQuery.isError}
        isFetching={defectsQuery.isFetching}
      />
      {tasksQuery.isPending || requirementsQuery.isPending ? (
        <p aria-label="正在加载关联工作" className="defect-page__related-state" role="status">
          正在加载关联工作
        </p>
      ) : null}
      {cachedFailureSources.length > 0 ? (
        <div aria-label="关联数据刷新失败" className="defect-page__related-state" role="status">
          <span>关联数据刷新失败，正在显示上次数据：{cachedFailureSources.join('、')}</span>
          <span className="defect-page__related-actions">
            {linkedTaskState === 'cached' ? (
              <button
                className="button button--ghost"
                disabled={tasksQuery.isFetching}
                onClick={() => tasksQuery.refetch()}
                type="button"
              >
                重试关联任务
              </button>
            ) : null}
            {linkedRequirementState === 'cached' ? (
              <button
                className="button button--ghost"
                disabled={requirementsQuery.isFetching}
                onClick={() => requirementsQuery.refetch()}
                type="button"
              >
                重试关联需求
              </button>
            ) : null}
          </span>
        </div>
      ) : null}
      {tasksQuery.isError && !tasksQuery.data ? (
        <div className="defect-page__related-state" role="alert">
          <span>{errorMessage(tasksQuery.error, '关联任务读取失败')}</span>
          <button
            className="button button--ghost"
            disabled={tasksQuery.isFetching}
            onClick={() => tasksQuery.refetch()}
            type="button"
          >
            重试关联任务
          </button>
        </div>
      ) : null}
      {requirementsQuery.isError && !requirementsQuery.data ? (
        <div className="defect-page__related-state" role="alert">
          <span>{errorMessage(requirementsQuery.error, '关联需求读取失败')}</span>
          <button
            className="button button--ghost"
            disabled={requirementsQuery.isFetching}
            onClick={() => requirementsQuery.refetch()}
            type="button"
          >
            重试关联需求
          </button>
        </div>
      ) : null}

      <PageHeader
        actions={(
          <SegmentedControl
            ariaLabel="缺陷范围"
            onChange={(value) => {
              setScope(value as 'all' | 'active')
              setSelectedDefectId(null)
            }}
            options={[
              { label: '全部缺陷', value: 'all' },
              { label: '活跃缺陷', value: 'active' },
            ]}
            value={scope}
          />
        )}
        eyebrow="QUALITY / RISK"
        subtitle="按真实严重度与处理阶段交叉定位缺陷，矩阵与分诊队列共享上下文。"
        title={<span id="defect-page-heading" tabIndex={-1}>缺陷矩阵</span>}
      />

      <MetricGrid ariaLabel="缺陷矩阵指标" className="defect-summary">
        <article className="metric-card">
          <span className="metric-card__label">致命/严重</span>
          <strong className="metric-value">{summary.severe}</strong>
        </article>
        <article className="metric-card">
          <span className="metric-card__label">待处理</span>
          <strong className="metric-value">{summary.pending}</strong>
        </article>
        <article className="metric-card">
          <span className="metric-card__label">修复中</span>
          <strong className="metric-value">{summary.repairing}</strong>
        </article>
        <article className="metric-card">
          <span className="metric-card__label">已解决</span>
          <strong className="metric-value">{summary.resolved}</strong>
        </article>
      </MetricGrid>

      <div className="defect-page__layout" data-testid="defect-layout">
        <section aria-label="缺陷分诊工作区" className="defect-page__stage">
          <header className="defect-page__stage-heading">
            <div>
              <small>SEVERITY × STAGE</small>
              <h2>严重度 × 处理阶段</h2>
            </div>
            <span>4 个真实严重度 · 3 个处理阶段</span>
          </header>
          <div className="defect-page__matrix">
            {allDefects.length === 0 ? (
              <EmptyState title="当前项目暂无缺陷" />
            ) : visibleDefects.length === 0 ? (
              <p className="defect-page__empty">当前范围暂无缺陷</p>
            ) : (
              <DefectMatrix
                defects={visibleDefects}
                onSelect={setSelectedDefectId}
                selectedDefectId={effectiveSelectedId}
              />
            )}
          </div>
          <TriageQueue
            defects={visibleDefects}
            onSelect={setSelectedDefectId}
            selectedDefectId={effectiveSelectedId}
          />
        </section>

        <DefectContext
          defect={selectedDefect}
          linkedRequirementCode={linkedRequirement
            ? `${linkedRequirement.code} ${linkedRequirement.title}`
            : undefined}
          linkedRequirementState={linkedRequirementState}
          linkedTask={linkedTask}
          linkedTaskState={linkedTaskState}
        />
      </div>
    </section>
  )
}
