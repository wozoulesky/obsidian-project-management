import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GlassPanel } from '../ui/GlassPanel'
import { SegmentedControl } from '../ui/SegmentedControl'
import { MetricGrid } from './MetricGrid'
import { PageHeader } from './PageHeader'

afterEach(cleanup)

describe('shared layout components', () => {
  it('renders a page heading with context, supporting text and actions', () => {
    render(
      <PageHeader
        actions={<button type="button">新建任务</button>}
        eyebrow="PROJECT OS / DASHBOARD"
        subtitle="项目健康"
        title="全局驾驶舱"
      />,
    )

    expect(
      screen.getByRole('heading', { level: 1, name: '全局驾驶舱' }),
    ).toBeVisible()
    expect(screen.getByText('PROJECT OS / DASHBOARD')).toBeVisible()
    expect(screen.getByText('项目健康')).toBeVisible()
    expect(screen.getByRole('button', { name: '新建任务' })).toBeVisible()
  })

  it('labels a metric collection for assistive technology', () => {
    render(
      <MetricGrid ariaLabel="工作区指标">
        <article>进行中任务</article>
      </MetricGrid>,
    )

    expect(
      screen.getByRole('group', { name: '工作区指标' }),
    ).toHaveTextContent('进行中任务')
  })

  it('supports a labelled semantic section surface', () => {
    render(
      <GlassPanel ariaLabel="项目风险" as="section">
        风险内容
      </GlassPanel>,
    )

    const panel = screen.getByRole('region', { name: '项目风险' })
    expect(panel.tagName).toBe('SECTION')
    expect(panel).toHaveTextContent('风险内容')
  })

  it('exposes segmented choices as pressed buttons and reports selection', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <SegmentedControl
        ariaLabel="范围"
        onChange={onChange}
        options={[
          { label: '全部', value: 'all' },
          { label: '本周', value: 'week' },
        ]}
        value="all"
      />,
    )

    expect(screen.getByRole('group', { name: '范围' })).toBeVisible()
    expect(screen.getByRole('button', { name: '全部' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: '本周' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )

    await user.click(screen.getByRole('button', { name: '本周' }))

    expect(onChange).toHaveBeenCalledWith('week')
  })
})
