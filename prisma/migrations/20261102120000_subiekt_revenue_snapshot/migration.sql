-- Additive only. Last read of monthly sales from the Subiekt GT bridge, keyed by
-- warehouse so remapping warehouses to cost centers needs no refetch. Revenue
-- rows change only when an ADMIN applies a snapshot.
CREATE TABLE "SubiektRevenueSnapshot" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "year" INTEGER NOT NULL CHECK ("year" BETWEEN 2020 AND 2100),
  "month" INTEGER NOT NULL CHECK ("month" BETWEEN 1 AND 12),
  "warehouseSymbol" TEXT NOT NULL,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('TOWAR', 'USLUGA', 'INNE')),
  "costCenterId" TEXT,
  "channel" TEXT,
  "grossAmount" REAL NOT NULL,
  "netAmount" REAL NOT NULL,
  "documentCount" INTEGER NOT NULL CHECK ("documentCount" >= 0),
  "fetchedAt" DATETIME NOT NULL,
  "sourceHash" TEXT NOT NULL
);
CREATE UNIQUE INDEX "SubiektRevenueSnapshot_year_month_warehouseSymbol_kind_key" ON "SubiektRevenueSnapshot"("year", "month", "warehouseSymbol", "kind");
CREATE INDEX "SubiektRevenueSnapshot_year_costCenterId_idx" ON "SubiektRevenueSnapshot"("year", "costCenterId");
