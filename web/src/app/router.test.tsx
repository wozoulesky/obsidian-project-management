import { cleanup, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { renderApp } from './test-utils'
import { AppRoutes } from './router'

afterEach(cleanup)

describe('AppRoutes', () => {
  it.each([
    ['/projects', '全部项目'],
    ['/actors', '负责人'],
    ['/settings', '设置'],
  ])('renders the accessible %s route shell', async (route, heading) => {
    renderApp(<AppRoutes />, { route })

    expect(
      await screen.findByRole('heading', { level: 1, name: heading }),
    ).toBeInTheDocument()
  })
})
