import { parseKsefInvoiceXmlDetails } from '@/lib/finance/ksef-xml-details'

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
  bankAccounts: string[]
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

export function parseKsefInvoiceXmlPreview(xml: string): KsefInvoiceXmlPreview {
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  const parserError = firstByLocalName(document, 'parsererror')
  if (parserError) throw new Error('Nie udało się odczytać XML faktury KSeF.')

  const header = firstByLocalName(document, 'Naglowek')
  const invoice = firstByLocalName(document, 'Fa')
  const details = parseKsefInvoiceXmlDetails(xml)

  return {
    invoiceNumber: text(invoice, 'P_2'),
    issueDate: text(invoice, 'P_1'),
    saleDate: text(invoice, 'P_6'),
    paymentDueDate: details.paymentDueDate,
    bankAccounts: details.bankAccounts,
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
