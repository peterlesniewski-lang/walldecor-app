# CLAUDE.md — Zasady budowania aplikacji WallDecor

## Kontekst projektu

Aplikacja budżetowo-HR dla firmy WallDecor (salony dekoracyjne).
Zastępuje arkusz Excel. Centrum wiedzy właściciela o stanie firmy.

Spec pełna: `spec.md`
Architektura bazy: `architecture.md`
Stan projektu: `project_status.md`
Kamienie milowe: sekcja "Milestones" w `project_status.md`

Szczegółowe instrukcje dotyczące testów znajdziesz w: @.claude/rules/testing.md

---

## Memory — reguła obowiązkowa

**Przed przystąpieniem do każdego zadania** sprawdź memory projektu:
- `~/.claude/projects/-Users-piotr-projekty/memory/project_walldecor_app.md` — status milestones, decyzje techniczne, co zostało zbudowane

**Po ukończeniu każdego istotnego bloku pracy** (nowy moduł, milestone, fix, zmiana schematu) zaktualizuj memory:
- Zaktualizuj `project_walldecor_app.md` — oznacz milestone jako ukończony, dodaj nowe komponenty/endpointy, wpisz kluczowe decyzje
- Jeśli pojawiły się nowe wzorce/decyzje techniczne — dodaj je do sekcji "Kluczowe decyzje techniczne"

> **Istotny blok** = ukończony milestone, nowy moduł lub feature, zmiana schematu bazy, naprawa istotnego bugu, nowe wzorce kodowania.

---

## Next.js 16 — krytyczna reguła dla API routes

W Next.js 16 `params` w route handlerach to **Promise** — zawsze używaj:
```typescript
// ✅ POPRAWNIE
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
}

// ❌ BŁĄD — build się nie skompiluje
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params
}
```

---

## Git — reguła po każdej zmianie

**Po zakończeniu każdego bloku pracy** (feature, fix, refactor) zawsze zapytaj użytkownika:
> „Czy mam zrobić commit i push na git?"

Nie pushuj automatycznie — zawsze czekaj na potwierdzenie.

---

## Stack — nie zmieniaj bez konsultacji

- **Framework:** Next.js 14+ App Router, TypeScript (strict)
- **UI:** Tailwind CSS + shadcn/ui — używaj gotowych komponentów z shadcn zanim napiszesz własny
- **Auth:** NextAuth.js z rolami: `ADMIN | MANAGER | EMPLOYEE`
- **ORM:** Prisma
- **Baza:** SQLite (plik `walldecor.db`) — nie przełączaj na PostgreSQL bez polecenia
- **Deployment:** Docker Compose na VPS OVH Ubuntu
- **PDF:** jspdf + jspdf-autotable (raporty miesięczne HR)
- **Zarządzanie kontami:** /settings/users (ADMIN) — blokowanie, role, reset hasła

---

## Skills — slash commands projektu

### Skills projektowe (`.claude/skills/`)

| Skill | Kiedy używać |
|---|---|
| `/ui-component` | Nowy komponent React (strona, formularz, karta, tabela, widget) |
| `/finance-widget` | Elementy dashboardu: KPI, plan vs actual, break-even, wykresy |
| `/api-route` | Nowy endpoint Next.js API z auth, Zod, Prisma |
| `/db-migrate` | Zmiana schematu Prisma — nowy model lub pole |
| `/review` | Code review przed commitem lub po ukończeniu milestone |

### Globalne komendy (`~/.claude/commands/`)

| Komenda | Kiedy używać |
|---|---|
| `/feature-dev` | Nowa funkcja — 7-fazowy workflow (discovery → exploration → questions → arch → impl → review → summary) |
| `/review-pr` | Code review PR — wyspecjalizowani agenci (comments, tests, errors, types, code, simplify) |
| `/commit` | Szybki commit z auto-generowanym message |
| `/commit-push-pr` | Pełny workflow: commit → push → otwórz PR |
| `/clean_gone` | Usuń lokalne branche skasowane z remote |
| `/simplify` | Refaktoryzacja — uproszczenie i poprawa jakości kodu |

### Globalny skill frontendowy (`~/.claude/skills/frontend-design/`)

Automatycznie aktywny przy każdym UI — tworzy wyróżniające się interfejsy zamiast generycznego "AI slop".

---

## MCP — narzędzia deweloperskie

Projekt korzysta z MCP skonfigurowanych w `.mcp.json`:

| MCP | Zastosowanie |
|---|---|
| `@playwright/mcp` | Testowanie E2E i debugowanie UI live |
| `@modelcontextprotocol/server-sqlite` | Inspekcja bazy `walldecor.db` podczas dev |
| `next-devtools-mcp` | Live błędy Next.js, routes, Server Actions |

---

## Zasady kodowania

1. **TypeScript strict** — brak `any`, brak ignorowania błędów typów
2. **Server Components domyślnie** — `use client` tylko tam gdzie niezbędna interaktywność
3. **Prisma dla wszystkich zapytań do bazy** — zero raw SQL bez wyraźnego powodu
4. **Walidacja inputów** — Zod dla wszystkich formularzy i API routes
5. **Nazwy w języku angielskim** — kod, zmienne, funkcje, tabele. Interfejs użytkownika po polsku
6. **Nie duplikuj logiki** — współdzielona logika trafia do `lib/`

---

## Struktura katalogów (docelowa)

```
walldecor-app/
├── app/                    # Next.js App Router
│   ├── (auth)/             # Strony logowania
│   ├── (dashboard)/        # Główna aplikacja (chronione)
│   │   ├── finance/        # Moduł finansowy
│   │   ├── hr/             # Moduł HR
│   │   └── settings/       # Ustawienia
│   └── api/                # API Routes
├── components/             # Komponenty React
│   ├── ui/                 # shadcn/ui (nie edytuj ręcznie)
│   └── shared/             # Własne komponenty wielokrotnego użytku
├── lib/                    # Logika biznesowa, helpery, typy
│   ├── prisma.ts           # Singleton Prisma Client
│   ├── auth.ts             # Konfiguracja NextAuth
│   └── validations/        # Schematy Zod
├── prisma/
│   ├── schema.prisma       # Schemat bazy
│   └── seed.ts             # Dane startowe (kategorie kont, centra kosztów)
├── docker-compose.yml
├── CLAUDE.md
├── spec.md
├── architecture.md
└── project_status.md
```

---

## Centra kosztów — stałe wartości

```typescript
enum CostCenter { JAG = "JAG", PUL = "PUL", GLOBAL = "GLOBAL" }
```

Ecommerce to kanał przychodów przypisany zawsze do `PUL`.

---

## Role i dostęp — reguły biznesowe

| Zaób | ADMIN | MANAGER | EMPLOYEE |
|---|---|---|---|
| Budżet — edycja | ✅ | ❌ | ❌ |
| Wykonanie — wszystkie lokale | ✅ | ✅ (widok) | ❌ |
| Wykonanie — własny lokal | ✅ | ✅ | ✅ (obrót + wybrane koszty) |
| Dane płacowe | ✅ | ❌ | ❌ |
| Dane HR wszystkich | ✅ | ✅ (bez płac) | ❌ |
| Własne dane HR | ✅ | ✅ | ✅ |
| Wnioski urlopowe | ✅ | Zatwierdza | Składa |

---

## Zasady aktualizacji dokumentacji

**Po każdym ukończonym dużym fragmencie pracy** (nowa funkcja, milestone, moduł, refaktor) — **bez czekania na koniec sesji**:
1. Zaktualizuj `project_status.md`:
   - Oznacz ukończone zadania `[x]`
   - Dodaj nowe pliki/endpointy do odpowiedniej sekcji
   - Zaktualizuj datę `Ostatnia aktualizacja`
   - Wpisz co jest następne w sekcji `Następna sesja`
2. Jeśli zmienił się schemat bazy — zaktualizuj `architecture.md`
3. Jeśli zmieniły się decyzje projektowe — zaktualizuj `spec.md`

> **Duży fragment** = ukończony milestone, nowy endpoint + UI, nowy komponent z logiką biznesową, zmiana schematu bazy, lub każdy blok pracy który użytkownik mógłby uznać za zamknięty.

---

## Reguły finansowe

- Waluta: tylko **PLN**, brak obsługi walut obcych
- Rok budżetowy: **styczeń–grudzień**
- Budżet: roczny, podzielony na 12 miesięcy, ustalany przez ADMIN
- GLOBAL: osobne centrum kosztów, **nie alokowane** do JAG/PUL w MVP
- Break-even per lokal = suma kosztów bezpośrednich lokalu + proporcja GLOBAL (do decyzji właściciela)

---

## Znane bugi i ich naprawy

1. **Double navigation (hr/layout.tsx)** — `hr/layout.tsx` renderował `HrSidebar` jako dodatkowy panel obok globalnego sidebaru. Fix: usunięto `HrSidebar` z layout — renderuje tylko `{children}`.

2. **Produkcja P2021 (Prisma migrate)** — entrypoint Docker używał `prisma migrate deploy`, ale repo nie zawiera plików migracji — Prisma rzucał P2021. Fix: zmieniono na `prisma db push --accept-data-loss`.

3. **Next.js 16 params — patrz reguła na górze CLAUDE.md** — `{ params: { id: string } }` nie kompiluje się w Next.js 16. Fix: `{ params: Promise<{ id: string }> }` + `await params`. Dotknięte pliki: `alerts/thresholds/[id]`, `alerts/payment-reminders/[id]`, `users/[id]`, `users/[id]/reset-password`.

4. **onClick w Server Component (employees/page.tsx)** — `<td onClick={...}>` użyty w Server Component. Next.js zabrania event handlerów w SC. Fix: usunięto handler `onClick`.

5. **"Dodaj wpis" Invalid input (notes: null)** — modal wysyłał `notes: null` gdy pole puste, ale Zod `.optional()` nie akceptuje `null`. Fix: zmieniono na `undefined` zamiast `null` przy pustym polu.

6. **"Zapisz zmiany" pracownika Invalid input (puste pola enum/string)** — formularz wysyłał `employmentType: ""` i `phone: null` — Zod odrzucał puste stringi dla enum fields i `null` dla string fields. Fix: schema rozszerzona o `.nullish()` dla clearable fields; pola enum omijane gdy puste.

7. **Legacy login nie działał dla e-maili z kropką (`src/lib/auth.ts`)** — fallback dla kont bez `username` używał `email.startsWith(username + '@')`, więc `jan.kowalski@...` nie pasował do znormalizowanego loginu `jankowalski` (kropka usunięta z loginu, ale nie z e-maila). Fix: porównanie ze znormalizowaną częścią lokalną e-maila (`normalizeEmailLocalPart(user.email) === username`). Regression test: `__tests__/unit/accounts/account-security.test.ts`.

---

## Reguły HR

- Typy zatrudnienia: `UOP | B2B | UZ`
- Godziny pracy: 11:00–19:00 (poniedziałek–piątek), 11:00–14:00 (sobota)
- Soboty = **automatycznie liczone jako nadgodziny**
- Raport nadgodzin generowany automatycznie na koniec miesiąca
- Saldo urlopowe: automatycznie aktualizowane po zatwierdzeniu wniosku
