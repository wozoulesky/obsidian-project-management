import type { EChartsCoreOption } from 'echarts/core'
import { useMemo } from 'react'

import type { TaskStatus } from '../../data/domain'
import { EChart } from './EChart'
import { useAppearanceTokens } from './useAppearanceTokens'

export type TaskStatusCounts = Record<TaskStatus, number>

export type StatusDonutProps = {
  completionRate: number
  counts: TaskStatusCounts
}

const statusColorTokens = {
  critical: { fallback: '#ff7868', property: '--chart-critical' },
  grid: { fallback: '#66716a', property: '--chart-grid' },
  primary: { fallback: '#37f58a', property: '--chart-primary' },
  success: { fallback: '#72dfa0', property: '--chart-success' },
  text: { fallback: '#8d9791', property: '--chart-text' },
  textPrimary: { fallback: '#f3f7f4', property: '--text-primary' },
} as const

const statusPresentation: ReadonlyArray<{
  key: TaskStatus
  label: string
  token: keyof typeof statusColorTokens
}> = [
  { key: 'not_started', label: '未开始', token: 'grid' },
  { key: 'in_progress', label: '进行中', token: 'primary' },
  { key: 'done', label: '已完成', token: 'success' },
  { key: 'overdue', label: '已延期', token: 'critical' },
]

export function StatusDonut({
  completionRate,
  counts,
}: StatusDonutProps) {
  const normalizedRate = Number.isFinite(completionRate)
    ? Math.min(100, Math.max(0, Math.round(completionRate)))
    : 0
  const tokenColors = useAppearanceTokens(statusColorTokens)
  const colors = useMemo(
    () => statusPresentation.map(({ token }) => tokenColors[token]),
    [tokenColors],
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
          color: tokenColors.textPrimary,
          fontSize: 22,
          fontWeight: 750,
        },
        subtextStyle: {
          color: tokenColors.text,
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
    [colors, counts, normalizedRate, tokenColors],
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
