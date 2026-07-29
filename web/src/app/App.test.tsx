import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { httpProjectRepository } from '../data/http-project-repository'
import { App } from './App'
import { selectAppRepository } from './app-repository'
import { renderApp } from './test-utils'

describe('App', () => {
  it('fails closed to HTTP unless both E2E mode and fixtures are explicit', () => {
    expect(selectAppRepository('production', 'true'))
      .toBe(httpProjectRepository)
    expect(selectAppRepository('e2e', 'false')).toBe(httpProjectRepository)
    expect(selectAppRepository('e2e', undefined)).toBe(httpProjectRepository)
    expect(selectAppRepository('e2e', 'true'))
      .not.toBe(httpProjectRepository)
  })

  it('uses the shared loading skeleton while a lazy page resolves', () => {
    const { container, unmount } = renderApp(<App />)

    const loadingState = screen.getByRole('status', {
      name: '正在加载仪表盘…',
    })
    expect(loadingState).toHaveClass('data-state--loading')
    expect(loadingState).toHaveAttribute('aria-busy', 'true')
    expect(
      loadingState.querySelector('.data-state__skeleton'),
    ).toBeInTheDocument()
    expect(container.querySelector('.dashboard-page')).not.toHaveAttribute(
      'aria-busy',
    )
    unmount()
  })

  it('uses standard page landmarks without overriding the application role', () => {
    renderApp(<App />)

    expect(screen.queryByRole('application')).not.toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content')
  })
})
