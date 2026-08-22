import { once } from 'node:events'

function serverExitError(runningServer) {
  const { exitCode, signalCode } = runningServer.server
  if (exitCode !== null && exitCode !== undefined) {
    return new Error(`Serwer walidatora zakończył się kodem ${exitCode}: ${runningServer.output()}`)
  }
  return new Error(`Serwer walidatora zakończył się sygnałem ${signalCode}: ${runningServer.output()}`)
}

/**
 * SIGTERM is valid only when this helper sent it. A process that already
 * stopped, crashed, or received another signal remains a validator failure.
 */
export async function stopServerGracefully(runningServer, assertPortReleased) {
  const { server } = runningServer
  if (server.exitCode !== null || server.signalCode !== null) {
    throw serverExitError(runningServer)
  }

  const exit = once(server, 'exit')
  if (!server.kill('SIGTERM')) {
    throw new Error(`Nie udało się wysłać SIGTERM do serwera walidatora: ${runningServer.output()}`)
  }
  const [code, signal] = await exit
  if (code !== 0 && signal !== 'SIGTERM') {
    throw new Error(`Serwer walidatora zatrzymał się niepoprawnie (kod ${code}, sygnał ${signal}): ${runningServer.output()}`)
  }
  await assertPortReleased()
}
