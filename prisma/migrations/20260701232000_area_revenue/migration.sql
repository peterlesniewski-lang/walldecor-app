-- CreateTable
CREATE TABLE "AreaRevenue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "amount" REAL NOT NULL,
    "costCenterId" TEXT NOT NULL,
    "areaTagId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AreaRevenue_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AreaRevenue_areaTagId_fkey" FOREIGN KEY ("areaTagId") REFERENCES "CostTag" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AreaRevenue_year_month_costCenterId_areaTagId_key" ON "AreaRevenue"("year", "month", "costCenterId", "areaTagId");

-- CreateIndex
CREATE INDEX "AreaRevenue_year_month_idx" ON "AreaRevenue"("year", "month");

-- CreateIndex
CREATE INDEX "AreaRevenue_costCenterId_idx" ON "AreaRevenue"("costCenterId");

-- CreateIndex
CREATE INDEX "AreaRevenue_areaTagId_idx" ON "AreaRevenue"("areaTagId");
