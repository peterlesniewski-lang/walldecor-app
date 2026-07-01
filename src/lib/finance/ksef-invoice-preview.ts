export interface KsefInvoicePreviewParty {
  name: string | null
  nip: string | null
}

export interface KsefInvoicePreviewLine {
  number: string | null
  name: string | null
  unit: string | null
  quantity: string | null
  unitPrice: string | null
  netAmount: string | null
  vatRate: string | null
}

export interface KsefInvoiceXmlPreview {
  invoiceNumber: string | null
  issueDate: string | null
  saleDate: string | null
  paymentDueDate: string | null
  formCode: string | null
  seller: KsefInvoicePreviewParty
  buyer: KsefInvoicePreviewParty
  totals: {
    net: string | null
    vat: string | null
    gross: string | null
  }
  lines: KsefInvoicePreviewLine[]
}

function firstByLocalName(parent: Element | Document, localName: string) {
  return Array.from(parent.getElementsByTagName('*')).find((element) => element.localName === localName) ?? null
}

function allByLocalName(parent: Element | Document, localName: string) {
  return Array.from(parent.getElementsByTagName('*')).filter((element) => element.localName === localName)
}

function text(parent: Element | Document | null, localName: string) {
  if (!parent) return null
  return firstByLocalName(parent, localName)?.textContent?.trim() || null
}

function party(root: Document, localName: 'Podmiot1' | 'Podmiot2'): KsefInvoicePreviewParty {
  const node = firstByLocalName(root, localName)
  return {
    name: text(node, 'Nazwa'),
    nip: text(node, 'NIP') ?? text(node, 'NrVatUE'),
  }
}

const PAYMENT_DUE_DATE_FIELDS = [
  'TerminPlatnosci',
  'TerminPlatnosciData',
  'DataPlatnosci',
  'DataZaplaty',
  'P_6Z',
] as const

function paymentDueDate(invoice: Element | null) {
  if (!invoice) return null

  for (const containerName of ['Platnosc', 'WarunkiPlatnosci']) {
    const container = firstByLocalName(invoice, containerName)
    for (const fieldName of PAYMENT_DUE_DATE_FIELDS) {
      const value = text(container, fieldName)
      if (value) return value
    }
  }

  for (const fieldName of PAYMENT_DUE_DATE_FIELDS) {
    const value = text(invoice, fieldName)
    if (value) return value
  }

  return null
}

export function parseKsefInvoiceXmlPreview(xml: string): KsefInvoiceXmlPreview {
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  const parserError = firstByLocalName(document, 'parsererror')
  if (parserError) throw new Error('Nie udało się odczytać XML faktury KSeF.')

  const header = firstByLocalName(document, 'Naglowek')
  const invoice = firstByLocalName(document, 'Fa')

  return {
    invoiceNumber: text(invoice, 'P_2'),
    issueDate: text(invoice, 'P_1'),
    saleDate: text(invoice, 'P_6'),
    paymentDueDate: paymentDueDate(invoice),
    formCode: text(header, 'KodFormularza'),
    seller: party(document, 'Podmiot1'),
    buyer: party(document, 'Podmiot2'),
    totals: {
      net: text(invoice, 'P_13_1') ?? text(invoice, 'P_13_2') ?? text(invoice, 'P_13_3'),
      vat: text(invoice, 'P_14_1') ?? text(invoice, 'P_14_2') ?? text(invoice, 'P_14_3'),
      gross: text(invoice, 'P_15'),
    },
    lines: allByLocalName(document, 'FaWiersz').map((line) => ({
      number: text(line, 'NrWierszaFa'),
      name: text(line, 'P_7'),
      unit: text(line, 'P_8A'),
      quantity: text(line, 'P_8B'),
      unitPrice: text(line, 'P_9A'),
      netAmount: text(line, 'P_11'),
      vatRate: text(line, 'P_12'),
    })),
  }
}
