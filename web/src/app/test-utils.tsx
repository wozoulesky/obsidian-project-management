import '@testing-library/jest-dom/vitest'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderOptions } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { vi } from 'vitest'

vi.mock('echarts', () => ({
  init: vi.fn(() => ({
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
  })),
}))

class ResizeObserverStub {
  observe() {}

  unobserve() {}

  disconnect() {}
}

globalThis.ResizeObserver =
  ResizeObserverStub as unknown as typeof ResizeObserver

type RenderAppOptions = Omit<RenderOptions, 'wrapper'> & {
  route?: string
}

export function renderApp(
  ui: ReactElement,
  { route = '/', ...options }: RenderAppOptions = {},
) {
  window.history.pushState({}, '', route)

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>{children}</BrowserRouter>
      </QueryClientProvider>
    )
  }

  return render(ui, { wrapper: Wrapper, ...options })
}
