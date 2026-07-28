import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { App } from './App'
import { renderApp } from './test-utils'

describe('App', () => {
  it('exposes the local project management application', () => {
    renderApp(<App />)

    expect(
      screen.getByRole('application', { name: '本地项目管理系统' }),
    ).toBeInTheDocument()
  })
})
