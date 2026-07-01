function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function isoDateTime(date: Date) {
  return date.toISOString().replace('.000Z', 'Z')
}

export function buildKsefSyncDateRanges(syncFrom: string, now = new Date()) {
  const start = syncFrom ? new Date(`${syncFrom}T00:00:00.000Z`) : addDays(now, -30)
  const ranges: Array<{ from: string; to: string }> = []
  let cursor = start

  while (cursor.getTime() <= now.getTime()) {
    const to = new Date(Math.min(addDays(cursor, 89).getTime(), now.getTime()))
    ranges.push({ from: isoDateTime(cursor), to: isoDateTime(to) })
    cursor = addDays(to, 1)
  }

  return ranges
}
