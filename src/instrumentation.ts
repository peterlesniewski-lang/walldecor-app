export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.NEXT_PHASE === 'phase-production-build') return
  // Production runs the schedule by default; KSEF_AUTO_SYNC=off disables it and
  // KSEF_AUTO_SYNC=on enables it in development.
  const mode = process.env.KSEF_AUTO_SYNC
  const ksef = !(mode === 'off' || (process.env.NODE_ENV !== 'production' && mode !== 'on'))
  // The Subiekt bridge read is opt-in everywhere: only SUBIEKT_BRIDGE_AUTO_SYNC=on starts it.
  const subiekt = process.env.SUBIEKT_BRIDGE_AUTO_SYNC === 'on'
  if (!ksef && !subiekt) return

  const { prisma } = await import('@/lib/prisma')
  if (ksef) {
    const { startKsefAutoSyncScheduler } = await import('@/lib/finance/ksef-auto-sync')
    startKsefAutoSyncScheduler(prisma)
  }
  if (subiekt) {
    const { startSubiektAutoSyncScheduler } = await import('@/lib/finance/subiekt-auto-sync')
    startSubiektAutoSyncScheduler(prisma)
  }
}
