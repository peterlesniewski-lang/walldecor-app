import { NextResponse } from 'next/server'
import { AiHttpError } from '@/lib/ai/http-common'
import { InvoiceApprovalError } from './approval-service'
import { ClosedInvoicePeriodsError } from './closed-periods'
import { InvoiceDocumentProcessorError } from './document-processor'
import { InvoiceImportError } from './errors'
import { InvoiceOriginalUnavailableError } from './file-service'
import { InstallationMultipartError } from '@/lib/installation-media/multipart'
import { InvoiceFilesConfigurationError } from './files-runtime'
import { NbpRateError } from './nbp-rate'

export const INVOICE_HTTP_HEADERS = { 'Cache-Control': 'private, no-store' }

export class InvoiceImportHttpError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code)
    this.name = 'InvoiceImportHttpError'
  }
}

const MESSAGES: Record<string, string> = {
  EUR_AMOUNT_PRECISION: 'Kwoty źródłowe EUR muszą mieć dokładność do grosza. Popraw kwoty przed potwierdzeniem kursu.',
  NBP_INVALID_DATE: 'Wybierz poprawną datę płatności, nie późniejszą niż dziś, lub przelicz ręcznie.',
  NBP_INVALID_RESPONSE: 'Nie udało się zweryfikować tabeli NBP. Spróbuj ponownie lub przelicz ręcznie.',
  NBP_UNAVAILABLE: 'NBP jest chwilowo niedostępny. Spróbuj ponownie lub przelicz ręcznie.',
  UNAUTHENTICATED: 'Zaloguj się ponownie.',
  FORBIDDEN: 'Ta operacja jest dostępna wyłącznie dla aktywnego administratora.',
  NOT_FOUND: 'Nie znaleziono dokumentu lub paczki.',
  INVALID_INPUT: 'Sprawdź przesłane dane.',
  STALE_VERSION: 'Dokument zmienił się w innej karcie. Odśwież dane przed zapisem.',
  INVALID_STATE: 'Ta operacja nie jest dostępna w bieżącym stanie dokumentu.',
  BATCH_LIMIT: 'Paczka może zawierać najwyżej 20 dokumentów.',
  DUPLICATE_UNAVAILABLE: 'Ten plik jest już zapisany, ale wymaga sprawdzenia magazynu.',
  ATTACHMENT_NOT_READY: 'Oryginał nie jest gotowy do zatwierdzenia.',
  IDEMPOTENCY_CONFLICT: 'Klucz ponowienia dotyczy innej operacji. Odśwież dokument.',
  APPROVAL_VALIDATION_FAILED: 'Uzupełnij lub popraw oznaczone pola.',
  KSEF_CONFLICT: 'Rozstrzygnij różnice z KSeF przed zatwierdzeniem kosztu.',
  KSEF_AMBIGUOUS_MATCH: 'Kilka dokumentów pasuje do faktury KSeF. Sprawdź powiązania i zbędne szkice przed ponowną synchronizacją.',
  INVALID_KSEF_SNAPSHOT: 'Dane faktury KSeF są niepełne lub nieprawidłowe. Dokument nie został zapisany.',
  FILE_UNAVAILABLE: 'Nie można bezpiecznie odczytać oryginału. Skontaktuj się z administratorem.',
  UPLOAD_NOT_CONFIGURED: 'Prywatny magazyn dokumentów nie został skonfigurowany.',
  REQUEST_TOO_LARGE: 'Przesłane dane przekraczają dopuszczalny rozmiar.',
  DOCUMENT_TOO_LARGE: 'Plik przekracza limit 10 MB.',
  PDF_PAGE_LIMIT: 'PDF może zawierać najwyżej 10 stron.',
  PDF_ENCRYPTED: 'Prześlij PDF bez szyfrowania i hasła.',
  UNSUPPORTED_TYPE: 'Prześlij PDF lub zdjęcie JPG, PNG albo WebP.',
  INVALID_DOCUMENT: 'Plik jest niekompletny, uszkodzony lub zawiera nieobsługiwaną animację.',
  IMAGE_TOO_LARGE: 'Obraz ma zbyt dużą rozdzielczość.',
  PROCESS_TIMEOUT: 'Sprawdzenie dokumentu przekroczyło limit czasu.',
  ABORTED: 'Przesyłanie dokumentu zostało przerwane.',
}

export function invoiceHttpErrorResponse(error: unknown) {
  if (error instanceof ClosedInvoicePeriodsError) {
    return NextResponse.json({ error: error.message, code: error.code, periods: error.periods }, {
      status: error.status, headers: INVOICE_HTTP_HEADERS,
    })
  }
  if (error instanceof InstallationMultipartError) {
    return NextResponse.json({ error: error.message, code: error.status === 413 ? 'REQUEST_TOO_LARGE' : 'INVALID_MULTIPART' }, {
      status: error.status, headers: INVOICE_HTTP_HEADERS,
    })
  }
  if (error instanceof InvoiceImportError || error instanceof InvoiceApprovalError
    || error instanceof InvoiceOriginalUnavailableError || error instanceof InvoiceImportHttpError
    || error instanceof AiHttpError || error instanceof InvoiceFilesConfigurationError || error instanceof NbpRateError) {
    return NextResponse.json({
      error: MESSAGES[error.code] ?? 'Nie udało się obsłużyć dokumentu.', code: error.code,
      ...(error instanceof InvoiceApprovalError && error.issues ? { issues: error.issues } : {}),
    }, { status: error.status, headers: INVOICE_HTTP_HEADERS })
  }
  if (error instanceof InvoiceDocumentProcessorError) {
    const clientCodes = new Set([
      'INVALID_DOCUMENT', 'UNSUPPORTED_TYPE', 'DOCUMENT_TOO_LARGE', 'IMAGE_TOO_LARGE',
      'PDF_ENCRYPTED', 'PDF_PAGE_LIMIT', 'PROCESS_TIMEOUT', 'ABORTED',
    ])
    const code = clientCodes.has(error.code) ? error.code : 'FILE_UNAVAILABLE'
    return NextResponse.json({ error: MESSAGES[code], code }, {
      status: code === 'DOCUMENT_TOO_LARGE' ? 413 : code === 'FILE_UNAVAILABLE' ? 500 : 422,
      headers: INVOICE_HTTP_HEADERS,
    })
  }
  // Internal services retain exceptions for control flow; the HTTP boundary
  // never serializes Prisma queries, native diagnostics, paths or stack traces.
  return NextResponse.json({ error: 'Nie udało się obsłużyć dokumentu.', code: 'INTERNAL_ERROR' }, {
    status: 500, headers: INVOICE_HTTP_HEADERS,
  })
}
