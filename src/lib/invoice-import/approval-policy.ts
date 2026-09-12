import { invoiceDraftDataSchema, type InvoiceDraftData } from '@/lib/invoice-import/contracts'

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

function roundedAmount(cents: number | null): number | null {
  return cents == null ? null : cents / 100
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

  switch (data.documentType) {
    case 'INVOICE':
      break
    case 'CORRECTION':
      pushIssue(issues, 'documentType', 'CORRECTION_UNSUPPORTED', 'Korekty wymagają osobnej obsługi.')
      break
    case 'CREDIT_NOTE':
      pushIssue(issues, 'documentType', 'CREDIT_NOTE_UNSUPPORTED', 'Noty kredytowe wymagają osobnej obsługi.')
      break
    case 'PROFORMA':
      pushIssue(issues, 'documentType', 'PROFORMA_UNSUPPORTED', 'Proformy nie mogą zostać zatwierdzone jako koszt.')
      break
    case 'OTHER':
      pushIssue(issues, 'documentType', 'OTHER_DOCUMENT_UNSUPPORTED', 'Ten typ dokumentu wymaga osobnej obsługi.')
      break
    case null:
    case undefined:
      pushIssue(issues, 'documentType', 'DOCUMENT_TYPE_REQUIRED', 'Potwierdź, że dokument jest fakturą.')
      break
  }

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
  if (grossCents != null && netCents != null && vatCents != null
    && amountsDifferByMoreThanOneCent(grossCents, netCents, vatCents)) {
    pushIssue(
      issues,
      'gross',
      'NOMINAL_AMOUNT_MISMATCH',
      'Suma kwoty netto i VAT różni się od brutto o więcej niż jeden grosz.',
    )
  }

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
    if (reportingGrossCents != null && reportingNetCents != null && reportingVatCents != null
      && amountsDifferByMoreThanOneCent(
        reportingGrossCents,
        reportingNetCents,
        reportingVatCents,
      )) {
      pushIssue(
        issues,
        'reportingGross',
        'REPORTING_AMOUNT_MISMATCH',
        'Suma kwoty netto i VAT w PLN różni się od brutto w PLN o więcej niż jeden grosz.',
      )
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
