import type { ActorService } from '@project-os/core'

export function runAtomicWrite<T>(
  actors: ActorService,
  agentId: string,
  operation: () => T,
): T {
  return actors.runAtomic(() => {
    const result = operation()
    actors.touch(agentId)
    return result
  })
}

export function bestEffortTouch(
  actors: ActorService,
  agentId: string,
): void {
  try {
    actors.touch(agentId)
  } catch {
    // A successful read stays successful if its advisory activity touch fails.
  }
}
