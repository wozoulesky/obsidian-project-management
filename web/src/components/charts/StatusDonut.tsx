import type { EChartsCoreOption } from 'echarts/core'
import { useEffect, useMemo, useState } from 'react'

import type { TaskStatus } from '../../data/domain'
import { EChart } from './EChart'

export type TaskStatusCounts = Record<TaskStatus, number>

export type StatusDonutProps = {
  completionRate: number
  counts: TaskStatusCounts
}

const tokenColorFallbacks = {
  critical: '#ff7868',
  grid: '#66716a',
  primary: '#37f58a',
  success: '#72dfa0',
  text: '#8d9791',
  textPrimary: '#f3f7f4',
} as const

const statusPresentation: ReadonlyArray<{
  key: TaskStatus
  label: string
  token: keyof typeof tokenColorFallbacks
}> = [
  { key: 'not_started', label: '未开始', token: 'grid' },
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
      .getPropertyValue(
        token === 'textPrimary' ? '--text-primary' : `--chart-${token}`,
      )
      .trim() || tokenColorFallbacks[token]
  )
}

function useTokenColors() {
  const [, setAppearanceRevision] = useState(0)

  useEffect(() => {
    const root = document.documentElement
    const refresh = () => setAppearanceRevision((revision) => revision + 1)
    const observer = new MutationObserver(refresh)
    observer.observe(root, {
      attributeFilter: ['data-accent', 'data-theme'],
      attributes: true,
    })

    const colorScheme = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null
    colorScheme?.addEventListener('change', refresh)

    return () => {
      observer.disconnect()
      colorScheme?.removeEventListener('change', refresh)
    }
  }, [])

  return {
    critical: resolveTokenColor('critical'),
    grid: resolveTokenColor('grid'),
    primary: resolveTokenColor('primary'),
    success: resolveTokenColor('success'),
    text: resolveTokenColor('text'),
    textPrimary: resolveTokenColor('textPrimary'),
  }
}

export function StatusDonut({
  completionRate,
  counts,
}: StatusDonutProps) {
  const normalizedRate = Number.isFinite(completionRate)
    ? Math.min(100, Math.max(0, Math.round(completionRate)))
    : 0
  const tokenColors = useTokenColors()
  const colors = statusPresentation.map(({ token }) => tokenColors[token])
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
    [colors, counts, normalizedRate, tokenColors.text, tokenColors.textPrimary],
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
