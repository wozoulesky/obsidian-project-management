import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { App } from './App'
import { renderApp } from './test-utils'

describe('App', () => {
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
