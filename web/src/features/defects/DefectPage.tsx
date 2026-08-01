import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { EntityInspector } from '../../components/data/EntityInspector'
import {
  EmptyState,
  ErrorState,
  LoadingState,
  RefreshState,
} from '../../components/data/DataState'
import { MetricGrid } from '../../components/layout/MetricGrid'
import { PageHeader } from '../../components/layout/PageHeader'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import type {
  Defect,
  DefectStatus,
  Task,
} from '../../data/domain'
import {
  useCreateTaskFromDefect,
  useDefects,
  useRequirements,
  useTasks,
} from '../../data/query-hooks'
import {
  DefectMatrix,
} from './DefectMatrix'
import {
  severityLabels,
  severityOrder,
  statusLabels,
  statusOrder,
} from './defect-matrix-config'
import './defects-glass.css'

const terminalStatuses = new Set<DefectStatus>([
  'closed',
  'rejected',
  'not_a_defect',
])

function enumRank<T extends string>(order: readonly T[], value: T): number {
  const rank = order.indexOf(value)
  return rank < 0 ? order.length : rank
}

// eslint-disable-next-line react-refresh/only-export-components
export function sortDefects(defects: readonly Defect[]): Defect[] {
  return defects
    .map((defect, index) => ({ defect, index }))
    .sort((left, right) => {
      const severityDifference =
        enumRank(severityOrder, left.defect.severity) -
        enumRank(severityOrder, right.defect.severity)
      if (severityDifference !== 0) {
        return severityDifference
      }

      const statusDifference =
        enumRank(statusOrder, left.defect.status) -
        enumRank(statusOrder, right.defect.status)
      if (statusDifference !== 0) {
        return statusDifference
      }

      const updatedDifference =
        Date.parse(right.defect.updatedAt) - Date.parse(left.defect.updatedAt)
      return Number.isFinite(updatedDifference) && updatedDifference !== 0
        ? updatedDifference
        : left.index - right.index
    })
    .map(({ defect }) => defect)
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

// eslint-disable-next-line react-refresh/only-export-components
export function formatUpdatedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Hong_Kong',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function DefectInspector({
  defect,
  fallbackFocusId,
  linkedTask,
  linkedRequirementCode,
  linkedRequirementState,
  linkedTaskState,
  onClose,
}: {
  defect: Defect
  fallbackFocusId: string
  linkedTask?: Task
  linkedRequirementCode?: string
  linkedRequirementState: 'cached' | 'error' | 'pending' | 'success'
  linkedTaskState: 'cached' | 'error' | 'pending' | 'success'
  onClose: () => void
}) {
  return (
    <EntityInspector
      fallbackFocusId={fallbackFocusId}
      onClose={onClose}
      returnFocusId={`defect-trigger-${defect.id}`}
      title={defect.title}
    >
      <div className="defect-inspector">
        <dl className="defect-inspector__details">
          <div>
            <dt>编号</dt>
            <dd>{defect.code}</dd>
          </div>
          <div>
            <dt>严重度</dt>
            <dd>{severityLabels[defect.severity] ?? '未知'}</dd>
          </div>
          <div>
            <dt>状态</dt>
            <dd>{statusLabels[defect.status] ?? '未知'}</dd>
          </div>
          <div>
            <dt>负责人</dt>
            <dd>{defect.assignee.name}</dd>
          </div>
        </dl>

        <section className="defect-inspector__section">
          <h3>复现步骤</h3>
          <ol>
            {defect.reproductionSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>

        <section className="defect-inspector__section">
          <h3>关联工作</h3>
          {linkedTaskState === 'pending' ? (
            <p>任务：正在加载关联任务</p>
          ) : linkedTaskState === 'error' ? (
            <p>任务：关联任务读取失败</p>
          ) : (
            <p>
              任务：
              {linkedTask
                ? `${linkedTask.code} ${linkedTask.title}`
                : '暂无关联任务'}
              {linkedTaskState === 'cached' ? (
                <small> 上次数据</small>
              ) : null}
            </p>
          )}
          {linkedRequirementState === 'pending' ? (
            <p>需求：正在加载关联需求</p>
          ) : linkedRequirementState === 'error' ? (
            <p>需求：关联需求读取失败</p>
          ) : (
            <p>
              需求：
              {linkedRequirementCode ?? '暂无关联需求'}
              {linkedRequirementState === 'cached' ? (
                <small> 上次数据</small>
              ) : null}
            </p>
          )}
        </section>

        <section className="defect-inspector__section">
          <h3>附件</h3>
          <p>暂无附件</p>
        </section>

        <section className="defect-inspector__section">
          <h3>活动日志</h3>
          <p>暂无相关活动</p>
        </section>

        <DefectConversionAction
          defect={defect}
          key={defect.id}
          linkedTask={linkedTask}
        />
      </div>
    </EntityInspector>
  )
}

function DefectConversionAction({
  defect,
  linkedTask,
}: {
  defect: Defect
  linkedTask?: Task
}) {
  const conversion = useCreateTaskFromDefect()
  const repairTask =
    conversion.data?.id === defect.linkedTaskId
      ? conversion.data
      : linkedTask?.id.startsWith('task-fix-')
        ? linkedTask
        : undefined

  return (
    <div className="defect-inspector__conversion">
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
    () =>
      scope === 'active'
        ? allDefects.filter((defect) => !terminalStatuses.has(defect.status))
        : allDefects,
    [allDefects, scope],
  )
  const selectedDefect =
    allDefects.find((defect) => defect.id === selectedDefectId) ?? null
  const linkedTask = tasksQuery.data?.find(
    (task) => task.id === selectedDefect?.linkedTaskId,
  )
  const linkedRequirement = requirementsQuery.data?.find(
    (requirement) => requirement.id === selectedDefect?.linkedRequirementId,
  )
  const linkedTaskState =
    tasksQuery.isPending && !tasksQuery.data
      ? 'pending'
      : tasksQuery.error && !tasksQuery.data
        ? 'error'
        : tasksQuery.error
          ? 'cached'
          : 'success'
  const linkedRequirementState =
    requirementsQuery.isPending && !requirementsQuery.data
      ? 'pending'
      : requirementsQuery.error && !requirementsQuery.data
        ? 'error'
        : requirementsQuery.error
          ? 'cached'
          : 'success'
  const isLinkedWorkPending =
    linkedTaskState === 'pending' || linkedRequirementState === 'pending'
  const cachedFailureSources = [
    ...(linkedTaskState === 'cached' ? ['关联任务'] : []),
    ...(linkedRequirementState === 'cached' ? ['关联需求'] : []),
  ]
  const summary = {
    severe: visibleDefects.filter(
      (defect) =>
        defect.severity === 'fatal' || defect.severity === 'serious',
    ).length,
    open: visibleDefects.filter((defect) => defect.status === 'open').length,
    fixing: visibleDefects.filter((defect) => defect.status === 'fixing')
      .length,
    verifying: visibleDefects.filter((defect) => defect.status === 'verifying')
      .length,
  }

  if (defectsQuery.isPending && !defectsQuery.data) {
    return (
      <section className="defect-page">
        <LoadingState />
      </section>
    )
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
      {isLinkedWorkPending ? (
        <p
          aria-label="正在加载关联工作"
          className="defect-page__related-state"
          role="status"
        >
          正在加载关联工作
        </p>
      ) : null}
      {cachedFailureSources.length > 0 ? (
        <div
          aria-label="关联数据刷新失败"
          className="defect-page__related-state"
          role="status"
        >
          <span>
            关联数据刷新失败，正在显示上次数据：
            {cachedFailureSources.join('、')}
          </span>
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
          <span>
            {errorMessage(
              requirementsQuery.error,
              '关联需求读取失败',
            )}
          </span>
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
              const nextScope = value as 'all' | 'active'
              setScope(nextScope)
              if (
                nextScope === 'active' &&
                selectedDefect &&
                terminalStatuses.has(selectedDefect.status)
              ) {
                setSelectedDefectId(null)
              }
            }}
            options={[
              { label: '全部缺陷', value: 'all' },
              { label: '活跃缺陷', value: 'active' },
            ]}
            value={scope}
          />
        )}
        eyebrow="QUALITY / RISK"
        subtitle="按真实严重度与处置状态交叉定位缺陷，选择卡片进入现有分诊流程。"
        title={(
          <span id="defect-page-heading" tabIndex={-1}>缺陷矩阵</span>
        )}
      />

      <MetricGrid ariaLabel="缺陷矩阵指标" className="defect-summary">
        <article className="metric-card">
          <span className="metric-card__label">致命/严重</span>
          <strong className="metric-value">{summary.severe}</strong>
        </article>
        <article className="metric-card">
          <span className="metric-card__label">待处理</span>
          <strong className="metric-value">{summary.open}</strong>
        </article>
        <article className="metric-card">
          <span className="metric-card__label">修复中</span>
          <strong className="metric-value">{summary.fixing}</strong>
        </article>
        <article className="metric-card">
          <span className="metric-card__label">验证中</span>
          <strong className="metric-value">{summary.verifying}</strong>
        </article>
      </MetricGrid>

      <div className="defect-page__workspace data-grid-with-inspector">
        <div className="defect-page__matrix">
          {allDefects.length === 0 ? (
            <EmptyState title="当前项目暂无缺陷" />
          ) : visibleDefects.length === 0 ? (
            <p className="defect-page__empty">当前范围暂无缺陷</p>
          ) : (
            <DefectMatrix
              defects={visibleDefects}
              onSelect={(defectId) =>
                setSelectedDefectId((current) =>
                  current === defectId ? null : defectId,
                )
              }
              selectedDefectId={selectedDefectId}
            />
          )}
        </div>

        {selectedDefect ? (
          <div id={`defect-inspector-${selectedDefect.id}`}>
            <DefectInspector
              defect={selectedDefect}
              fallbackFocusId="defect-page-heading"
              linkedRequirementCode={
                linkedRequirement
                  ? `${linkedRequirement.code} ${linkedRequirement.title}`
                  : undefined
              }
              linkedRequirementState={linkedRequirementState}
              linkedTask={linkedTask}
              linkedTaskState={linkedTaskState}
              onClose={() => setSelectedDefectId(null)}
            />
          </div>
        ) : null}
      </div>
    </section>
  )
}
