import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { App } from './App'
import { renderApp } from './test-utils'

describe('App', () => {
  it('uses standard page landmarks without overriding the application role', () => {
    renderApp(<App />)

    expect(screen.queryByRole('application')).not.toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content')
  })
})
