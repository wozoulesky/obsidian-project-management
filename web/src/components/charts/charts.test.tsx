import { cleanup, render, screen } from '@testing-library/react'
import type { EChartsType, SetOptionOpts } from 'echarts'
import * as echarts from 'echarts'
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
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('EChart', () => {
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
        name: string
        lineStyle?: { type?: string }
        areaStyle?: { opacity?: number }
      }>
      tooltip: { formatter: (params: unknown) => string }
    }
    expect(option.dataset.source).toEqual([
      { date: '2026-07-21', actual: 18, planned: 23 },
      { date: '2026-07-28', actual: 34, planned: 40 },
    ])
    expect(option.series[0]).toMatchObject({
      name: '实际完成',
      lineStyle: { type: 'solid' },
      areaStyle: { opacity: 0.12 },
    })
    expect(option.series[1]).toMatchObject({
      name: '计划完成',
      lineStyle: { type: 'dashed' },
    })
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
  })
})

describe('StatusDonut', () => {
  it('shows the completion center and every task status count as text', () => {
    render(
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

    expect(screen.getByText('68%')).toBeInTheDocument()
    expect(screen.getByText('未开始')).toBeInTheDocument()
    expect(screen.getByText('8')).toBeInTheDocument()
    expect(screen.getByText('进行中')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByText('已完成')).toBeInTheDocument()
    expect(screen.getByText('34')).toBeInTheDocument()
    expect(screen.getByText('已延期')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  })
})
