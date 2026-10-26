CREATE TABLE "InstallationAcceptanceInvoiceTask" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orderId" TEXT NOT NULL,
  "visitId" TEXT NOT NULL,
  "groupKey" TEXT NOT NULL,
  "acceptedProtocolId" TEXT NOT NULL,
  "assignedEmployeeId" TEXT NOT NULL,
  "title" TEXT NOT NULL DEFAULT 'Wystawić fakturę',
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "completedAt" DATETIME,
  "completedById" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "InstallationAcceptanceInvoiceTask_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "InstallationOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "InstallationAcceptanceInvoiceTask_acceptedProtocolId_fkey" FOREIGN KEY ("acceptedProtocolId") REFERENCES "InstallationAcceptanceProtocol"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "InstallationAcceptanceInvoiceTask_acceptedProtocolId_key" ON "InstallationAcceptanceInvoiceTask"("acceptedProtocolId");
CREATE UNIQUE INDEX "InstallationAcceptanceInvoiceTask_visitId_groupKey_key" ON "InstallationAcceptanceInvoiceTask"("visitId", "groupKey");
CREATE INDEX "InstallationAcceptanceInvoiceTask_orderId_status_idx" ON "InstallationAcceptanceInvoiceTask"("orderId", "status");
CREATE INDEX "InstallationAcceptanceInvoiceTask_assignedEmployeeId_status_idx" ON "InstallationAcceptanceInvoiceTask"("assignedEmployeeId", "status");
