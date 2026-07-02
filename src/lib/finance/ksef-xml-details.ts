export interface KsefInvoiceXmlDetails {
  paymentDueDate: string | null
  bankAccounts: string[]
}

const PAYMENT_DUE_DATE_FIELDS = [
  'TerminPlatnosciData',
] as const

function tagContents(xml: string, localName: string) {
  const pattern = new RegExp(`<(?:[\\w.-]+:)?${localName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${localName}>`, 'gi')
  return Array.from(xml.matchAll(pattern), (match) => match[1] ?? '')
}

function textContent(xml: string) {
  return xml
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function extractDate(value: string | null | undefined) {
  const match = value?.match(/\b\d{4}-\d{2}-\d{2}\b/)
  return match?.[0] ?? null
}

function firstDateFromTags(xml: string, localName: string) {
  for (const content of tagContents(xml, localName)) {
    const value = extractDate(textContent(content))
    if (value) return value
  }
  return null
}

export function normalizeKsefBankAccount(value: string | null | undefined) {
  const normalized = value?.replace(/\s+/g, '').toUpperCase() ?? ''
  return normalized.length >= 10 ? normalized : null
}

function bankAccountsFromXml(xml: string) {
  const accounts: string[] = []

  for (const accountContainerName of ['RachunekBankowy', 'RachunekBankowyFaktora']) {
    for (const accountContainer of tagContents(xml, accountContainerName)) {
      for (const number of tagContents(accountContainer, 'NrRB')) {
        const normalized = normalizeKsefBankAccount(textContent(number))
        if (normalized && !accounts.includes(normalized)) accounts.push(normalized)
      }
    }
  }

  return accounts
}

function paymentDueDateFromXml(xml: string) {
  for (const containerName of ['Platnosc', 'WarunkiPlatnosci']) {
    for (const container of tagContents(xml, containerName)) {
      for (const paymentTerm of tagContents(container, 'TerminPlatnosci')) {
        const explicitTerm = firstDateFromTags(paymentTerm, 'Termin')
        if (explicitTerm) return explicitTerm

        if (!/<[^/?!][^>]*>/.test(paymentTerm)) {
          const directTerm = extractDate(textContent(paymentTerm))
          if (directTerm) return directTerm
        }
      }

      for (const fieldName of PAYMENT_DUE_DATE_FIELDS) {
        const value = firstDateFromTags(container, fieldName)
        if (value) return value
      }
    }
  }

  for (const fieldName of PAYMENT_DUE_DATE_FIELDS) {
    const value = firstDateFromTags(xml, fieldName)
    if (value) return value
  }

  return null
}

export function parseKsefInvoiceXmlDetails(xml: string): KsefInvoiceXmlDetails {
  return {
    paymentDueDate: paymentDueDateFromXml(xml),
    bankAccounts: bankAccountsFromXml(xml),
  }
}
