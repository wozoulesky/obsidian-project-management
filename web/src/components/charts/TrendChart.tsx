import type { EChartsCoreOption } from 'echarts/core'
import { useEffect, useMemo, useState } from 'react'

import type { TrendPoint } from '../../data/domain'
import { EChart } from './EChart'

export type TrendChartProps = {
  points: TrendPoint[]
}

type TooltipDatum = {
  value?: Partial<TrendPoint>
}

const chartColorFallbacks = {
  grid: '#66716a',
  primary: '#37f58a',
  text: '#8d9791',
  warning: '#eeb66b',
} as const

type ChartColorName = keyof typeof chartColorFallbacks
type ChartColors = Record<ChartColorName, string>

function resolveChartColor(token: ChartColorName): string {
  if (
    typeof document === 'undefined' ||
    typeof getComputedStyle === 'undefined'
  ) {
    return chartColorFallbacks[token]
  }

  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue(`--chart-${token}`)
      .trim() || chartColorFallbacks[token]
  )
}

function useChartColors(): ChartColors {
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
    grid: resolveChartColor('grid'),
    primary: resolveChartColor('primary'),
    text: resolveChartColor('text'),
    warning: resolveChartColor('warning'),
  }
}

function tooltipFormatter(params: unknown): string {
  const first = Array.isArray(params) ? params[0] : params
  const value = (first as TooltipDatum | undefined)?.value
  const date = String(value?.date ?? '')
  const actual = Number(value?.actual ?? 0)
  const planned = Number(value?.planned ?? 0)

  return [
    date,
    `实际完成：${actual}`,
    `计划完成：${planned}`,
    `差值：${actual - planned}`,
  ].join('\n')
}

export function TrendChart({ points }: TrendChartProps) {
  const latestPoint = points.at(-1)
  const colors = useChartColors()
  const option = useMemo<EChartsCoreOption>(
    () => ({
      animationDuration: 240,
      dataset: {
        dimensions: ['date', 'actual', 'planned'],
        source: points.map(({ actual, date, planned }) => ({
          date,
          actual,
          planned,
        })),
      },
      grid: {
        top: 20,
        right: 18,
        bottom: 34,
        left: 42,
      },
      legend: {
        bottom: 0,
        textStyle: { color: colors.text },
      },
      tooltip: {
        trigger: 'axis',
        renderMode: 'richText',
        formatter: tooltipFormatter,
      },
      xAxis: {
        type: 'category',
        axisLine: { lineStyle: { color: colors.grid } },
        axisLabel: { color: colors.text },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisLabel: { color: colors.text },
        splitLine: { lineStyle: { color: colors.grid } },
      },
      series: [
        {
          name: '实际完成',
          type: 'line',
          encode: { x: 'date', y: 'actual' },
          showSymbol: false,
          lineStyle: { color: colors.primary, type: 'solid', width: 2 },
          itemStyle: { color: colors.primary },
          areaStyle: { color: colors.primary, opacity: 0.12 },
        },
        {
          name: '计划完成',
          type: 'line',
          encode: { x: 'date', y: 'planned' },
          showSymbol: false,
          lineStyle: { color: colors.warning, type: 'dashed', width: 2 },
          itemStyle: { color: colors.warning },
        },
      ],
    }),
    [colors, points],
  )

  return (
    <div className="trend-chart">
      <EChart ariaLabel="任务完成趋势图" option={option} />
      {latestPoint ? (
        <p className="visually-hidden">
          实际完成 {latestPoint.actual}，计划 {latestPoint.planned}，差值{' '}
          {latestPoint.actual - latestPoint.planned}
        </p>
      ) : null}
      <ul className="visually-hidden">
        {points.map(({ actual, date, planned }) => (
          <li key={date}>
            {date}：实际完成 {actual}，计划 {planned}，差值 {actual - planned}
          </li>
        ))}
      </ul>
    </div>
  )
}
