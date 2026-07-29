import { describe, expect, it } from 'vitest'
import * as contracts from './index.js'

describe('shared contracts', () => {
  it('rejects progress outside 0..100', () => {
    expect(
      contracts.taskProgressInputSchema.safeParse({
        progress: 101,
        status: 'in_progress',
        note: '',
        version: 1,
      }).success,
    ).toBe(false)
  })

  it('parses human actors', () => {
    expect(
      contracts.actorSchema.parse({
        id: 'actor-1',
        name: 'Lin',
        kind: 'human',
        role: 'owner',
        status: 'active',
        registeredAt: '2026-07-29T00:00:00.000Z',
        lastActiveAt: null,
        version: 1,
      }),
    ).toMatchObject({
      id: 'actor-1',
      name: 'Lin',
      kind: 'human',
      role: 'owner',
      status: 'active',
      registeredAt: '2026-07-29T00:00:00.000Z',
      lastActiveAt: null,
      version: 1,
    })
  })

  it('exposes project identity and owner fields', () => {
    expect(contracts.projectSchema.shape.ownerId).toBeDefined()
    expect(contracts.projectSchema.shape.id).toBeDefined()
  })
})
