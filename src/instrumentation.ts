export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.NEXT_PHASE === 'phase-production-build') return
  // Production runs the schedule by default; KSEF_AUTO_SYNC=off disables it and
  // KSEF_AUTO_SYNC=on enables it in development.
  const mode = process.env.KSEF_AUTO_SYNC
  if (mode === 'off' || (process.env.NODE_ENV !== 'production' && mode !== 'on')) return

  const [{ prisma }, { startKsefAutoSyncScheduler }] = await Promise.all([
    import('@/lib/prisma'),
    import('@/lib/finance/ksef-auto-sync'),
  ])
  startKsefAutoSyncScheduler(prisma)
}
