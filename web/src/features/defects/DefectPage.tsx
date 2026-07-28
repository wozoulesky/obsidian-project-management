import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { EntityInspector } from '../../components/data/EntityInspector'
import type {
  Defect,
  DefectStatus,
  Severity,
  Task,
} from '../../data/domain'
import {
  useCreateTaskFromDefect,
  useDefects,
  useRequirements,
  useTasks,
} from '../../data/query-hooks'

const severityOrder = [
  'fatal',
  'serious',
  'normal',
  'suggestion',
] as const satisfies readonly Severity[]
const statusOrder = [
  'open',
  'fixing',
  'verifying',
  'closed',
  'rejected',
  'not_a_defect',
] as const satisfies readonly DefectStatus[]
const terminalStatuses = new Set<DefectStatus>([
  'closed',
  'rejected',
  'not_a_defect',
])

const severityLabels: Record<Severity, string> = {
  fatal: '致命',
  serious: '严重',
  normal: '一般',
  suggestion: '建议',
}

const statusLabels: Record<DefectStatus, string> = {
  open: '待处理',
  fixing: '修复中',
  verifying: '验证中',
  closed: '已关闭',
  rejected: '已驳回',
  not_a_defect: '非缺陷',
}

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

function formatUpdatedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return new Intl.DateTimeFormat('zh-CN', {
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
  onClose,
}: {
  defect: Defect
  fallbackFocusId: string
  linkedTask?: Task
  linkedRequirementCode?: string
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
          <p>
            任务：
            {linkedTask ? `${linkedTask.code} ${linkedTask.title}` : '暂无关联任务'}
          </p>
          <p>
            需求：
            {linkedRequirementCode ??
              defect.linkedRequirementId ??
              '暂无关联需求'}
          </p>
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

  if (defectsQuery.isPending) {
    return (
      <section className="defect-page" aria-busy="true">
        <p role="status">正在加载缺陷…</p>
      </section>
    )
  }

  if (defectsQuery.isError) {
    return (
      <section className="defect-page">
        <p role="alert">
          {errorMessage(defectsQuery.error, '缺陷数据加载失败')}
        </p>
      </section>
    )
  }

  return (
    <section className="defect-page">
      <header className="defect-page__header">
        <div>
          <p className="defect-page__eyebrow">QUALITY / RISK</p>
          <h1 id="defect-page-heading" tabIndex={-1}>
            缺陷风险队列
          </h1>
        </div>
        <div className="defect-page__scope" aria-label="缺陷范围">
          <button
            aria-pressed={scope === 'all'}
            onClick={() => setScope('all')}
            type="button"
          >
            全部缺陷
          </button>
          <button
            aria-pressed={scope === 'active'}
            onClick={() => {
              setScope('active')
              if (
                selectedDefect &&
                terminalStatuses.has(selectedDefect.status)
              ) {
                setSelectedDefectId(null)
              }
            }}
            type="button"
          >
            活跃缺陷
          </button>
        </div>
      </header>

      <dl className="defect-summary">
        <div>
          <dt>致命/严重</dt>
          <dd>{summary.severe}</dd>
        </div>
        <div>
          <dt>待处理</dt>
          <dd>{summary.open}</dd>
        </div>
        <div>
          <dt>修复中</dt>
          <dd>{summary.fixing}</dd>
        </div>
        <div>
          <dt>验证中</dt>
          <dd>{summary.verifying}</dd>
        </div>
      </dl>

      <div className="defect-page__workspace data-grid-with-inspector">
        <div className="defect-table data-grid">
          {allDefects.length === 0 ? (
            <p className="defect-page__empty">暂无缺陷</p>
          ) : visibleDefects.length === 0 ? (
            <p className="defect-page__empty">当前范围暂无缺陷</p>
          ) : (
            <table aria-label="缺陷风险队列">
              <thead>
                <tr>
                  <th scope="col">缺陷</th>
                  <th scope="col">严重度</th>
                  <th scope="col">状态</th>
                  <th scope="col">负责人</th>
                  <th scope="col">更新时间</th>
                </tr>
              </thead>
              <tbody>
                {visibleDefects.map((defect) => (
                  <tr
                    className={
                      defect.id === selectedDefectId ? 'is-selected' : undefined
                    }
                    key={defect.id}
                  >
                    <td>
                      <button
                        aria-controls={`defect-inspector-${defect.id}`}
                        aria-expanded={defect.id === selectedDefectId}
                        aria-label={`查看 ${defect.title}`}
                        className="defect-table__view"
                        id={`defect-trigger-${defect.id}`}
                        onClick={() =>
                          setSelectedDefectId((current) =>
                            current === defect.id ? null : defect.id,
                          )
                        }
                        type="button"
                      >
                        <small>{defect.code}</small>
                        <span>查看 {defect.title}</span>
                      </button>
                    </td>
                    <td>
                      <span
                        className={`defect-severity defect-severity--${defect.severity}`}
                      >
                        {severityLabels[defect.severity] ?? '未知'}
                      </span>
                    </td>
                    <td>{statusLabels[defect.status] ?? '未知'}</td>
                    <td>{defect.assignee.name}</td>
                    <td>
                      <time dateTime={defect.updatedAt}>
                        {formatUpdatedAt(defect.updatedAt)}
                      </time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
              linkedTask={linkedTask}
              onClose={() => setSelectedDefectId(null)}
            />
          </div>
        ) : null}
      </div>
    </section>
  )
}
