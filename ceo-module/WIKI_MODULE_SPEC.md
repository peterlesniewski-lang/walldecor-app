# WallDecor App — Moduł: Business Wikipedia

> Dodatek do istniejącego SPEC.md aplikacji WallDecor Business Manager.
> Zakładka "Manager" → sekcja "Wikipedia".
> Stack: Next.js + Prisma + SQLite (bez zmian).

---

## Cel modułu

Wewnętrzna encyklopedia wiedzy biznesowej dostępna z poziomu aplikacji.
- **Właściciel (Manager):** pełny dostęp — artykuły ogólne + prywatne notatki i procedury firmowe.
- **Pracownicy (User):** dostęp tylko do artykułów oznaczonych jako `public`.

---

## Schemat bazy danych (Prisma)

```prisma
model Article {
  id          String    @id @default(cuid())
  title       String
  slug        String    @unique
  content     String    // Markdown
  category    String    // enum: management | finance | sales | marketing | processes | psychology | strategy | company
  visibility  String    @default("manager") // "manager" | "public"
  type        String    @default("knowledge") // "knowledge" | "procedure" | "note"
  tags        String    // JSON array jako string: '["delegowanie","RACI"]'
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  authorNote  String?   // prywatna notatka właściciela (tylko manager)
}

model AiChatMessage {
  id          String   @id @default(cuid())
  sessionId   String
  role        String   // "user" | "assistant"
  content     String
  createdAt   DateTime @default(now())
}
```

---

## Kategorie artykułów

| ID | Etykieta | Ikona | Widoczność domyślna |
|----|----------|-------|---------------------|
| `management` | Zarządzanie i przywództwo | `Users` | manager |
| `finance` | Finanse i płynność | `TrendingUp` | manager |
| `sales` | Sprzedaż i negocjacje | `ShoppingBag` | manager |
| `marketing` | Marketing i branding | `Megaphone` | manager |
| `processes` | Procesy i automatyzacja | `GitBranch` | manager |
| `psychology` | Psychologia właściciela | `Brain` | manager |
| `strategy` | Strategia i rozwój | `Compass` | manager |
| `company` | Procedury firmowe | `Building2` | manager (nigdy public) |

---

## Struktura plików

```
src/
├── app/
│   └── manager/
│       └── wikipedia/
│           ├── page.tsx                  # lista / wyszukiwarka
│           ├── [slug]/
│           │   └── page.tsx              # widok artykułu
│           ├── new/
│           │   └── page.tsx              # nowy artykuł (manager only)
│           └── [slug]/edit/
│               └── page.tsx              # edycja artykułu
├── components/
│   └── wikipedia/
│       ├── ArticleList.tsx
│       ├── ArticleCard.tsx
│       ├── ArticleViewer.tsx             # renderer Markdown
│       ├── ArticleEditor.tsx             # edytor Markdown
│       ├── CategoryFilter.tsx
│       ├── SearchBar.tsx
│       ├── VisibilityBadge.tsx
│       └── AiAssistant/
│           ├── AiPanel.tsx               # panel czatu z AI
│           ├── AiMessage.tsx
│           └── AiInput.tsx
└── lib/
    └── wikipedia/
        ├── actions.ts                    # Server Actions: CRUD artykułów
        ├── search.ts                     # logika wyszukiwania
        └── gemini.ts                     # integracja Gemini API
```

---

## Ekrany

### 1. Lista artykułów (`/manager/wikipedia`)

**Layout:**
- Nagłówek: "Business Wikipedia" + przycisk "+ Nowy artykuł" (tylko manager)
- `SearchBar` — wyszukiwanie full-text po tytule i treści
- `CategoryFilter` — poziome chipsy z kategoriami (wszystkie / zarządzanie / finanse etc.)
- Toggle: "Moje notatki / Procedury / Cała wiedza"
- Grid kart `ArticleCard` (2 kolumny desktop, 1 mobile)

**ArticleCard zawiera:**
- Tytuł + kategoria + ikona
- Snippet treści (pierwsze 120 znaków)
- Tagi
- Badge: `PUBLIC` (zielony) lub `MANAGER` (szary) — widoczny tylko dla managera
- Data aktualizacji

---

### 2. Widok artykułu (`/manager/wikipedia/[slug]`)

**Layout:**
- Breadcrumb: Wikipedia → Kategoria → Tytuł
- Nagłówek: tytuł + metadane (kategoria, tagi, data, czas czytania)
- Przyciski managera: "Edytuj" + "Zmień widoczność"
- Treść artykułu (Markdown renderer)
- Sekcja "Notatka własna" (manager only) — prywatny komentarz do artykułu, edytowalny inline
- Panel AI (patrz niżej) — collapsible z prawej strony lub na dole

---

### 3. Edytor artykułu (`/manager/wikipedia/new` i `/edit`)

**Pola:**
- Tytuł (text input)
- Kategoria (select)
- Widoczność (toggle: Manager / Publiczny)
- Typ (select: Wiedza ogólna / Procedura firmowa / Notatka)
- Tagi (tag input)
- Treść (Markdown editor — `react-md-editor` lub `@uiw/react-md-editor`)
- Notatka własna (textarea, zawsze prywatna)

**Zachowanie:**
- Autosave co 30 sekund (draft w localStorage)
- Podgląd Markdown na żywo (split view)
- Slug generowany automatycznie z tytułu

---

## Wyszukiwanie

### Full-text search (SQLite FTS5)

```sql
-- Migracja Prisma: dodaj wirtualną tabelę FTS
CREATE VIRTUAL TABLE article_fts USING fts5(
  title, content, tags,
  content='Article',
  content_rowid='rowid'
);

-- Trigger sync
CREATE TRIGGER article_ai AFTER INSERT ON Article BEGIN
  INSERT INTO article_fts(rowid, title, content, tags)
  VALUES (new.rowid, new.title, new.content, new.tags);
END;
```

```typescript
// lib/wikipedia/search.ts
export async function searchArticles(query: string, role: 'manager' | 'user') {
  const visibilityFilter = role === 'manager' ? {} : { visibility: 'public' }

  // Jeśli query jest krótkie (<3 znaki) — filtruj po kategorii/tagach
  // Jeśli dłuższe — użyj LIKE lub FTS5
  return prisma.$queryRaw`
    SELECT a.* FROM Article a
    JOIN article_fts f ON a.rowid = f.rowid
    WHERE article_fts MATCH ${query}
    ${role === 'user' ? Prisma.sql`AND a.visibility = 'public'` : Prisma.empty}
    ORDER BY rank
    LIMIT 20
  `
}
```

---

## AI Asystent

### Umiejscowienie
Floating button w prawym dolnym rogu strony Wikipedia (analogicznie do CoachFAB z CEO Masterclass — możesz reużyć komponent).

### Kontekst AI
Gdy użytkownik czyta artykuł → AI dostaje treść artykułu jako kontekst.
Na liście artykułów → AI ma kontekst całej bazy (tylko tytuły + kategorie, nie pełna treść).

### System prompt

```
Jesteś asystentem wiedzy biznesowej wbudowanym w wewnętrzną encyklopedię firmy.

KONTEKST UŻYTKOWNIKA:
- Rola: {{role}} (manager / pracownik)
- Aktualnie czytany artykuł: {{articleTitle}} (kategoria: {{articleCategory}})

TREŚĆ ARTYKUŁU (jeśli dostępna):
{{articleContent}}

DOSTĘPNE KATEGORIE WIEDZY:
Zarządzanie i przywództwo, Finanse i płynność, Sprzedaż i negocjacje,
Marketing i branding, Procesy i automatyzacja, Psychologia właściciela,
Strategia i rozwój, Procedury firmowe.

ZASADY:
1. Odpowiadaj na pytania w kontekście artykułu gdy jesteś na stronie artykułu
2. Możesz wskazywać na inne artykuły w bazie gdy są relevantne ("sprawdź też artykuł o X")
3. Dla managera: możesz odnosić się do aspektów zarządczych i finansowych
4. Dla pracownika: skup się na praktycznych aspektach operacyjnych
5. Odpowiedzi: zwięzłe, praktyczne, po polsku, per "ty"
6. Jeśli pytanie wykracza poza bazę wiedzy — powiedz o tym wprost
```

### Implementacja Gemini (reużyj z CEO Masterclass)

```typescript
// lib/wikipedia/gemini.ts
// Identyczna implementacja jak w CEO Masterclass (SPEC_AI_EXTENSION.md)
// Ten sam klucz: GEMINI_API_KEY z .env.local
// Ten sam model: gemini-2.0-flash
// Streaming SSE identyczny
```

---

## Import danych początkowych

```typescript
// scripts/seed-wikipedia.ts
// Parsuje KNOWLEDGE_BUSINESS.md i tworzy artykuły w bazie

// Logika parsowania:
// # ROZDZIAŁ → category
// ## X.Y Tytuł → nowy artykuł (title = "X.Y Tytuł", slug = auto)
// ### / **** → treść artykułu w Markdown
// Visibility domyślna: "manager"
// Type domyślny: "knowledge"

// Uruchomienie: npx ts-node scripts/seed-wikipedia.ts
```

---

## Server Actions (`lib/wikipedia/actions.ts`)

```typescript
// Wszystkie z walidacją roli przez session/auth

export async function getArticles(filters: ArticleFilters, role: Role)
export async function getArticle(slug: string, role: Role)
export async function createArticle(data: ArticleInput)        // manager only
export async function updateArticle(id: string, data: ArticleInput) // manager only
export async function deleteArticle(id: string)                // manager only
export async function updateAuthorNote(id: string, note: string)    // manager only
export async function toggleVisibility(id: string)             // manager only
```

---

## Nawigacja w WallDecor App

Dodaj do zakładki "Manager":

```typescript
// Istniejące pozycje menu managera:
// - Dashboard / KPI
// - Budżet
// - Prowizje
// - HR
// + NOWE: Wikipedia (ikona: BookOpen)
```

---

## Instrukcje dla Claude Code

### Kolejność implementacji

**Subagent 1 — Baza danych:**
Migracja Prisma (Article + AiChatMessage + FTS5), seed script dla KNOWLEDGE_BUSINESS.md

**Subagent 2 — Server Actions + API:**
Wszystkie akcje CRUD z walidacją roli, logika wyszukiwania

**Subagent 3 — Lista i wyszukiwarka:**
`/manager/wikipedia` — ArticleList, ArticleCard, SearchBar, CategoryFilter

**Subagent 4 — Widok artykułu:**
`/manager/wikipedia/[slug]` — ArticleViewer (Markdown renderer), VisibilityBadge, AuthorNote

**Subagent 5 — Edytor:**
`/manager/wikipedia/new` i `/edit` — ArticleEditor z podglądem live

**Subagent 6 — AI Asystent:**
AiPanel + integracja Gemini (reużyj implementacji z CEO Masterclass)

### Uwagi techniczne
- Markdown renderer: `react-markdown` + `remark-gfm` + `rehype-highlight` (syntax highlighting)
- Edytor: `@uiw/react-md-editor` (lekki, split view, bez zależności od Quill/ProseMirror)
- FTS5: wymaga SQLite >= 3.9 (sprawdź wersję na serwerze przed migracją)
- Slug: generuj przez `slugify(title, { lower: true, strict: true })`
- Czas czytania: `Math.ceil(wordCount / 200)` minut
- Autosave: debounce 30s, zapisuj draft w localStorage pod kluczem `wiki-draft-${slug}`
- Tagi: przechowuj jako JSON string `'["tag1","tag2"]'`, parsuj przy odczycie
