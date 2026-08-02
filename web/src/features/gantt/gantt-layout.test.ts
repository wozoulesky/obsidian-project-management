import { describe, expect, it } from 'vitest'

import {
  buildDateProposal,
  dateDeltaFromPixels,
  dateToPercent,
  parseIsoDate,
  shiftDate,
  taskBarLayout,
} from './gantt-layout'

describe('gantt date layout', () => {
  it('maps valid ISO dates to a stable clamped percentage', () => {
    expect(dateToPercent('2026-07-20', '2026-07-20', '2026-07-29')).toBe(0)
    expect(dateToPercent('2026-07-23', '2026-07-20', '2026-07-29')).toBeCloseTo(
      33.33,
      2,
    )
    expect(dateToPercent('2026-08-01', '2026-07-20', '2026-07-29')).toBe(100)
  })

  it('never returns NaN for invalid or reversed ranges', () => {
    expect(dateToPercent('not-a-date', '2026-07-20', '2026-07-29')).toBe(0)
    expect(dateToPercent('2026-07-20', '2026-07-29', '2026-07-20')).toBe(0)
    expect(dateToPercent('2026-07-20', '2026-07-20', '2026-07-20')).toBe(0)
  })

  it('lays out the planned example and protects invalid task dates', () => {
    expect(
      taskBarLayout(
        { startDate: '2026-07-20', dueDate: '2026-07-23' },
        '2026-07-20',
        '2026-07-29',
      ),
    ).toEqual({ left: 0, width: 33.33 })
    expect(
      taskBarLayout(
        { startDate: 'bad', dueDate: 'also-bad' },
        '2026-07-20',
        '2026-07-29',
      ),
    ).toEqual({ left: 0, width: 0 })
  })

  it('hides tasks fully outside the range and clips overlapping tasks', () => {
    expect(
      taskBarLayout(
        { startDate: '2026-07-10', dueDate: '2026-07-19' },
        '2026-07-20',
        '2026-07-29',
      ),
    ).toEqual({ left: 0, width: 0 })
    expect(
      taskBarLayout(
        { startDate: '2026-07-30', dueDate: '2026-08-02' },
        '2026-07-20',
        '2026-07-29',
      ),
    ).toEqual({ left: 0, width: 0 })
    expect(
      taskBarLayout(
        { startDate: '2026-07-18', dueDate: '2026-07-23' },
        '2026-07-20',
        '2026-07-29',
      ),
    ).toEqual({ left: 0, width: 33.33 })
    expect(
      taskBarLayout(
        { startDate: '2026-07-26', dueDate: '2026-08-02' },
        '2026-07-20',
        '2026-07-29',
      ),
    ).toEqual({ left: 66.67, width: 33.33 })
  })

  it('gives a visible in-range instant task a bounded minimum width', () => {
    const layout = taskBarLayout(
      { startDate: '2026-07-29', dueDate: '2026-07-29' },
      '2026-07-20',
      '2026-07-29',
    )

    expect(layout.width).toBeGreaterThan(0)
    expect(layout.left + layout.width).toBeLessThanOrEqual(100)
  })
})

describe('gantt date interactions', () => {
  it('parses and shifts strict ISO dates in years 0000 through 0099', () => {
    expect(parseIsoDate('0000-02-29')).not.toBeNull()
    expect(parseIsoDate('0099-01-31')).not.toBeNull()
    expect(shiftDate('0099-01-31', 1)).toBe('0099-02-01')
  })

  it('uses signed extended ISO dates only for internal range endpoints', () => {
    expect(parseIsoDate('+010000-01-01')).not.toBeNull()
    expect(parseIsoDate('-000001-12-31')).not.toBeNull()
    expect(shiftDate('9999-12-31', 1)).toBe('+010000-01-01')
    expect(shiftDate('+010000-01-01', -1)).toBe('9999-12-31')
    expect(shiftDate('0000-01-01', -1)).toBe('-000001-12-31')
    expect(
      dateToPercent(
        '+010000-01-01',
        '9999-12-31',
        '+010000-01-01',
      ),
    ).toBe(100)
    expect(
      taskBarLayout(
        { startDate: '9999-12-31', dueDate: '9999-12-31' },
        '9999-12-31',
        '+010000-01-01',
      ),
    ).toEqual({ left: 0, width: 1.2 })

    expect(parseIsoDate('10000-01-01')).toBeNull()
    expect(parseIsoDate('+10000-01-01')).toBeNull()
    expect(parseIsoDate('+010000-02-30')).toBeNull()
  })

  it('shifts strict ISO dates in UTC across month boundaries', () => {
    expect(shiftDate('2026-07-31', 1)).toBe('2026-08-01')
    expect(shiftDate('2026-08-01', -1)).toBe('2026-07-31')
    expect(shiftDate('2026-7-31', 1)).toBeNull()
  })

  it('converts pointer movement to whole-day deltas', () => {
    expect(dateDeltaFromPixels(49, 140, 14)).toBe(5)
    expect(dateDeltaFromPixels(-29, 140, 14)).toBe(-3)
    expect(dateDeltaFromPixels(10, 0, 14)).toBe(0)
  })

  it('builds valid move and resize proposals without reversing dates', () => {
    expect(
      buildDateProposal('move', '2026-07-24', '2026-07-28', 1),
    ).toEqual({ startDate: '2026-07-25', dueDate: '2026-07-29' })
    expect(
      buildDateProposal('resize', '2026-07-24', '2026-07-28', -9),
    ).toEqual({ startDate: '2026-07-24', dueDate: '2026-07-24' })
  })
})
