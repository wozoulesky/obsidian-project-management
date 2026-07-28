import type { EChartsCoreOption } from 'echarts/core'
import { useMemo } from 'react'

import type { TaskStatus } from '../../data/domain'
import { EChart } from './EChart'

export type TaskStatusCounts = Record<TaskStatus, number>

export type StatusDonutProps = {
  completionRate: number
  counts: TaskStatusCounts
}

const tokenColorFallbacks = {
  border: '#e1e5ea',
  critical: '#d9533f',
  primary: '#2f91f7',
  success: '#43be76',
} as const

const statusPresentation: ReadonlyArray<{
  key: TaskStatus
  label: string
  token: keyof typeof tokenColorFallbacks
}> = [
  { key: 'not_started', label: '未开始', token: 'border' },
  { key: 'in_progress', label: '进行中', token: 'primary' },
  { key: 'done', label: '已完成', token: 'success' },
  { key: 'overdue', label: '已延期', token: 'critical' },
]

function resolveTokenColor(
  token: keyof typeof tokenColorFallbacks,
): string {
  if (
    typeof document === 'undefined' ||
    typeof getComputedStyle === 'undefined'
  ) {
    return tokenColorFallbacks[token]
  }

  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue(`--${token}`)
      .trim() || tokenColorFallbacks[token]
  )
}

export function StatusDonut({
  completionRate,
  counts,
}: StatusDonutProps) {
  const normalizedRate = Number.isFinite(completionRate)
    ? Math.min(100, Math.max(0, Math.round(completionRate)))
    : 0
  const colors = useMemo(
    () =>
      statusPresentation.map(({ token }) => resolveTokenColor(token)),
    [],
  )
  const option = useMemo<EChartsCoreOption>(
    () => ({
      color: colors,
      title: {
        text: `${normalizedRate}%`,
        subtext: '任务完成',
        left: 'center',
        top: '34%',
        textStyle: {
          color: '#171b20',
          fontSize: 22,
          fontWeight: 750,
        },
        subtextStyle: {
          color: '#6b7280',
          fontSize: 12,
        },
      },
      tooltip: {
        trigger: 'item',
        formatter: '{b}：{c}',
      },
      series: [
        {
          name: '任务状态',
          type: 'pie',
          radius: ['62%', '82%'],
          center: ['50%', '47%'],
          avoidLabelOverlap: true,
          label: { show: false },
          data: statusPresentation.map(({ key, label }) => ({
            name: label,
            value: counts[key],
          })),
        },
      ],
    }),
    [colors, counts, normalizedRate],
  )

  return (
    <div className="status-donut">
      <div className="status-donut__visual">
        <EChart ariaLabel={`任务状态分布，完成率 ${normalizedRate}%`} option={option} />
      </div>
      <dl className="status-donut__legend">
        {statusPresentation.map(({ key, label }, index) => (
          <div className="status-donut__legend-row" key={key}>
            <dt>
              <span
                aria-hidden="true"
                className="status-donut__swatch"
                style={{ backgroundColor: colors[index] }}
              />
              {label}
            </dt>
            <dd className="tabular-numerals">{counts[key]}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
