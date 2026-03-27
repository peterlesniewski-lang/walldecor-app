---
name: review
description: Przegląda zmieniony kod WallDecor pod kątem bezpieczeństwa, uprawnień ról, TypeScript strict, walidacji Zod i jakości kodu. Użyj przed każdym większym commitem lub po ukończeniu kamienia milowego.
allowed-tools: Read, Grep, Glob, Bash
---

# Code Review — WallDecor

Przeglądasz kod zmieniony w bieżącej sesji lub wskazany przez $ARGUMENTS

---

## Krok 1 — Zbierz zmiany

```bash
git diff --name-only          # lista zmienionych plików
git diff                       # pełne zmiany
git status                     # nieśledzone pliki
```

---

## Krok 2 — Bezpieczeństwo (KRYTYCZNE)

Sprawdź każdy plik API routes (`app/api/**`):

```
□ Czy każdy handler zaczyna od `getServerSession(authOptions)`?
□ Czy zwraca 401 gdy brak sesji?
□ Czy zwraca 403 gdy niewystarczające uprawnienia?
□ Czy EMPLOYEE może edytować TYLKO swój lokal (costCenterId check)?
□ Czy dane płacowe (salary) są widoczne TYLKO dla ADMIN?
□ Czy nie ma hardcodowanych ID ani sekretów?
□ Czy nie ma console.log z danymi wrażliwymi (PESEL, hasło, salary)?
```

Jeśli znajdziesz problem → **STOP** i opisz jako KRYTYCZNY błąd.

---

## Krok 3 — TypeScript

```
□ Brak `any` — każde użycie musi być uzasadnione komentarzem
□ Brak `@ts-ignore` bez wyjaśnienia
□ Props komponentów mają interface lub type (nie inline)
□ Zwracane typy funkcji async są jawnie określone
□ Typ `Decimal` z Prisma konwertowany do `Number()` przed Math
□ Enumeracje używane zamiast string literals gdzie możliwe
```

---

## Krok 4 — Walidacja danych

```
□ Każdy POST/PUT endpoint używa Zod `safeParse` (nie `parse`)
□ Błędy walidacji zwracają 400 z `result.error.flatten()`
□ Query params walidowane przez Zod (nie parseInt bez sprawdzenia)
□ Kwoty finansowe: Decimal, nie Float
□ Daty: używane jako DateTime, nie string
```

---

## Krok 5 — Prisma i baza

```
□ Brak raw SQL (prisma.$queryRaw) bez wyraźnego powodu
□ Relacje ładowane przez `include`, nie osobne zapytania w pętli (N+1)
□ `@unique` constraint tam gdzie wymagany (np. BudgetEntry: year+month+costCenter+subCategory)
□ Transakcje (`prisma.$transaction`) dla operacji zmieniających >1 tabelę
□ Nowe migracje mają opisowe nazwy
```

---

## Krok 6 — Komponenty UI

```
□ `use client` tylko gdzie niezbędny
□ Stany loading/error/empty obsługiwane
□ Kwoty przez formatPLN() — nie ręczne formatowanie
□ Traffic-light progi spójne (80% warning, 100%+ danger)
□ Polskie texty w UI (nie angielski mix)
□ Responsywność: overflow-x-auto na tabelach
```

---

## Krok 7 — Jakość ogólna

```
□ Brak zduplikowanej logiki (helpery w lib/)
□ Brak nieużywanych importów
□ Brak zakomentowanego kodu (usuń lub wyjaśnij TODO)
□ Komponenty < 200 linii (jeśli dłuższy — zaproponuj podział)
□ Funkcje < 50 linii
□ Nazwy zmiennych opisowe po angielsku
```

---

## Format raportu

Zwróć raport w tej strukturze:

```
## Wyniki code review

### 🔴 KRYTYCZNE (blokuje merge)
- [plik:linia] Opis problemu + jak naprawić

### 🟡 OSTRZEŻENIA (napraw przed kolejnym milestone)
- [plik:linia] Opis problemu

### 🟢 DOBRE PRAKTYKI (zaobserwowane)
- Co zostało zrobione dobrze

### 📋 SUGESTIE (opcjonalne)
- Propozycje ulepszeń nie blokujące
```

Jeśli znajdziesz błędy krytyczne — zaproponuj od razu fix.
