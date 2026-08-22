import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { stopServerGracefully } from '../../../scripts/validate-installation-order-utils.mjs'

class ControlledServer extends EventEmitter {
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  readonly kill = vi.fn((signal: NodeJS.Signals) => {
    queueMicrotask(() => {
      this.signalCode = signal
      this.emit('exit', null, signal)
    })
    return true
  })
}

describe('installation validator server shutdown', () => {
  it('accepts its own SIGTERM and verifies that the port was released', async () => {
    const server = new ControlledServer()
    const assertPortReleased = vi.fn().mockResolvedValue(undefined)

    await expect(stopServerGracefully({ server, output: () => '' }, assertPortReleased)).resolves.toBeUndefined()

    expect(server.kill).toHaveBeenCalledWith('SIGTERM')
    expect(assertPortReleased).toHaveBeenCalledTimes(1)
  })

  it('does not mask a server that crashed before the harness started shutdown', async () => {
    const server = new ControlledServer()
    server.exitCode = 1
    const assertPortReleased = vi.fn()

    await expect(stopServerGracefully({ server, output: () => 'crash output' }, assertPortReleased))
      .rejects.toThrow(/zakończył się kodem 1/)

    expect(server.kill).not.toHaveBeenCalled()
    expect(assertPortReleased).not.toHaveBeenCalled()
  })

  it('rejects a process that exited successfully before the harness sent SIGTERM', async () => {
    const server = new ControlledServer()
    server.exitCode = 0
    const assertPortReleased = vi.fn()

    await expect(stopServerGracefully({ server, output: () => 'already stopped' }, assertPortReleased))
      .rejects.toThrow(/zakończył się kodem 0/)

    expect(server.kill).not.toHaveBeenCalled()
    expect(assertPortReleased).not.toHaveBeenCalled()
  })

  it('accepts a graceful exit only after its own SIGTERM request', async () => {
    const server = new ControlledServer()
    server.kill.mockImplementation((signal: NodeJS.Signals) => {
      queueMicrotask(() => {
        server.exitCode = 0
        server.emit('exit', 0, null)
      })
      return signal === 'SIGTERM'
    })
    const assertPortReleased = vi.fn().mockResolvedValue(undefined)

    await expect(stopServerGracefully({ server, output: () => 'handled signal' }, assertPortReleased))
      .resolves.toBeUndefined()

    expect(server.kill).toHaveBeenCalledWith('SIGTERM')
    expect(assertPortReleased).toHaveBeenCalledTimes(1)
  })

  it('rejects a different signal that arrived before the harness shutdown', async () => {
    const server = new ControlledServer()
    server.signalCode = 'SIGKILL'
    const assertPortReleased = vi.fn()

    await expect(stopServerGracefully({ server, output: () => 'killed' }, assertPortReleased))
      .rejects.toThrow(/sygnałem SIGKILL/)

    expect(server.kill).not.toHaveBeenCalled()
    expect(assertPortReleased).not.toHaveBeenCalled()
  })
})
