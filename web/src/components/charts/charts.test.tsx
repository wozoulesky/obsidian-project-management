import { cleanup, render, screen, waitFor } from '@testing-library/react'
import * as echarts from 'echarts/core'
import type { EChartsType, SetOptionOpts } from 'echarts/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EChart } from './EChart'
import { StatusDonut } from './StatusDonut'
import { TrendChart } from './TrendChart'

type ChartOption = Parameters<EChartsType['setOption']>[0]

const chart = {
  setOption: vi.fn<(option: ChartOption, opts?: SetOptionOpts) => void>(),
  resize: vi.fn(),
  dispose: vi.fn(),
}

let resizeCallback: ResizeObserverCallback
const observe = vi.fn()
const disconnect = vi.fn()

const semanticColors = {
  '--chart-critical': 'rgb(220 38 38)',
  '--chart-grid': 'rgb(71 85 105)',
  '--chart-primary': 'rgb(16 185 129)',
  '--chart-success': 'rgb(34 197 94)',
  '--chart-text': 'rgb(148 163 184)',
  '--chart-warning': 'rgb(245 158 11)',
  '--text-primary': 'rgb(241 245 249)',
} as const

function stubSemanticColors(
  colors: Record<string, string> = semanticColors,
) {
  vi.stubGlobal(
    'getComputedStyle',
    vi.fn(() => ({
      getPropertyValue: (property: string) => colors[property] ?? '',
    })),
  )
}

class ResizeObserverMock {
  constructor(callback: ResizeObserverCallback) {
    resizeCallback = callback
  }

  observe = observe
  disconnect = disconnect
}

beforeEach(() => {
  vi.mocked(echarts.init).mockReturnValue(chart as unknown as EChartsType)
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
})

afterEach(() => {
  cleanup()
  document.documentElement.removeAttribute('data-accent')
  document.documentElement.removeAttribute('data-theme')
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('EChart', () => {
  it('disables ECharts animation when reduced motion is preferred', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        addEventListener: vi.fn(),
        matches: true,
        media: '(prefers-reduced-motion: reduce)',
        removeEventListener: vi.fn(),
      })),
    )

    render(
      <EChart
        ariaLabel="低动态趋势"
        option={{ animationDuration: 240, title: { text: 'reduced' } }}
      />,
    )

    expect(chart.setOption).toHaveBeenLastCalledWith(
      expect.objectContaining({
        animation: false,
        animationDuration: 0,
        animationDurationUpdate: 0,
      }),
      { notMerge: true },
    )
  })

  it('initializes, updates, resizes and disposes one chart instance safely', () => {
    const { rerender, unmount } = render(
      <EChart ariaLabel="项目趋势" option={{ title: { text: 'first' } }} />,
    )

    const container = screen.getByRole('img', { name: '项目趋势' })
    expect(echarts.init).toHaveBeenCalledWith(container)
    expect(chart.setOption).toHaveBeenCalledWith(
      { title: { text: 'first' } },
      { notMerge: true },
    )
    expect(observe).toHaveBeenCalledWith(container)

    rerender(
      <EChart ariaLabel="项目趋势" option={{ title: { text: 'second' } }} />,
    )
    expect(echarts.init).toHaveBeenCalledTimes(1)
    expect(chart.setOption).toHaveBeenLastCalledWith(
      { title: { text: 'second' } },
      { notMerge: true },
    )

    resizeCallback([], {} as ResizeObserver)
    expect(chart.resize).toHaveBeenCalledOnce()

    unmount()
    expect(disconnect).toHaveBeenCalledOnce()
    expect(chart.dispose).toHaveBeenCalledOnce()
  })
})

describe('TrendChart', () => {
  it('uses a dataset and keeps actual, planned and difference text accessible', () => {
    stubSemanticColors()
    render(
      <TrendChart
        points={[
          { date: '2026-07-21', actual: 18, planned: 23 },
          { date: '2026-07-28', actual: 34, planned: 40 },
        ]}
      />,
    )

    expect(
      screen.getByText('实际完成 34，计划 40，差值 -6'),
    ).toBeInTheDocument()

    const option = chart.setOption.mock.calls.at(-1)?.[0] as {
      dataset: { source: Array<Record<string, string | number>> }
      series: Array<{
        itemStyle?: { color?: string }
        name: string
        lineStyle?: { color?: string; type?: string }
        areaStyle?: { color?: string; opacity?: number }
      }>
      legend: { textStyle: { color: string } }
      tooltip: {
        formatter: (params: unknown) => string
        renderMode?: string
      }
      xAxis: {
        axisLabel: { color: string }
        axisLine: { lineStyle: { color: string } }
      }
      yAxis: {
        axisLabel: { color: string }
        splitLine: { lineStyle: { color: string } }
      }
    }
    expect(option.dataset.source).toEqual([
      { date: '2026-07-21', actual: 18, planned: 23 },
      { date: '2026-07-28', actual: 34, planned: 40 },
    ])
    expect(option.series[0]).toMatchObject({
      name: '实际完成',
      itemStyle: { color: semanticColors['--chart-primary'] },
      lineStyle: {
        color: semanticColors['--chart-primary'],
        type: 'solid',
      },
      areaStyle: {
        color: semanticColors['--chart-primary'],
        opacity: 0.12,
      },
    })
    expect(option.series[1]).toMatchObject({
      name: '计划完成',
      itemStyle: { color: semanticColors['--chart-warning'] },
      lineStyle: {
        color: semanticColors['--chart-warning'],
        type: 'dashed',
      },
    })
    expect(option.legend.textStyle.color).toBe(semanticColors['--chart-text'])
    expect(option.xAxis.axisLabel.color).toBe(semanticColors['--chart-text'])
    expect(option.yAxis.axisLabel.color).toBe(semanticColors['--chart-text'])
    expect(option.xAxis.axisLine.lineStyle.color).toBe(
      semanticColors['--chart-grid'],
    )
    expect(option.yAxis.splitLine.lineStyle.color).toBe(
      semanticColors['--chart-grid'],
    )
    expect(
      option.tooltip.formatter([
        {
          value: {
            date: '2026-07-28',
            actual: 34,
            planned: 40,
          },
        },
      ]),
    ).toContain('差值：-6')
    const maliciousTooltip = option.tooltip.formatter([
      {
        value: {
          date: '<img src=x onerror=alert(1)>',
          actual: 34,
          planned: 40,
        },
      },
    ])
    expect(option.tooltip.renderMode).toBe('richText')
    expect(maliciousTooltip).toContain('<img src=x onerror=alert(1)>')
    expect(maliciousTooltip).not.toContain('<br')
  })

  it('re-resolves CSS colors when the appearance attributes change', async () => {
    const colors: Record<string, string> = { ...semanticColors }
    stubSemanticColors(colors)
    const points = [{ date: '2026-07-28', actual: 34, planned: 40 }]

    const { rerender } = render(<TrendChart points={points} />)

    const initialOption = chart.setOption.mock.calls.at(-1)?.[0] as {
      series: Array<{ lineStyle: { color: string } }>
    }
    expect(initialOption.series[0]?.lineStyle.color).toBe(
      semanticColors['--chart-primary'],
    )

    const stableCallCount = chart.setOption.mock.calls.length
    rerender(<TrendChart points={points} />)
    expect(chart.setOption).toHaveBeenCalledTimes(stableCallCount)

    colors['--chart-primary'] = 'rgb(192 132 252)'
    document.documentElement.dataset.accent = 'purple'

    await waitFor(() => {
      const nextOption = chart.setOption.mock.calls.at(-1)?.[0] as {
        series: Array<{ lineStyle: { color: string } }>
      }
      expect(nextOption.series[0]?.lineStyle.color).toBe('rgb(192 132 252)')
    })
  })
})

describe('StatusDonut', () => {
  it('shows the completion center and every task status count as text', () => {
    stubSemanticColors()
    const { container } = render(
      <StatusDonut
        counts={{
          not_started: 8,
          in_progress: 7,
          done: 34,
          overdue: 1,
        }}
        completionRate={68}
      />,
    )

    const option = chart.setOption.mock.calls.at(-1)?.[0] as {
      color?: string[]
      title?: {
        subtext?: string
        subtextStyle?: { color?: string }
        text?: string
        textStyle?: { color?: string }
      }
    }
    expect(option.title).toMatchObject({
      text: '68%',
      subtext: '任务完成',
      textStyle: { color: semanticColors['--text-primary'] },
      subtextStyle: { color: semanticColors['--chart-text'] },
    })
    expect(option.color).toEqual([
      semanticColors['--chart-grid'],
      semanticColors['--chart-primary'],
      semanticColors['--chart-success'],
      semanticColors['--chart-critical'],
    ])
    expect(container.querySelector('.status-donut__center')).toBeNull()
    expect(screen.getByText('未开始')).toBeInTheDocument()
    expect(screen.getByText('8')).toBeInTheDocument()
    expect(screen.getByText('进行中')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByText('已完成')).toBeInTheDocument()
    expect(screen.getByText('34')).toBeInTheDocument()
    expect(screen.getByText('已延期')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('keeps options stable until appearance tokens change', async () => {
    const colors: Record<string, string> = { ...semanticColors }
    const counts = {
      not_started: 8,
      in_progress: 7,
      done: 34,
      overdue: 1,
    } as const
    stubSemanticColors(colors)

    const { rerender } = render(
      <StatusDonut completionRate={68} counts={counts} />,
    )
    const initialOption = chart.setOption.mock.calls.at(-1)?.[0] as {
      color: string[]
    }
    expect(initialOption.color[2]).toBe(semanticColors['--chart-success'])

    const stableCallCount = chart.setOption.mock.calls.length
    rerender(<StatusDonut completionRate={68} counts={counts} />)
    expect(chart.setOption).toHaveBeenCalledTimes(stableCallCount)

    colors['--chart-success'] = 'rgb(74 222 128)'
    document.documentElement.dataset.theme = 'dark'

    await waitFor(() => {
      const nextOption = chart.setOption.mock.calls.at(-1)?.[0] as {
        color: string[]
      }
      expect(nextOption.color[2]).toBe('rgb(74 222 128)')
    })
  })
})
