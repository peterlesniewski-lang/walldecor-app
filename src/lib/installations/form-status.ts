export type InstallationFormStatusCode = 'NO_FORM' | 'READY_TO_SEND' | 'WAITING' | 'IN_PROGRESS' | 'COMPLETED'

export type InstallationFormStatus = {
  code: InstallationFormStatusCode
  label: string
  requiresClarification: boolean
}

export type FormStatusFacts = {
  hasSnapshot: boolean
  activeLink: { sentAt: Date | null; lastOpenedAt: Date | null } | null
  hasDraft: boolean
  hasSubmitted: boolean
  openBlockingCount: number
}

const labels = {
  NO_FORM: 'Brak formularza',
  READY_TO_SEND: 'Do wysłania',
  WAITING: 'Wysłany · czeka na klienta',
  IN_PROGRESS: 'Rozpoczęty',
  COMPLETED: 'Wypełniony',
} satisfies Record<InstallationFormStatusCode, string>

export function deriveInstallationFormStatus(facts: FormStatusFacts): InstallationFormStatus {
  const code: InstallationFormStatusCode = !facts.hasSnapshot ? 'NO_FORM'
    : facts.hasSubmitted ? 'COMPLETED'
      : facts.hasDraft || Boolean(facts.activeLink?.lastOpenedAt) ? 'IN_PROGRESS'
        : facts.activeLink?.sentAt ? 'WAITING'
          : 'READY_TO_SEND'
  return { code, label: labels[code], requiresClarification: facts.openBlockingCount > 0 }
}
