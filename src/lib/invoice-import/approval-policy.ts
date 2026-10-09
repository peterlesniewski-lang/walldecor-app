import { invoiceDraftDataSchema, type InvoiceDraftData } from '@/lib/invoice-import/contracts'
import { hasEurSourceCentPrecision, isValidConfirmedEurConversion } from './eur-conversion'

export const INVOICE_IMPORT_REALIZED_COST_CUTOVER_DATE = '2026-04-01'
export const INVOICE_APPROVAL_MAX_AMOUNT = Number.MAX_SAFE_INTEGER / 100
const MAX_SAFE_CENTS = BigInt(Number.MAX_SAFE_INTEGER)

export type ApprovalIssue = {
  field: keyof InvoiceDraftData | '$'
  code: string
  messagePolish: string
}

export type ApprovedInvoiceData = InvoiceDraftData & {
  documentType: 'INVOICE'
  supplierName: string
  invoiceNumber: string
  issueDate: string
  currency: string
  gross: number
  paymentStatus: 'PAID' | 'UNPAID' | 'PARTIAL' | 'UNKNOWN'
  costCenterId: 'JAG' | 'PUL' | 'GLOBAL'
  tagIds: string[]
}

export type InvoiceApprovalResult =
  | {
      ok: true
      data: ApprovedInvoiceData
      reporting: { gross: number; net: number | null; vat: number | null }
    }
  | { ok: false; issues: ApprovalIssue[] }

function schemaIssue(field: keyof InvoiceDraftData | '$'): ApprovalIssue {
  switch (field) {
    case 'currency':
      return { field, code: 'INVALID_CURRENCY', messagePolish: 'Waluta musi mieć trzy wielkie litery.' }
    case 'gross':
    case 'net':
    case 'vat':
    case 'reportingGross':
    case 'reportingNet':
    case 'reportingVat':
      return { field, code: 'INVALID_AMOUNT', messagePolish: 'Kwota musi być poprawną liczbą.' }
    case 'issueDate':
      return { field, code: 'INVALID_ISSUE_DATE', messagePolish: 'Data wystawienia jest nieprawidłowa.' }
    case 'dueDate':
    case 'paidAt':
      return { field, code: 'INVALID_DATE', messagePolish: 'Data jest nieprawidłowa.' }
    case 'supplierName':
      return { field, code: 'INVALID_SUPPLIER_NAME', messagePolish: 'Nazwa dostawcy jest nieprawidłowa.' }
    case 'invoiceNumber':
      return { field, code: 'INVALID_INVOICE_NUMBER', messagePolish: 'Numer faktury jest nieprawidłowy.' }
    case 'taxId':
      return { field, code: 'INVALID_TAX_ID', messagePolish: 'Identyfikator podatkowy jest nieprawidłowy.' }
    case 'paymentStatus':
      return { field, code: 'INVALID_PAYMENT_STATUS', messagePolish: 'Status płatności jest nieprawidłowy.' }
    case 'costCenterId':
      return { field, code: 'INVALID_COST_CENTER', messagePolish: 'Centrum kosztów jest nieprawidłowe.' }
    case 'tagIds':
      return { field, code: 'INVALID_TAG_IDS', messagePolish: 'Lista tagów jest nieprawidłowa.' }
    case 'documentType':
      return { field, code: 'INVALID_DOCUMENT_TYPE', messagePolish: 'Typ dokumentu jest nieprawidłowy.' }
    default:
      return { field, code: 'INVALID_DRAFT', messagePolish: 'Dane szkicu są nieprawidłowe.' }
  }
}

function pushIssue(
  issues: ApprovalIssue[],
  field: keyof InvoiceDraftData,
  code: string,
  messagePolish: string,
): void {
  issues.push({ field, code, messagePolish })
}

function amountToCents(
  field: 'gross' | 'net' | 'vat' | 'reportingGross' | 'reportingNet' | 'reportingVat',
  value: number | null | undefined,
  issues: ApprovalIssue[],
): number | null {
  if (value == null) return null
  if (value < 0) {
    pushIssue(issues, field, 'NEGATIVE_AMOUNT', 'Kwota nie może być ujemna.')
    return null
  }
  if (value > INVOICE_APPROVAL_MAX_AMOUNT) {
    pushIssue(issues, field, 'AMOUNT_OUT_OF_RANGE', 'Kwota przekracza bezpieczny zakres zapisu w groszach.')
    return null
  }

  const [coefficient, exponentText] = value.toString().toLowerCase().split('e')
  const exponent = exponentText == null ? 0 : Number(exponentText)
  const [whole, fraction = ''] = coefficient.split('.')
  const digits = BigInt(`${whole}${fraction}`)
  const digitsToDiscard = fraction.length - exponent - 2
  let cents: bigint

  if (digitsToDiscard <= 0) {
    cents = digits * (BigInt(10) ** BigInt(-digitsToDiscard))
  } else {
    const divisor = BigInt(10) ** BigInt(digitsToDiscard)
    const quotient = digits / divisor
    const remainder = digits % divisor
    cents = quotient + (remainder * BigInt(2) >= divisor ? BigInt(1) : BigInt(0))
  }

  if (cents > MAX_SAFE_CENTS) {
    pushIssue(issues, field, 'AMOUNT_OUT_OF_RANGE', 'Kwota przekracza bezpieczny zakres zapisu w groszach.')
    return null
  }
  return Number(cents)
}

function amountsDifferByMoreThanOneCent(gross: number, net: number, vat: number): boolean {
  const difference = BigInt(net) + BigInt(vat) - BigInt(gross)
  return difference < BigInt(-1) || difference > BigInt(1)
}

const centsFormat = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function formatCents(cents: number, currency: string): string {
  return `${centsFormat.format(cents / 100)}${currency ? ` ${currency}` : ''}`
}

function amountSumIssueFromCents(
  kind: 'NOMINAL' | 'REPORTING',
  grossCents: number | null,
  netCents: number | null,
  vatCents: number | null,
  currency: string,
): ApprovalIssue | null {
  if (grossCents == null || netCents == null || vatCents == null
    || !amountsDifferByMoreThanOneCent(grossCents, netCents, vatCents)) return null
  const amount = (cents: number) => formatCents(cents, currency)
  const sum = `Netto ${amount(netCents)} + VAT ${amount(vatCents)} = ${amount(netCents + vatCents)}`
  const difference = `różnica ${amount(Math.abs(netCents + vatCents - grossCents))}`
  return kind === 'NOMINAL'
    ? {
        field: 'gross',
        code: 'NOMINAL_AMOUNT_MISMATCH',
        messagePolish: `${sum}, a brutto to ${amount(grossCents)} (${difference}). Popraw kwotę brutto albo netto lub VAT w „Danych szczegółowych”.`,
      }
    : {
        field: 'reportingGross',
        code: 'REPORTING_AMOUNT_MISMATCH',
        messagePolish: `${sum}, a brutto w PLN to ${amount(grossCents)} (${difference}). Popraw kwoty w PLN.`,
      }
}

/**
 * Net plus VAT must match gross within one cent. Shared with the review form so
 * the message follows the amounts being edited.
 */
export function invoiceAmountSumIssue(
  kind: 'NOMINAL' | 'REPORTING',
  amounts: { gross: number | null; net: number | null; vat: number | null },
  currency: string,
): ApprovalIssue | null {
  const ignored: ApprovalIssue[] = [] // Invalid amounts are reported by their own fields.
  const [grossField, netField, vatField] = kind === 'NOMINAL'
    ? ['gross', 'net', 'vat'] as const
    : ['reportingGross', 'reportingNet', 'reportingVat'] as const
  return amountSumIssueFromCents(
    kind,
    amountToCents(grossField, amounts.gross, ignored),
    amountToCents(netField, amounts.net, ignored),
    amountToCents(vatField, amounts.vat, ignored),
    currency,
  )
}

function roundedAmount(cents: number | null): number | null {
  return cents == null ? null : cents / 100
}

/** Only a plain invoice can become a cost; every other document type needs separate handling. */
export function documentTypeIssue(documentType: InvoiceDraftData['documentType']): ApprovalIssue | null {
  switch (documentType) {
    case 'INVOICE':
      return null
    case 'CORRECTION':
      return { field: 'documentType', code: 'CORRECTION_UNSUPPORTED', messagePolish: 'Korekty wymagają osobnej obsługi.' }
    case 'CREDIT_NOTE':
      return { field: 'documentType', code: 'CREDIT_NOTE_UNSUPPORTED', messagePolish: 'Noty kredytowe wymagają osobnej obsługi.' }
    case 'PROFORMA':
      return { field: 'documentType', code: 'PROFORMA_UNSUPPORTED', messagePolish: 'Proformy nie mogą zostać zatwierdzone jako koszt.' }
    case 'OTHER':
      return { field: 'documentType', code: 'OTHER_DOCUMENT_UNSUPPORTED', messagePolish: 'Ten typ dokumentu wymaga osobnej obsługi.' }
    case null:
    case undefined:
      return { field: 'documentType', code: 'DOCUMENT_TYPE_REQUIRED', messagePolish: 'Potwierdź, że dokument jest fakturą.' }
  }
}

export function validateInvoiceApproval(input: unknown): InvoiceApprovalResult {
  const parsed = invoiceDraftDataSchema.safeParse(input)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const firstPathPart = issue.path[0]
      const field = typeof firstPathPart === 'string'
        ? firstPathPart as keyof InvoiceDraftData
        : '$'
      return schemaIssue(field)
    })
    return { ok: false, issues }
  }

  const data = parsed.data
  const issues: ApprovalIssue[] = []

  if (!hasEurSourceCentPrecision(data)) {
    pushIssue(issues, 'gross', 'EUR_AMOUNT_PRECISION', 'Kwoty źródłowe EUR muszą mieć dokładność do grosza. Popraw kwoty przed potwierdzeniem kursu.')
  } else if (data.conversion && !isValidConfirmedEurConversion(data)) {
    pushIssue(issues, 'conversion', 'INVALID_EUR_CONVERSION', 'Przeliczenie EUR nie odpowiada dacie płatności, kursowi lub kwotom PLN. Przelicz i potwierdź ponownie.')
  }

  const typeIssue = documentTypeIssue(data.documentType)
  if (typeIssue) issues.push(typeIssue)

  if (data.supplierName == null) {
    pushIssue(issues, 'supplierName', 'SUPPLIER_NAME_REQUIRED', 'Uzupełnij nazwę dostawcy.')
  }
  if (data.invoiceNumber == null) {
    pushIssue(issues, 'invoiceNumber', 'INVOICE_NUMBER_REQUIRED', 'Uzupełnij numer faktury.')
  }
  if (data.issueDate == null) {
    pushIssue(issues, 'issueDate', 'ISSUE_DATE_REQUIRED', 'Uzupełnij datę wystawienia.')
  } else if (data.issueDate < INVOICE_IMPORT_REALIZED_COST_CUTOVER_DATE) {
    pushIssue(
      issues,
      'issueDate',
      'ISSUE_DATE_BEFORE_CUTOVER',
      'Faktury sprzed 1 kwietnia 2026 wymagają osobnej obsługi.',
    )
  }
  if (data.currency == null) {
    pushIssue(issues, 'currency', 'CURRENCY_REQUIRED', 'Uzupełnij walutę faktury.')
  }
  if (data.gross == null) {
    pushIssue(issues, 'gross', 'GROSS_REQUIRED', 'Uzupełnij kwotę brutto.')
  }
  if (data.paymentStatus == null) {
    pushIssue(issues, 'paymentStatus', 'PAYMENT_STATUS_REQUIRED', 'Wybierz status płatności, także gdy jest nieznany.')
  }
  if (data.costCenterId == null) {
    pushIssue(issues, 'costCenterId', 'COST_CENTER_REQUIRED', 'Wybierz centrum kosztów.')
  }
  if (data.tagIds == null || data.tagIds.length === 0) {
    pushIssue(issues, 'tagIds', 'TAG_REQUIRED', 'Wybierz co najmniej jeden tag kosztu.')
  }

  const grossCents = amountToCents('gross', data.gross, issues)
  const netCents = amountToCents('net', data.net, issues)
  const vatCents = amountToCents('vat', data.vat, issues)
  const nominalSumIssue = amountSumIssueFromCents('NOMINAL', grossCents, netCents, vatCents, data.currency ?? '')
  if (nominalSumIssue) issues.push(nominalSumIssue)

  let reportingGrossCents = grossCents
  let reportingNetCents = netCents
  let reportingVatCents = vatCents
  if (data.currency != null && data.currency !== 'PLN') {
    if (data.conversionConfirmed !== true) {
      pushIssue(issues, 'conversionConfirmed', 'FX_CONFIRMATION_REQUIRED', 'Potwierdź przeliczenie waluty na PLN.')
    }
    if (data.reportingGross == null) {
      pushIssue(issues, 'reportingGross', 'REPORTING_GROSS_REQUIRED', 'Uzupełnij kwotę brutto w PLN.')
    }
    if (data.conversionNote == null || data.conversionNote.trim().length < 3) {
      pushIssue(issues, 'conversionNote', 'CONVERSION_NOTE_REQUIRED', 'Opisz sposób przeliczenia na PLN.')
    }

    reportingGrossCents = amountToCents('reportingGross', data.reportingGross, issues)
    reportingNetCents = amountToCents('reportingNet', data.reportingNet, issues)
    reportingVatCents = amountToCents('reportingVat', data.reportingVat, issues)
    // PLN amounts converted at a rate are checked against the EUR amounts above;
    // their own sum may drift by rounding and would only repeat the EUR mismatch.
    const convertedAtRate = data.conversion != null && data.conversion.mode !== 'MANUAL_AMOUNT'
    if (!convertedAtRate) {
      const reportingSumIssue = amountSumIssueFromCents('REPORTING', reportingGrossCents, reportingNetCents, reportingVatCents, 'PLN')
      if (reportingSumIssue) issues.push(reportingSumIssue)
    }
  }

  if (issues.length > 0) return { ok: false, issues }

  const normalizedData = { ...data } as ApprovedInvoiceData
  normalizedData.gross = roundedAmount(grossCents) as number
  if (typeof data.net === 'number') normalizedData.net = roundedAmount(netCents)
  if (typeof data.vat === 'number') normalizedData.vat = roundedAmount(vatCents)
  if (data.currency !== 'PLN') {
    normalizedData.reportingGross = roundedAmount(reportingGrossCents)
    if (typeof data.reportingNet === 'number') {
      normalizedData.reportingNet = roundedAmount(reportingNetCents)
    }
    if (typeof data.reportingVat === 'number') {
      normalizedData.reportingVat = roundedAmount(reportingVatCents)
    }
  }

  return {
    ok: true,
    data: normalizedData,
    reporting: {
      gross: roundedAmount(reportingGrossCents) as number,
      net: roundedAmount(reportingNetCents),
      vat: roundedAmount(reportingVatCents),
    },
  }
}
