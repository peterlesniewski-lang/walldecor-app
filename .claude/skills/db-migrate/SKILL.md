---
name: db-migrate
description: Przeprowadza zmianę schematu Prisma dla WallDecor — dodaje model/pole, generuje migrację, aktualizuje seed i architecture.md. Użyj gdy zmieniasz strukturę bazy danych.
allowed-tools: Read, Write, Edit, Bash, Glob
---

# DB Migrate — WallDecor

Przeprowadzasz zmianę schematu bazy danych. Argument: $ARGUMENTS

---

## Proces (zawsze w tej kolejności)

### Krok 1 — Przeczytaj aktualny stan
```bash
# Sprawdź aktualny schemat
cat prisma/schema.prisma

# Sprawdź istniejące migracje
ls prisma/migrations/
```

### Krok 2 — Zaplanuj zmianę
Przed edycją `schema.prisma` określ:
- Czy zmiana jest **backwards compatible** (dodanie opcjonalnego pola)?
- Czy wymaga **transformacji danych** (np. split kolumny)?
- Czy wpływa na **istniejące relacje**?
- Czy seed.ts wymaga aktualizacji?

### Krok 3 — Edytuj schema.prisma
```prisma
// Nowe pola zawsze na końcu modelu
// Nullable domyślnie jeśli baza ma dane: String?
// Nie usuwaj pól bez backup planu
```

### Krok 4 — Generuj migrację
```bash
npx prisma migrate dev --name <opisowa-nazwa-po-angielsku>
# Przykłady nazw:
# add-overtime-note-to-worktime
# add-employee-photo-url
# create-payment-reminders-table
```

### Krok 5 — Zaktualizuj seed.ts jeśli potrzeba
Seed dodaje tylko dane inicjalne (centra kosztów, kategorie kont, admin).
Jeśli nowy model wymaga danych startowych — dodaj do seeda.

### Krok 6 — Zaktualizuj architecture.md
Dodaj nowy model lub pole do dokumentacji w `architecture.md`.
Format: Prisma schema snippet + opis.

### Krok 7 — Sprawdź Prisma Client
```bash
npx prisma generate  # regeneruje typy TypeScript
```

---

## Zasady schematu WallDecor

### Konwencje nazewnictwa
```prisma
model Employee { ... }      // PascalCase dla modeli
employeeId    String        // camelCase dla pól
costCenterId  String        // FK: <model>Id
createdAt     DateTime @default(now())
updatedAt     DateTime @updatedAt
```

### Obowiązkowe pola dla każdego nowego modelu
```prisma
model NewModel {
  id        String   @id @default(cuid())
  // ... pola biznesowe ...
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

### Kwoty finansowe
```prisma
amount Decimal  // nie Float — Decimal dla PLN bez błędów zaokrąglania
```

### Enumeracje — dodawaj do schema.prisma
```prisma
// Nie używaj String dla pól z ograniczonym zestawem wartości
// Zamiast: costCenter String
// Użyj:
enum CostCenterType { JAG PUL GLOBAL }
```

---

## Rollback — jeśli coś pójdzie nie tak
```bash
# Cofnij ostatnią migrację (tylko dev)
npx prisma migrate reset

# Sprawdź status migracji
npx prisma migrate status
```

---

## Checklist
- [ ] Nowe pola nullable jeśli baza ma istniejące dane
- [ ] Nazwa migracji opisowa po angielsku (kebab-case)
- [ ] `npx prisma generate` wykonane po migracji
- [ ] `architecture.md` zaktualizowane
- [ ] Seed zaktualizowany jeśli nowy model potrzebuje danych startowych
- [ ] Nie usunięto pól bez konsultacji z właścicielem
