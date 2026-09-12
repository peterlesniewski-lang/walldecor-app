import { z } from 'zod'
import { SaxesParser } from 'saxes'
import {
  mapKsefMetadataToInvoice,
  type KsefInvoiceMetadata,
} from '@/lib/finance/ksef-client'
import {
  invoiceDraftDataSchema,
  type InvoiceDraftData,
} from '@/lib/invoice-import/contracts'
import {
  normalizeInvoiceNumberForComparison,
  normalizeSupplierNameForComparison,
  normalizeTaxIdForComparison,
} from '@/lib/invoice-import/identity'

const documentStatusSchema = z.enum(['ACTIVE', 'CORRECTED', 'CORRECTION', 'CANCELLED'])
const documentTypeSchema = z.enum(['INVOICE', 'CORRECTION', 'CREDIT_NOTE', 'PROFORMA', 'OTHER'])
const paymentStatusSchema = z.enum(['PAID', 'UNPAID', 'PARTIAL', 'UNKNOWN'])

function hasNoAsciiControlCharacters(value: string): boolean {
  return !Array.from(value).some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })
}

export const ksefReconciliationSnapshotSchema = z.strictObject({
  externalId: z.string().trim().min(1).max(191).refine(hasNoAsciiControlCharacters),
  documentStatus: documentStatusSchema,
  data: z.strictObject({
    documentType: documentTypeSchema,
    supplierName: z.string().trim().min(1).max(500),
    taxId: z.string().trim().min(1).max(64).nullable(),
    invoiceNumber: z.string().trim().min(1).max(160),
    issueDate: z.iso.date(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    gross: z.number().finite(),
    net: z.number().finite().nullable(),
    vat: z.number().finite().nullable(),
    dueDate: z.iso.date().nullable(),
    bankAccount: z.string().trim().min(1).max(100).nullable(),
    paymentStatus: paymentStatusSchema,
    paidAt: z.iso.date().nullable(),
  }),
}).superRefine((snapshot, context) => {
  const expectedDocumentType = snapshot.documentStatus === 'ACTIVE'
    ? 'INVOICE'
    : snapshot.documentStatus === 'CANCELLED'
      ? 'OTHER'
      : 'CORRECTION'
  if (snapshot.data.documentType !== expectedDocumentType) {
    context.addIssue({
      code: 'custom',
      path: ['data', 'documentType'],
      message: 'Document type must match KSeF document status',
    })
  }
  if (snapshot.data.paidAt !== null && snapshot.data.paymentStatus !== 'PAID') {
    context.addIssue({
      code: 'custom',
      path: ['data', 'paidAt'],
      message: 'Payment date requires PAID payment status',
    })
  }
})

export type KsefReconciliationSnapshot = z.infer<typeof ksefReconciliationSnapshotSchema>

export type KsefReconciliationField =
  | 'documentStatus'
  | 'documentType'
  | 'supplierName'
  | 'taxId'
  | 'invoiceNumber'
  | 'issueDate'
  | 'currency'
  | 'gross'
  | 'net'
  | 'vat'
  | 'dueDate'
  | 'bankAccount'
  | 'paymentStatus'
  | 'paidAt'

export type KsefReconciliationDifference = {
  field: KsefReconciliationField
  localValue: string | number | null | undefined
  ksefValue: string | number | null
}

export class KsefReconciliationPolicyError extends Error {
  readonly code = 'INVALID_KSEF_SNAPSHOT' as const

  constructor() {
    super('INVALID_KSEF_SNAPSHOT')
    this.name = 'KsefReconciliationPolicyError'
  }
}

const MAX_KSEF_XML_BYTES = 4 * 1024 * 1024
const MAX_KSEF_XML_DEPTH = 128
const isoDateSchema = z.iso.date()

type KnownXmlField =
  | 'Zaplacono'
  | 'ZnacznikZaplatyCzesciowej'
  | 'DataZaplaty'
  | 'TerminPlatnosci'
  | 'TerminPlatnosci/Termin'
  | 'TerminPlatnosciData'
  | 'RachunekBankowy/NrRB'
  | 'RachunekBankowyFaktora/NrRB'

type XmlValues = Record<KnownXmlField, string[]>

const EMPTY_XML_VALUES = (): XmlValues => ({
  Zaplacono: [],
  ZnacznikZaplatyCzesciowej: [],
  DataZaplaty: [],
  TerminPlatnosci: [],
  'TerminPlatnosci/Termin': [],
  TerminPlatnosciData: [],
  'RachunekBankowy/NrRB': [],
  'RachunekBankowyFaktora/NrRB': [],
})

const XML_FIELD_PATHS = new Map<string, KnownXmlField>([
  ['Faktura/Fa/Platnosc/Zaplacono', 'Zaplacono'],
  ['Faktura/Fa/Platnosc/ZnacznikZaplatyCzesciowej', 'ZnacznikZaplatyCzesciowej'],
  ['Faktura/Fa/Platnosc/DataZaplaty', 'DataZaplaty'],
  ['Faktura/Fa/Platnosc/TerminPlatnosci', 'TerminPlatnosci'],
  ['Faktura/Fa/Platnosc/TerminPlatnosci/Termin', 'TerminPlatnosci/Termin'],
  ['Faktura/Fa/Platnosc/TerminPlatnosciData', 'TerminPlatnosciData'],
  ['Faktura/Fa/Platnosc/RachunekBankowy/NrRB', 'RachunekBankowy/NrRB'],
  ['Faktura/Fa/Platnosc/RachunekBankowyFaktora/NrRB', 'RachunekBankowyFaktora/NrRB'],
])

type KnownXmlPrefix = {
  field: KnownXmlField | null
  children: Map<string, KnownXmlPrefix>
}

const XML_PREFIX_ROOT: KnownXmlPrefix = { field: null, children: new Map() }
for (const [path, field] of XML_FIELD_PATHS) {
  let prefix = XML_PREFIX_ROOT
  for (const localName of path.split('/')) {
    let child = prefix.children.get(localName)
    if (!child) {
      child = { field: null, children: new Map() }
      prefix.children.set(localName, child)
    }
    prefix = child
  }
  prefix.field = field
}

function normalizedScalar(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

/**
 * The streaming parser validates XML grammar, while this collector retains no
 * document tree and records only the exact FA(3) scalar paths we reconcile.
 */
function knownXmlValues(xml: string | null): XmlValues {
  const values = EMPTY_XML_VALUES()
  if (xml == null) return values
  if (new TextEncoder().encode(xml).byteLength > MAX_KSEF_XML_BYTES) {
    throw new KsefReconciliationPolicyError()
  }
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/iu.test(xml)) {
    throw new KsefReconciliationPolicyError()
  }

  const stack: Array<{
    prefix: KnownXmlPrefix | null
    text: string
    invalid: boolean
  }> = []
  const parser = new SaxesParser<{ xmlns: true; fragment: false }>({
    xmlns: true,
    fragment: false,
  })
  parser.on('error', () => {
    throw new KsefReconciliationPolicyError()
  })
  parser.on('doctype', () => {
    throw new KsefReconciliationPolicyError()
  })
  parser.on('opentag', (tag) => {
    if (stack.length >= MAX_KSEF_XML_DEPTH) throw new KsefReconciliationPolicyError()
    const parent = stack.at(-1)
    if (parent?.prefix?.field) parent.invalid = true
    // Retain only a node in the fixed known-prefix tree. Unknown subtrees stay
    // null, so long untrusted ancestor names are never recopied for descendants.
    const prefix = (parent ? parent.prefix : XML_PREFIX_ROOT)?.children.get(tag.local) ?? null
    stack.push({
      prefix,
      text: '',
      invalid: false,
    })
  })
  parser.on('text', (text) => {
    const current = stack.at(-1)
    if (current?.prefix?.field && !current.invalid) current.text += text
  })
  parser.on('cdata', () => {
    const current = stack.at(-1)
    if (current?.prefix?.field) current.invalid = true
  })
  parser.on('closetag', () => {
    const current = stack.pop()
    if (current?.prefix?.field) {
      values[current.prefix.field].push(current.invalid ? '' : normalizedScalar(current.text))
    }
  })
  parser.write(xml).close()
  return values
}

function validDate(value: string | null | undefined): string | null {
  if (value == null) return null
  const trimmed = value.trim()
  return isoDateSchema.safeParse(trimmed).success ? trimmed : null
}

function firstValidDate(values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const parsed = validDate(value)
    if (parsed) return parsed
  }
  return null
}

function validBoundedString(value: string | null | undefined, max: number): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null
}

function paymentFromXml(values: XmlValues): {
  paymentStatus: KsefReconciliationSnapshot['data']['paymentStatus']
  paidAt: string | null
} {
  const fullyPaid = values.Zaplacono
  const partlyPaid = values.ZnacznikZaplatyCzesciowej
  if (fullyPaid.length > 1 || partlyPaid.length > 1 || (fullyPaid.length > 0 && partlyPaid.length > 0)) {
    return { paymentStatus: 'UNKNOWN', paidAt: null }
  }
  if (fullyPaid.length === 1) {
    if (fullyPaid[0] !== '1') return { paymentStatus: 'UNKNOWN', paidAt: null }
    const paidAt = values.DataZaplaty.length === 1 ? validDate(values.DataZaplaty[0]) : null
    return { paymentStatus: 'PAID', paidAt }
  }
  if (partlyPaid.length === 1) {
    if (partlyPaid[0] === '1') return { paymentStatus: 'PARTIAL', paidAt: null }
    if (partlyPaid[0] === '2') return { paymentStatus: 'PAID', paidAt: null }
  }
  return { paymentStatus: 'UNKNOWN', paidAt: null }
}

function amountInCents(value: number): bigint {
  const [coefficient, exponentText] = Math.abs(value).toString().toLowerCase().split('e')
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
  return value < 0 ? -cents : cents
}

function normalizedBankAccount(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, '').toUpperCase()
}

function addDifference(
  differences: KsefReconciliationDifference[],
  field: KsefReconciliationDifference['field'],
  localValue: KsefReconciliationDifference['localValue'],
  ksefValue: KsefReconciliationDifference['ksefValue'],
): void {
  differences.push({ field, localValue, ksefValue })
}

function documentTypeFromStatus(
  status: KsefReconciliationSnapshot['documentStatus'],
): KsefReconciliationSnapshot['data']['documentType'] {
  if (status === 'ACTIVE') return 'INVOICE'
  if (status === 'CANCELLED') return 'OTHER'
  return 'CORRECTION'
}

function strictDocumentStatusFromMetadata(
  metadata: KsefInvoiceMetadata,
): KsefReconciliationSnapshot['documentStatus'] {
  const explicitStatus = metadata.documentStatus ?? metadata.status
  let parsedExplicitStatus: KsefReconciliationSnapshot['documentStatus'] | null = null
  if (explicitStatus != null) {
    const parsed = documentStatusSchema.safeParse(explicitStatus.trim().toUpperCase())
    if (!parsed.success) throw new KsefReconciliationPolicyError()
    parsedExplicitStatus = parsed.data
  }

  if (parsedExplicitStatus === 'CANCELLED'
    || parsedExplicitStatus === 'CORRECTION'
    || parsedExplicitStatus === 'CORRECTED') {
    return parsedExplicitStatus
  }

  const rawType = (metadata.documentType ?? metadata.invoiceType ?? metadata.formType ?? '')
    .trim()
    .toUpperCase()
  if (/^KOR(?:_|$)/u.test(rawType)) return 'CORRECTION'

  return mapKsefMetadataToInvoice(metadata).documentStatus
}

export function buildKsefReconciliationSnapshot(
  metadata: KsefInvoiceMetadata,
  xml: string | null,
): KsefReconciliationSnapshot {
  try {
    const documentStatus = strictDocumentStatusFromMetadata(metadata)
    const taxId = typeof metadata.seller.nip === 'string'
      ? metadata.seller.nip.trim() || null
      : null
    const supplierName = typeof metadata.seller.name === 'string'
      ? metadata.seller.name.trim() || taxId
      : taxId
    const xmlValues = knownXmlValues(xml)
    const payment = paymentFromXml(xmlValues)
    const dueDate = firstValidDate([
      ...xmlValues['TerminPlatnosci/Termin'],
      ...xmlValues.TerminPlatnosci,
      ...xmlValues.TerminPlatnosciData,
      metadata.paymentDueDate,
      metadata.dueDate,
    ])
    const bankAccount = [
      ...xmlValues['RachunekBankowy/NrRB'],
      ...xmlValues['RachunekBankowyFaktora/NrRB'],
    ].map((value) => validBoundedString(value, 100)).find((value) => value != null)
      ?? validBoundedString(metadata.bankAccount, 100)

    return ksefReconciliationSnapshotSchema.parse({
      externalId: metadata.ksefNumber,
      documentStatus,
      data: {
        documentType: documentTypeFromStatus(documentStatus),
        supplierName,
        taxId,
        invoiceNumber: metadata.invoiceNumber,
        issueDate: metadata.issueDate,
        currency: metadata.currency.trim().toUpperCase(),
        gross: metadata.grossAmount,
        net: metadata.netAmount ?? null,
        vat: metadata.vatAmount ?? null,
        dueDate,
        bankAccount,
        ...payment,
      },
    })
  } catch {
    throw new KsefReconciliationPolicyError()
  }
}

export function compareKsefReconciliation(
  draftData: InvoiceDraftData,
  snapshotInput: KsefReconciliationSnapshot,
): KsefReconciliationDifference[] {
  const current = invoiceDraftDataSchema.parse(draftData)
  const snapshot = ksefReconciliationSnapshotSchema.parse(snapshotInput)
  const incoming = snapshot.data
  const differences: KsefReconciliationDifference[] = []

  if (snapshot.documentStatus !== 'ACTIVE') {
    addDifference(differences, 'documentStatus', null, snapshot.documentStatus)
  }
  if (current.documentType !== incoming.documentType) {
    addDifference(differences, 'documentType', current.documentType, incoming.documentType)
  }

  const currentTaxIdKey = current.taxId == null ? '' : normalizeTaxIdForComparison(current.taxId)
  const incomingTaxIdKey = incoming.taxId == null ? '' : normalizeTaxIdForComparison(incoming.taxId)
  const sameKnownTaxIdentity = currentTaxIdKey !== ''
    && incomingTaxIdKey !== ''
    && currentTaxIdKey === incomingTaxIdKey
  if (!sameKnownTaxIdentity && (
    current.supplierName == null
    || normalizeSupplierNameForComparison(current.supplierName)
      !== normalizeSupplierNameForComparison(incoming.supplierName)
  )) {
    addDifference(differences, 'supplierName', current.supplierName, incoming.supplierName)
  }
  if (incoming.taxId != null && (
    current.taxId == null
    || currentTaxIdKey !== incomingTaxIdKey
  )) {
    addDifference(differences, 'taxId', current.taxId, incoming.taxId)
  }
  if (current.invoiceNumber == null
    || normalizeInvoiceNumberForComparison(current.invoiceNumber)
      !== normalizeInvoiceNumberForComparison(incoming.invoiceNumber)) {
    addDifference(differences, 'invoiceNumber', current.invoiceNumber, incoming.invoiceNumber)
  }
  if (current.issueDate?.normalize('NFKC').trim() !== incoming.issueDate) {
    addDifference(differences, 'issueDate', current.issueDate, incoming.issueDate)
  }
  if (current.currency !== incoming.currency) {
    addDifference(differences, 'currency', current.currency, incoming.currency)
  }
  if (current.gross == null || amountInCents(current.gross) !== amountInCents(incoming.gross)) {
    addDifference(differences, 'gross', current.gross, incoming.gross)
  }
  for (const field of ['net', 'vat'] as const) {
    const ksefValue = incoming[field]
    if (ksefValue != null && (
      current[field] == null || amountInCents(current[field]) !== amountInCents(ksefValue)
    )) {
      addDifference(differences, field, current[field], ksefValue)
    }
  }
  if (incoming.dueDate != null && current.dueDate !== incoming.dueDate) {
    addDifference(differences, 'dueDate', current.dueDate, incoming.dueDate)
  }
  if (incoming.bankAccount != null && (
    current.bankAccount == null
    || normalizedBankAccount(current.bankAccount) !== normalizedBankAccount(incoming.bankAccount)
  )) {
    addDifference(differences, 'bankAccount', current.bankAccount, incoming.bankAccount)
  }
  if (incoming.paymentStatus !== 'UNKNOWN' && current.paymentStatus !== incoming.paymentStatus) {
    addDifference(differences, 'paymentStatus', current.paymentStatus, incoming.paymentStatus)
  }
  if (incoming.paidAt != null && current.paidAt !== incoming.paidAt) {
    addDifference(differences, 'paidAt', current.paidAt, incoming.paidAt)
  }

  return differences
}

function effectiveMoneyChanged(
  previous: number | null | undefined,
  next: number | null | undefined,
): boolean {
  if (previous == null || next == null) return previous !== next
  return amountInCents(previous) !== amountInCents(next)
}

/**
 * Applies only KSeF-owned values. Callers remain responsible for the ADMIN,
 * OPEN-state, optimistic-version, and manual-field protection gates.
 */
export function applyKsefSnapshotToDraft(
  currentInput: InvoiceDraftData,
  snapshotInput: KsefReconciliationSnapshot,
): InvoiceDraftData {
  const current = invoiceDraftDataSchema.parse(currentInput)
  const snapshot = ksefReconciliationSnapshotSchema.parse(snapshotInput)
  const incoming = snapshot.data
  const next: InvoiceDraftData = {
    ...current,
    documentType: incoming.documentType,
    supplierName: incoming.supplierName,
    invoiceNumber: incoming.invoiceNumber,
    issueDate: incoming.issueDate,
    currency: incoming.currency,
    gross: incoming.gross,
  }

  if (incoming.taxId != null) next.taxId = incoming.taxId
  if (incoming.net != null) next.net = incoming.net
  if (incoming.vat != null) next.vat = incoming.vat
  if (incoming.dueDate != null) next.dueDate = incoming.dueDate
  if (incoming.bankAccount != null) next.bankAccount = incoming.bankAccount

  if (incoming.paymentStatus !== 'UNKNOWN') {
    next.paymentStatus = incoming.paymentStatus
    if (incoming.paymentStatus === 'PARTIAL' || incoming.paymentStatus === 'UNPAID') {
      next.paidAt = null
    } else if (incoming.paidAt != null) {
      next.paidAt = incoming.paidAt
    }
  }

  const basisChanged = current.currency !== next.currency
    || effectiveMoneyChanged(current.gross, next.gross)
    || effectiveMoneyChanged(current.net, next.net)
    || effectiveMoneyChanged(current.vat, next.vat)
  if (basisChanged) next.conversionConfirmed = false

  return invoiceDraftDataSchema.parse(next)
}
