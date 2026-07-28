import type { EChartsOption } from 'echarts'
import { useMemo } from 'react'

import type { TrendPoint } from '../../data/domain'
import { EChart } from './EChart'

export type TrendChartProps = {
  points: TrendPoint[]
}

type TooltipDatum = {
  value?: Partial<TrendPoint>
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
  ].join('<br/>')
}

export function TrendChart({ points }: TrendChartProps) {
  const latestPoint = points.at(-1)
  const option = useMemo<EChartsOption>(
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
        textStyle: { color: '#6b7280' },
      },
      tooltip: {
        trigger: 'axis',
        formatter: tooltipFormatter,
      },
      xAxis: {
        type: 'category',
        axisLine: { lineStyle: { color: '#e1e5ea' } },
        axisLabel: { color: '#6b7280' },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisLabel: { color: '#6b7280' },
        splitLine: { lineStyle: { color: '#e1e5ea' } },
      },
      series: [
        {
          name: '实际完成',
          type: 'line',
          encode: { x: 'date', y: 'actual' },
          showSymbol: false,
          lineStyle: { color: '#2f91f7', type: 'solid', width: 2 },
          itemStyle: { color: '#2f91f7' },
          areaStyle: { color: '#2f91f7', opacity: 0.12 },
        },
        {
          name: '计划完成',
          type: 'line',
          encode: { x: 'date', y: 'planned' },
          showSymbol: false,
          lineStyle: { color: '#6b7280', type: 'dashed', width: 2 },
          itemStyle: { color: '#6b7280' },
        },
      ],
    }),
    [points],
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
