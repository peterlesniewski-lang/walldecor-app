/** Month control fills an inclusive date-only range, independent of host timezone. */
export function monthIssueDateRange(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null
  const lastDay = new Date(`${month}-01T00:00:00.000Z`)
  lastDay.setUTCMonth(lastDay.getUTCMonth() + 1)
  lastDay.setUTCDate(0)
  return { issueDateFrom: `${month}-01`, issueDateTo: lastDay.toISOString().slice(0, 10) }
}
