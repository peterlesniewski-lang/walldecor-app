-- AlterTable
ALTER TABLE "KsefInvoice" ADD COLUMN "bankAccount" TEXT;

-- CreateIndex
CREATE INDEX "KsefInvoice_bankAccount_idx" ON "KsefInvoice"("bankAccount");
