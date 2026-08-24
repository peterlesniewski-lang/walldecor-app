import { CalendarConfigurationError } from '@/lib/installations/calendar-adapter'
import { createInstallationCalendarAdapter } from '@/lib/installations/calendar-adapter-factory'
import { readInstallationCalendarConfig } from '@/lib/installations/calendar-server-config'
import { processInstallationCalendarBatch } from '@/lib/installations/calendar-worker'
import { prisma } from '@/lib/prisma'

async function run(): Promise<void> {
  let exitCode = 1
  try {
    const config = readInstallationCalendarConfig(process.env)
    const adapter = createInstallationCalendarAdapter(process.env)
    const result = await processInstallationCalendarBatch(prisma, adapter, config.batchSize)
    console.log(JSON.stringify({ claimed: result.claimed, completed: result.completed, retried: result.retried, attention: result.attention }))
    exitCode = result.attention > 0 ? 2 : 0
  } catch (error) {
    if (error instanceof CalendarConfigurationError) {
      console.error('Installation Calendar worker configuration error.')
    } else {
      console.error('Installation Calendar worker failed safely.')
    }
  } finally {
    try {
      await prisma.$disconnect()
    } catch {
      console.error('Installation Calendar worker could not close its database connection.')
      exitCode = 1
    }
    process.exitCode = exitCode
  }
}

void run()
