export class RuntimeStoppingError extends Error {
  constructor() {
    super('Runtime shutdown was requested')
    this.name = 'RuntimeStoppingError'
  }
}

export class RuntimeControl {
  #children = []
  #cleanupQueue = Promise.resolve()
  #signal = 'SIGTERM'
  #stopping = false
  #terminate

  constructor(terminate) {
    this.#terminate = terminate
  }

  get stopping() {
    return this.#stopping
  }

  checkpoint() {
    if (this.#stopping) {
      throw new RuntimeStoppingError()
    }
  }

  add(child) {
    this.checkpoint()
    this.#children.push(child)
  }

  stop(signal = this.#signal) {
    this.#stopping = true
    this.#signal = signal
    const requestedSignal = signal
    const pending = this.#children.splice(0)
    this.#cleanupQueue = this.#cleanupQueue.then(async () => {
      await Promise.all(
        pending.map((child) => this.#terminate(child, requestedSignal)),
      )
    })
    return this.#cleanupQueue
  }
}

export function supervisedExitCode(childCode, shutdownRequested) {
  return shutdownRequested ? 0 : childCode
}
