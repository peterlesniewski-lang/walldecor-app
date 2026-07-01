import { describe, expect, it } from 'vitest'
import { parseKsefInvoiceXmlPreview } from '@/lib/finance/ksef-invoice-preview'

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/">
  <Naglowek>
    <KodFormularza kodSystemowy="FA (3)">FA</KodFormularza>
    <DataWytworzeniaFa>2026-07-01T10:00:00Z</DataWytworzeniaFa>
  </Naglowek>
  <Podmiot1>
    <DaneIdentyfikacyjne>
      <NIP>1234567890</NIP>
      <Nazwa>Sprzedawca Testowy sp. z o.o.</Nazwa>
    </DaneIdentyfikacyjne>
  </Podmiot1>
  <Podmiot2>
    <DaneIdentyfikacyjne>
      <NIP>9876543210</NIP>
      <Nazwa>Wall Decor sp. z o.o.</Nazwa>
    </DaneIdentyfikacyjne>
  </Podmiot2>
  <Fa>
    <P_1>2026-06-30</P_1>
    <P_2>FV/6/2026</P_2>
    <P_6>2026-06-30</P_6>
    <P_13_1>100.00</P_13_1>
    <P_14_1>23.00</P_14_1>
    <P_15>123.00</P_15>
    <Platnosc>
      <TerminPlatnosci>2026-07-14</TerminPlatnosci>
    </Platnosc>
    <Adnotacje>
      <P_16>2</P_16>
    </Adnotacje>
    <FaWiersz>
      <NrWierszaFa>1</NrWierszaFa>
      <P_7>Tapeta dekoracyjna</P_7>
      <P_8A>szt.</P_8A>
      <P_8B>2</P_8B>
      <P_9A>50.00</P_9A>
      <P_11>100.00</P_11>
      <P_12>23</P_12>
    </FaWiersz>
  </Fa>
</Faktura>`

describe('parseKsefInvoiceXmlPreview', () => {
  it('extracts invoice header, parties, totals, and lines from KSeF XML', () => {
    expect(parseKsefInvoiceXmlPreview(xml)).toEqual({
      invoiceNumber: 'FV/6/2026',
      issueDate: '2026-06-30',
      saleDate: '2026-06-30',
      paymentDueDate: '2026-07-14',
      formCode: 'FA',
      seller: { name: 'Sprzedawca Testowy sp. z o.o.', nip: '1234567890' },
      buyer: { name: 'Wall Decor sp. z o.o.', nip: '9876543210' },
      totals: { net: '100.00', vat: '23.00', gross: '123.00' },
      lines: [
        {
          number: '1',
          name: 'Tapeta dekoracyjna',
          unit: 'szt.',
          quantity: '2',
          unitPrice: '50.00',
          netAmount: '100.00',
          vatRate: '23',
        },
      ],
    })
  })
})
