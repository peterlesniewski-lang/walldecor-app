# Architecture — Schemat bazy danych WallDecor

**ORM:** Prisma | **Baza:** SQLite | **Plik:** `walldecor.db`

---

## Diagram relacji (uproszczony)

```
CostCenter ──────────────────────────────────────────┐
     │                                               │
     ├── BudgetEntry (plan)                          │
     ├── ActualEntry (wykonanie)                     │
     └── Revenue (przychody)                         │
                                                     │
SubCategory ──┬── BudgetEntry                        │
              └── ActualEntry                        │
AccountCategory ──── SubCategory                     │
                                                     │
Employee ────────────────────────────────────────────┘
     │   (belongs to CostCenter)
     ├── Contract[]
     ├── AdditionalContract[]
     ├── SalaryHistory[]
     ├── LeaveRequest[]
     ├── LeaveBalance[]
     └── WorkTimeRecord[]

User ──── Employee (1:1, opcjonalne)
```

---

## Tabele (Prisma schema)

### User
```prisma
model User {
  id            String    @id @default(cuid())
  email         String    @unique
  name          String
  role          Role      @default(EMPLOYEE)
  passwordHash  String
  employee      Employee? @relation(fields: [employeeId], references: [id])
  employeeId    String?   @unique
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  actualEntries ActualEntry[]
}

enum Role {
  ADMIN
  MANAGER
  EMPLOYEE
}
```

---

### CostCenter
```prisma
model CostCenter {
  id          String  @id  // "JAG" | "PUL" | "GLOBAL"
  name        String
  description String?

  budgetEntries  BudgetEntry[]
  actualEntries  ActualEntry[]
  revenues       Revenue[]
  employees      Employee[]
  reminders      PaymentReminder[]
}
```

---

### AccountCategory + SubCategory
```prisma
model AccountCategory {
  id           String        @id @default(cuid())
  name         String        @unique  // np. "Customer Acquisition"
  order        Int           // kolejność wyświetlania
  subCategories SubCategory[]
}

model SubCategory {
  id         String          @id @default(cuid())
  name       String          // np. "AdWords"
  order      Int
  categoryId String
  category   AccountCategory @relation(fields: [categoryId], references: [id])

  budgetEntries BudgetEntry[]
  actualEntries ActualEntry[]
}
```

---

### BudgetEntry — Plan budżetu
```prisma
model BudgetEntry {
  id            String      @id @default(cuid())
  year          Int
  month         Int         // 1–12
  amount        Decimal     @default(0)

  costCenterId  String
  costCenter    CostCenter  @relation(fields: [costCenterId], references: [id])
  subCategoryId String
  subCategory   SubCategory @relation(fields: [subCategoryId], references: [id])

  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt

  @@unique([year, month, costCenterId, subCategoryId])
}
```

---

### ActualEntry — Wykonanie budżetu
```prisma
model ActualEntry {
  id            String      @id @default(cuid())
  year          Int
  month         Int         // 1–12
  amount        Decimal
  note          String?

  costCenterId  String
  costCenter    CostCenter  @relation(fields: [costCenterId], references: [id])
  subCategoryId String
  subCategory   SubCategory @relation(fields: [subCategoryId], references: [id])
  enteredById   String
  enteredBy     User        @relation(fields: [enteredById], references: [id])

  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt

  @@unique([year, month, costCenterId, subCategoryId])
}
```

---

### Revenue — Przychody
```prisma
model Revenue {
  id           String        @id @default(cuid())
  year         Int
  month        Int
  amount       Decimal
  channel      RevenueChannel

  costCenterId String
  costCenter   CostCenter    @relation(fields: [costCenterId], references: [id])

  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt

  @@unique([year, month, costCenterId, channel])
}

enum RevenueChannel {
  SALON       // sprzedaż w salonie
  ECOMMERCE   // zawsze costCenter = PUL
}
```

---

### Employee — Pracownik
```prisma
model Employee {
  id           String     @id @default(cuid())
  firstName    String
  lastName     String
  email        String?    @unique
  phone        String?
  pesel        String?
  address      String?
  position     String
  startDate    DateTime
  endDate      DateTime?
  isActive     Boolean    @default(true)

  costCenterId String
  costCenter   CostCenter @relation(fields: [costCenterId], references: [id])

  contracts          Contract[]
  additionalContracts AdditionalContract[]
  salaryHistory      SalaryHistory[]
  leaveRequests      LeaveRequest[]
  leaveBalances      LeaveBalance[]
  workTimeRecords    WorkTimeRecord[]
  user               User?

  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt
}
```

---

### Contract — Umowa główna
```prisma
model Contract {
  id           String         @id @default(cuid())
  type         ContractType
  startDate    DateTime
  endDate      DateTime?
  salary       Decimal        // brutto dla UOP, netto/stawka dla B2B/UZ
  salaryNote   String?

  employeeId   String
  employee     Employee       @relation(fields: [employeeId], references: [id])

  createdAt    DateTime       @default(now())
}

enum ContractType {
  UOP   // Umowa o pracę
  B2B   // Działalność gospodarcza / faktura
  UZ    // Umowa zlecenie
}
```

---

### AdditionalContract — Umowy dodatkowe
```prisma
model AdditionalContract {
  id          String   @id @default(cuid())
  type        String   // np. "Najem auta", "UZ dodatkowa"
  description String?
  startDate   DateTime
  endDate     DateTime?
  value       Decimal
  note        String?

  employeeId  String
  employee    Employee @relation(fields: [employeeId], references: [id])

  createdAt   DateTime @default(now())
}
```

---

### SalaryHistory — Historia wynagrodzeń
```prisma
model SalaryHistory {
  id          String   @id @default(cuid())
  validFrom   DateTime
  validTo     DateTime?
  salary      Decimal
  note        String?  // np. "Podwyżka", "Awans"

  employeeId  String
  employee    Employee @relation(fields: [employeeId], references: [id])

  createdAt   DateTime @default(now())
}
```

---

### LeaveRequest — Wnioski urlopowe
```prisma
model LeaveRequest {
  id          String        @id @default(cuid())
  type        LeaveType
  startDate   DateTime
  endDate     DateTime
  days        Int
  status      LeaveStatus   @default(PENDING)
  note        String?
  reviewNote  String?

  employeeId  String
  employee    Employee      @relation(fields: [employeeId], references: [id])
  reviewedById String?
  // reviewedBy → User (admin/manager)

  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt
}

enum LeaveType {
  VACATION      // Urlop wypoczynkowy
  SICK          // Chorobowe L4
  CARE          // Opieka
  OTHER         // Inne
}

enum LeaveStatus {
  PENDING
  APPROVED
  REJECTED
}
```

---

### LeaveBalance — Saldo urlopowe
```prisma
model LeaveBalance {
  id          String    @id @default(cuid())
  year        Int
  type        LeaveType
  total       Int       // dni przyznane
  used        Int       @default(0)
  remaining   Int       // computed: total - used

  employeeId  String
  employee    Employee  @relation(fields: [employeeId], references: [id])

  @@unique([employeeId, year, type])
}
```

---

### WorkTimeRecord — Ewidencja czasu pracy
```prisma
model WorkTimeRecord {
  id            String    @id @default(cuid())
  date          DateTime
  regularHours  Decimal   @default(0)
  overtimeHours Decimal   @default(0)  // soboty auto + manualne
  isSaturday    Boolean   @default(false)
  note          String?

  employeeId    String
  employee      Employee  @relation(fields: [employeeId], references: [id])

  createdAt     DateTime  @default(now())

  @@unique([employeeId, date])
}
```

---

### PaymentReminder — Przypomnienia o płatnościach
```prisma
model PaymentReminder {
  id           String    @id @default(cuid())
  name         String    // np. "Czynsz Jagiellońska"
  amount       Decimal?
  dueDay       Int       // dzień miesiąca (1–31)
  recurring    Boolean   @default(true)
  isActive     Boolean   @default(true)
  note         String?

  costCenterId String?
  costCenter   CostCenter? @relation(fields: [costCenterId], references: [id])

  createdAt    DateTime  @default(now())
}
```

---

## Dane startowe (seed)

Przy pierwszym uruchomieniu `prisma db seed` wgrywa:

1. **CostCenter:** JAG, PUL, GLOBAL
2. **AccountCategory + SubCategory:** pełna struktura kont z `spec.md`
3. **User:** konto Admin (Prezes) z tymczasowym hasłem

---

## Kluczowe zapytania (przykłady)

### Plan vs Wykonanie per lokal, miesiąc
```sql
SELECT sc.name, b.amount as budget, a.amount as actual
FROM SubCategory sc
LEFT JOIN BudgetEntry b ON b.subCategoryId = sc.id
  AND b.costCenterId = 'JAG' AND b.year = 2026 AND b.month = 3
LEFT JOIN ActualEntry a ON a.subCategoryId = sc.id
  AND a.costCenterId = 'JAG' AND a.year = 2026 AND a.month = 3
```

### Break-even per lokal (miesięczny)
```
Break-even = suma kosztów (BudgetEntry) dla danego costCenter
             podzielona przez marżę (do konfiguracji przez admina)
```

### Nadgodziny miesięczne pracownika
```sql
SELECT SUM(overtimeHours) FROM WorkTimeRecord
WHERE employeeId = ? AND month(date) = ? AND year(date) = ?
```
