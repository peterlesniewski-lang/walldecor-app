-- CreateTable
CREATE TABLE "CostCenter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT
);

-- CreateTable
CREATE TABLE "AccountCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "SubCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "categoryId" TEXT NOT NULL,
    CONSTRAINT "SubCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "AccountCategory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'EMPLOYEE',
    "passwordHash" TEXT NOT NULL,
    "employeeId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BudgetEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "amount" REAL NOT NULL,
    "costCenterId" TEXT NOT NULL,
    "subCategoryId" TEXT NOT NULL,
    CONSTRAINT "BudgetEntry_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BudgetEntry_subCategoryId_fkey" FOREIGN KEY ("subCategoryId") REFERENCES "SubCategory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ActualEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "amount" REAL NOT NULL,
    "costCenterId" TEXT NOT NULL,
    "subCategoryId" TEXT NOT NULL,
    CONSTRAINT "ActualEntry_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ActualEntry_subCategoryId_fkey" FOREIGN KEY ("subCategoryId") REFERENCES "SubCategory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Revenue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "amount" REAL NOT NULL,
    "costCenterId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    CONSTRAINT "Revenue_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaymentReminder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "dayOfMonth" INTEGER NOT NULL,
    "costCenterId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentReminder_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "position" TEXT NOT NULL,
    "costCenterId" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Employee_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME,
    "salary" REAL NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Contract_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AdditionalContract" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "AdditionalContract_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SalaryHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "effectiveFrom" DATETIME NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SalaryHistory_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "days" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LeaveRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LeaveBalance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "total" INTEGER NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "LeaveBalance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkTimeRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "regularHours" REAL NOT NULL,
    "overtimeHours" REAL NOT NULL DEFAULT 0,
    "note" TEXT,
    CONSTRAINT "WorkTimeRecord_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountCategory_name_key" ON "AccountCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_employeeId_key" ON "User"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetEntry_year_month_costCenterId_subCategoryId_key" ON "BudgetEntry"("year", "month", "costCenterId", "subCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "ActualEntry_year_month_costCenterId_subCategoryId_key" ON "ActualEntry"("year", "month", "costCenterId", "subCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Revenue_year_month_costCenterId_channel_key" ON "Revenue"("year", "month", "costCenterId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_email_key" ON "Employee"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_userId_key" ON "Employee"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveBalance_employeeId_year_type_key" ON "LeaveBalance"("employeeId", "year", "type");

-- CreateIndex
CREATE UNIQUE INDEX "WorkTimeRecord_employeeId_date_key" ON "WorkTimeRecord"("employeeId", "date");
