import type { Prisma } from '@/generated/prisma'
import { invoiceBusinessIdentity, isPossibleInvoiceDuplicate, type InvoiceBusinessIdentityInput } from './identity'

/** Call inside the same write reservation as the mutation to prevent racing inserts. */
export async function findExistingInvoiceDuplicate(
  tx: Prisma.TransactionClient,
  input: InvoiceBusinessIdentityInput,
  excludedInvoiceId: string | null = null,
) {
  const proposed = invoiceBusinessIdentity(input)
  const issueDate = new Date(`${proposed.issueDateKey}T00:00:00.000Z`)
  const candidates = await tx.ksefInvoice.findMany({
    where: {
      issueDate: { gte: issueDate, lt: new Date(issueDate.getTime() + 86_400_000) },
      id: excludedInvoiceId ? { not: excludedInvoiceId } : undefined,
    },
    select: {
      id: true, supplierName: true, supplierNip: true, invoiceNumber: true, issueDate: true,
      invoiceImportDraft: { select: { id: true } },
    },
  })
  return candidates.find((candidate) => isPossibleInvoiceDuplicate(proposed, invoiceBusinessIdentity({
    supplierName: candidate.supplierName, taxId: candidate.supplierNip,
    invoiceNumber: candidate.invoiceNumber, issueDate: candidate.issueDate.toISOString().slice(0, 10),
  }))) ?? null
}

export function invoiceDuplicateBody(existing: {
  id: string
  invoiceImportDraft: { id: string } | null
}) {
  return {
    code: 'INVOICE_DUPLICATE' as const,
    error: 'Ta faktura jest już zapisana. Otwórz istniejący dokument.',
    duplicate: { invoiceId: existing.id, draftId: existing.invoiceImportDraft?.id ?? null },
  }
}
