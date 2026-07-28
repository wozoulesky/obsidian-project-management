import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Progress } from './Progress'

afterEach(cleanup)

describe('Progress', () => {
  it('labels the indicator and clamps values above one hundred', () => {
    const { container } = render(<Progress label="项目进度" value={125} />)

    expect(
      screen.getByRole('progressbar', { name: '项目进度' }),
    ).toBeInTheDocument()
    expect(container.querySelector('.progress > span')).toHaveStyle({
      width: '100%',
    })
  })
})
