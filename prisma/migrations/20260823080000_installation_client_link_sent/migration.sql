ALTER TABLE "InstallationClientLink" ADD COLUMN "sentAt" DATETIME;
ALTER TABLE "InstallationClientLink" ADD COLUMN "sentById" TEXT;

CREATE INDEX "InstallationClientLink_orderId_sentAt_idx" ON "InstallationClientLink"("orderId", "sentAt");
