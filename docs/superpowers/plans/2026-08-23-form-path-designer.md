# Projektant ścieżek i status formularza — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zbudować prosty projektant wielopoziomowych ścieżek formularza oraz pokazać prawdziwy status i czytelne historyczne odpowiedzi klienta na kartach montażu.

**Architecture:** Jeden czysty moduł oblicza widoczność pytań w przeglądarce i na serwerze. Kreator zapisuje nadal tę samą płaską, wersjonowaną listę pytań, ale przedstawia ją jako drzewo odpowiedzi. Status formularza jest projekcją rzeczywistych danych linku, szkicu i wysłanej wersji; historyczny podgląd zawsze korzysta z niemutowalnego snapshotu właściwej rewizji.

**Tech Stack:** Next.js 16.1, React 19, TypeScript 5.9, Prisma 5/SQLite, Zod 4, Vitest/Testing Library, Playwright, Tailwind i istniejący CSS Module formularza klienta.

---

## Kontekst, granice i odpowiedzialność

- Specyfikacja: `docs/superpowers/specs/2026-08-23-form-path-designer-design.md`.
- Gałąź robocza: `feature/installation-operations` w `/Users/piotr/projekty/walldecor-app-montaze`.
- Nie dodawać drag-and-drop, AND/OR, skoków między stronami ani wysyłki e-mail.
- Nie zmieniać opublikowanych szablonów ani historycznych snapshotów.
- Instalator nadal nie może zobaczyć odpowiedzi klienta, linków ani ustaleń.
- Każdy worker pracuje na współdzielonej gałęzi: nie cofa cudzych zmian i przed commitem sprawdza `git status --short`.

## Docelowy podział plików

- `src/lib/installations/form-visibility.ts` — typy pytań/odpowiedzi oraz rekurencyjna widoczność.
- `src/lib/installations/question-tree.ts` — czyste operacje drzewa używane wyłącznie przez kreator.
- `src/lib/installations/form-status.ts` — czysta projekcja statusu formularza na listę kart.
- `src/lib/installations/form-answer-display.ts` — czyste, polskie formatowanie wartości odpowiedzi używane przez UI i historię.
- `src/lib/installations/form-history.ts` — odczyt i polskie formatowanie historycznych odpowiedzi.
- `src/components/installations/client-form/question-renderer.tsx` — współdzielona prezentacja jednego pytania w trybie interaktywnym i tylko do odczytu.
- `src/components/installations/template-path-designer.tsx` — drzewo gałęzi oraz orkiestracja edytora.
- `src/components/installations/template-question-editor.tsx` — karta dodawania/edycji pytania bez kluczy technicznych.
- `src/components/installations/template-test-preview.tsx` — lokalne przejście szkicu bez fetch/autosave.
- `src/components/installations/form-revision-panel.tsx` — czytelna historia i `Podgląd jak klient`.
- Istniejące `template-builder.tsx`, `client-installation-form.tsx` i `installation-clarification-panel.tsx` pozostają orkiestratorami, a nie rosną o kolejne duże bloki JSX.

## Obowiązkowy checkpoint UI

Przed napisaniem każdego komponentu z Tasks 2, 4, 6 i 7 worker zapisuje w raporcie zadania checkpoint zgodny z `.interface-design/system.md`:

```text
Intent: pracownik projektuje lub sprawdza formularz bez technicznych kluczy; ma szybko rozumieć ścieżkę i stan
Palette: plaster/paper/sand/graphite oraz masking-tape tylko dla działania; semantyczne kolory tylko dla statusów
Depth: subtelne cienie wyłącznie dla warstw ponad rodzicem
Surfaces: poziom 0 plaster, poziom 1 paper, pola jako inset sand, podgląd jako poziom 2
Typography: panel Plus Jakarta Sans; podgląd klienta zachowuje Bricolage Grotesque i Spline Sans
Spacing: wyłącznie wielokrotności bazowych 4 px; kontrolki dotykowe minimum 44 px
```

Worker ponownie używa istniejących tokenów i wzorców. Nie dodaje nowej palety, dekoracyjnych gradientów ani generycznego zestawu kart.

### Task 1: Wspólny rekurencyjny silnik widoczności

**Suggested owner:** Terra xhigh — logika integralności.

**Files:**
- Create: `src/lib/installations/form-visibility.ts`
- Create: `__tests__/unit/installations/form-visibility.test.ts`
- Modify: `src/lib/installations/form-service.ts:1-61,113-132,288-371,542-605`
- Modify: `src/components/installations/client-form/client-installation-form.tsx:6-43,100-115`
- Modify: `__tests__/integration/installations/client-form.test.ts`

- [ ] **Step 1: Write failing recursive visibility tests**

```ts
import { describe, expect, it } from 'vitest'
import { evaluateVisibleFormQuestions, filterVisibleAnswerValues } from '@/lib/installations/form-visibility'

const questions = [
  { key: 'okna', type: 'YES_NO_UNKNOWN', label: 'Czy są okna?' },
  { key: 'glify', type: 'YES_NO_UNKNOWN', label: 'Czy tapetujemy glify?', condition: { questionKey: 'okna', equals: 'YES' } },
  { key: 'glebokosc', type: 'DIMENSION', label: 'Podaj głębokość', condition: { questionKey: 'glify', equals: 'YES' } },
] as const

describe('recursive form visibility', () => {
  it('requires the entire ancestor path even when a hidden parent has a stale value', () => {
    expect(evaluateVisibleFormQuestions(questions, { okna: 'NO', glify: 'YES' }).map(({ key }) => key)).toEqual(['okna'])
    expect(evaluateVisibleFormQuestions(questions, { okna: 'YES', glify: 'YES' }).map(({ key }) => key)).toEqual(['okna', 'glify', 'glebokosc'])
  })

  it('drops all answers from an inactive branch', () => {
    expect(filterVisibleAnswerValues(questions, { okna: 'NO', glify: 'YES', glebokosc: '12' })).toEqual({ okna: 'NO' })
  })
})
```

- [ ] **Step 2: Run the new test and verify RED**

Run: `npm test -- __tests__/unit/installations/form-visibility.test.ts`

Expected: FAIL because `@/lib/installations/form-visibility` does not exist.

- [ ] **Step 3: Implement the browser/server-safe evaluator**

```ts
export type FormAnswerValue = string | string[]
export type FormQuestion = {
  key: string
  type: 'YES_NO_UNKNOWN' | 'NUMBER' | 'DIMENSION' | 'TEXT' | 'SINGLE' | 'MULTI' | 'FILE'
  label: string
  help?: string
  required?: boolean
  riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH'
  options?: readonly string[]
  condition?: { questionKey: string; equals: string }
}

export function evaluateVisibleFormQuestions<T extends FormQuestion>(
  questions: readonly T[],
  answers: Record<string, FormAnswerValue | undefined>,
): T[] {
  const byKey = new Map(questions.map((question) => [question.key, question]))
  const memo = new Map<string, boolean>()
  const visiting = new Set<string>()
  const visible = (question: T): boolean => {
    const cached = memo.get(question.key)
    if (cached !== undefined) return cached
    if (!question.condition) { memo.set(question.key, true); return true }
    if (visiting.has(question.key)) return false
    const parent = byKey.get(question.condition.questionKey)
    if (!parent) return false
    visiting.add(question.key)
    const result = visible(parent) && typeof answers[parent.key] === 'string' && answers[parent.key] === question.condition.equals
    visiting.delete(question.key)
    memo.set(question.key, result)
    return result
  }
  return questions.filter(visible)
}

export function filterVisibleAnswerValues(
  questions: readonly FormQuestion[],
  answers: Record<string, FormAnswerValue | undefined>,
) {
  const keys = new Set(evaluateVisibleFormQuestions(questions, answers).map(({ key }) => key))
  return Object.fromEntries(Object.entries(answers).filter(([key, value]) => keys.has(key) && value !== undefined))
}
```

- [ ] **Step 4: Replace both shallow evaluators with the shared function**

In `form-service.ts`, alias the shared types and preserve the existing public export:

```ts
import {
  evaluateVisibleFormQuestions,
  type FormAnswerValue,
  type FormQuestion,
} from './form-visibility'
export { evaluateVisibleFormQuestions }
export type ClientFormQuestion = FormQuestion
export type ClientAnswerValue = FormAnswerValue
```

In `client-installation-form.tsx`, import the same function and remove the local `Question` and `visibleQuestions` duplicates.

- [ ] **Step 5: Add the persisted stale-descendant integration test**

Extend the real SQLite fixture so `okna=YES`, `glify=YES`, `glebokosc=12` is saved, then autosave `okna=NO`. Assert that `glify` and `glebokosc` no longer exist in `InstallationAnswer`, and that hidden required questions do not block submit.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
npm test -- __tests__/unit/installations/form-visibility.test.ts __tests__/unit/installations/form-rules.test.ts __tests__/unit/installations/client-form-ui.test.tsx __tests__/integration/installations/client-form.test.ts
```

Expected: all selected test files PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/installations/form-visibility.ts src/lib/installations/form-service.ts src/components/installations/client-form/client-installation-form.tsx __tests__/unit/installations/form-visibility.test.ts __tests__/unit/installations/form-rules.test.ts __tests__/unit/installations/client-form-ui.test.tsx __tests__/integration/installations/client-form.test.ts
git commit -m "fix(installations): evaluate complete form paths"
```

### Task 2: Współdzielony renderer pytania

**Suggested owner:** Luna high — izolowany komponent prezentacyjny; Sol sprawdza brak regresji publicznego formularza.

**Files:**
- Create: `src/lib/installations/form-answer-display.ts`
- Create: `src/components/installations/client-form/question-renderer.tsx`
- Create: `__tests__/unit/installations/question-renderer.test.tsx`
- Modify: `src/components/installations/client-form/client-installation-form.tsx:460-500`
- Modify: `src/components/installations/client-form/client-installation-form.module.css`

- [ ] **Step 1: Write failing interactive/read-only component tests**

```tsx
it('uses Polish values and never mutates in read-only mode', async () => {
  const onChange = vi.fn()
  render(<ClientQuestionRenderer question={{ key: 'okna', type: 'YES_NO_UNKNOWN', label: 'Czy są okna?' }} value="YES" mode="readonly" onChange={onChange} />)
  expect(screen.getByText('Czy są okna?')).toBeTruthy()
  expect(screen.getByText('Tak')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Tak' })).toBeNull()
  expect(onChange).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- __tests__/unit/installations/question-renderer.test.tsx`

Expected: FAIL because `ClientQuestionRenderer` does not exist.

- [ ] **Step 3: Implement one renderer with explicit modes**

```tsx
type Props = {
  question: FormQuestion
  value: FormAnswerValue | undefined
  mode: 'interactive' | 'readonly'
  onChange?: (value: FormAnswerValue | null) => void
  fileContent?: ReactNode
  idPrefix?: string
}

export function displayFormAnswer(value: FormAnswerValue | undefined) {
  if (value === 'YES') return 'Tak'
  if (value === 'NO') return 'Nie'
  if (value === 'UNKNOWN') return 'Nie wiem'
  if (Array.isArray(value)) return value.join(', ')
  return value || 'Brak odpowiedzi'
}
```

`displayFormAnswer` powstaje w czystym `src/lib/installations/form-answer-display.ts`. Renderer tylko go importuje. Dzięki temu kod serwerowy historii nigdy nie importuje komponentu React.

The readonly branch renders label, help and `displayFormAnswer(value)` as text/output. The interactive branch reproduces the existing controls for `YES_NO_UNKNOWN`, `SINGLE`, `MULTI`, `TEXT`, `NUMBER` and `DIMENSION`. `FILE` renders only the supplied `fileContent`; it must never start an upload itself.

- [ ] **Step 4: Make the public wrapper use the shared renderer**

Keep `ClientFileControl` and all token/network operations in `client-installation-form.tsx`. Replace the private non-file `QuestionControl` JSX with:

```tsx
return <ClientQuestionRenderer
  question={question}
  value={value}
  mode="interactive"
  onChange={onChange}
/>
```

- [ ] **Step 5: Run public UI regressions and verify GREEN**

Run:

```bash
npm test -- __tests__/unit/installations/question-renderer.test.tsx __tests__/unit/installations/client-form-ui.test.tsx __tests__/unit/installations/mobile-upload-ui.test.tsx
```

Expected: all selected tests PASS; upload tests prove no token/network behavior moved into the shared renderer.

- [ ] **Step 6: Commit**

```bash
git add src/lib/installations/form-answer-display.ts src/components/installations/client-form/question-renderer.tsx src/components/installations/client-form/client-installation-form.tsx src/components/installations/client-form/client-installation-form.module.css __tests__/unit/installations/question-renderer.test.tsx __tests__/unit/installations/client-form-ui.test.tsx
git commit -m "refactor(installations): share client question renderer"
```

### Task 3: Czysty model drzewa kreatora

**Suggested owner:** Terra high — kolejność i stabilność identyfikatorów.

**Files:**
- Create: `src/lib/installations/question-tree.ts`
- Create: `__tests__/unit/installations/question-tree.test.ts`

- [ ] **Step 1: Write failing tree-operation tests**

Cover these exact invariants:

```ts
const questions = [
  { key: 'pokoj-a', type: 'YES_NO_UNKNOWN', label: 'Pokój A' },
  { key: 'okna', type: 'YES_NO_UNKNOWN', label: 'Czy są okna?', condition: { questionKey: 'pokoj-a', equals: 'YES' } },
  { key: 'glify', type: 'YES_NO_UNKNOWN', label: 'Czy tapetujemy glify?', condition: { questionKey: 'okna', equals: 'YES' } },
  { key: 'glebokosc', type: 'DIMENSION', label: 'Głębokość glifów', condition: { questionKey: 'glify', equals: 'YES' } },
  { key: 'pokoj-b', type: 'YES_NO_UNKNOWN', label: 'Pokój B' },
] satisfies FormQuestion[]

it('moves only siblings and always flattens a parent before its descendants', () => {
  const moved = moveQuestionWithinBranch(questions, 'pokoj-b', 'UP')
  expect(moved.map(({ key }) => key)).toEqual(['pokoj-b', 'pokoj-a', 'okna', 'glify', 'glebokosc'])
})

it('deletes the complete descendant subtree', () => {
  expect(removeQuestionSubtree(questions, 'okna').map(({ key }) => key)).toEqual(['pokoj-a', 'pokoj-b'])
})

it('generates a stable unused key only for a new question', () => {
  expect(nextQuestionKey([{ key: 'question-1' }, { key: 'drzwi_ukryte' }])).toBe('question-2')
})
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- __tests__/unit/installations/question-tree.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement explicit tree contracts**

```ts
export type QuestionPlacement = { parentKey: string | null; equals: string | null }
export type QuestionTreeNode<T extends FormQuestion = FormQuestion> = {
  question: T
  branches: Array<{ value: string; label: string; children: QuestionTreeNode<T>[] }>
}

export function branchChoices(question: FormQuestion) {
  if (question.type === 'YES_NO_UNKNOWN') return [
    { value: 'YES', label: 'Tak' },
    { value: 'NO', label: 'Nie' },
    { value: 'UNKNOWN', label: 'Nie wiem' },
  ]
  if (question.type === 'SINGLE') return (question.options ?? []).map((value) => ({ value, label: value }))
  return []
}
```

Add `buildQuestionForest`, `flattenQuestionForest`, `moveQuestionWithinBranch`, `removeQuestionSubtree`, `appendQuestionAtPlacement` and `nextQuestionKey`. `flattenQuestionForest` must use preorder and preserve existing sibling order. Unvisited malformed/orphan records are appended without data loss so server validation can report the real error.

- [ ] **Step 4: Run and verify GREEN**

Run: `npm test -- __tests__/unit/installations/question-tree.test.ts __tests__/unit/installations/question-schema.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/installations/question-tree.ts __tests__/unit/installations/question-tree.test.ts
git commit -m "feat(installations): add form path tree operations"
```

### Task 4: Przyjazny projektant ścieżek i lokalny tryb testowy

**Suggested owner:** Luna xhigh — właściciel wyłącznie plików UI tej sekcji.

**Files:**
- Create: `src/components/installations/template-path-designer.tsx`
- Create: `src/components/installations/template-question-editor.tsx`
- Create: `src/components/installations/template-test-preview.tsx`
- Create: `__tests__/unit/installations/template-path-designer.test.tsx`
- Modify: `src/components/installations/template-builder.tsx`
- Modify: `__tests__/unit/installations/task2-corrective-ui.test.tsx`

- [ ] **Step 1: Write failing user-flow tests**

```tsx
it('adds a child under Tak without exposing technical conditions', async () => {
  render(<TemplateBuilder initialTemplates={[draftWithOkna]} />)
  expect(screen.queryByLabelText(/klucz pytania/i)).toBeNull()
  await user.click(screen.getByRole('button', { name: /Dodaj pytanie po odpowiedzi Tak/i }))
  await user.type(screen.getByLabelText('Treść pytania'), 'Czy tapetujemy glify?')
  await user.click(screen.getByRole('button', { name: 'Zapisz pytanie' }))
  const body = JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))
  expect(body.questions.at(-1).condition).toEqual({ questionKey: 'okna', equals: 'YES' })
})

it('test mode follows a three-level path without calling fetch', async () => {
  render(<TemplateTestPreview questions={nestedQuestions} />)
  await user.click(screen.getByRole('button', { name: 'Tak' }))
  expect(screen.getByText('Czy tapetujemy glify?')).toBeTruthy()
  await user.click(screen.getAllByRole('button', { name: 'Tak' })[1])
  expect(screen.getByText('Podaj głębokość glifów')).toBeTruthy()
  expect(fetchMock).not.toHaveBeenCalled()
})
```

Also test move within one branch, explicit subtree-delete confirmation, preservation of the existing key after label editing, reset of test answers, and warning for an invalid/unreachable draft.

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- __tests__/unit/installations/template-path-designer.test.tsx`

Expected: FAIL because the new components do not exist.

- [ ] **Step 3: Implement the editor contract**

```tsx
export function TemplateQuestionEditor({
  initial,
  placement,
  onCancel,
  onSave,
}: {
  initial?: FormQuestion
  placement: QuestionPlacement
  onCancel(): void
  onSave(question: FormQuestion): void
})

export function TemplatePathDesigner({
  questions,
  busy,
  onPersist,
}: {
  questions: FormQuestion[]
  busy: boolean
  onPersist(questions: FormQuestion[]): Promise<void>
})
```

The editor labels are Polish: `Treść pytania`, `Typ odpowiedzi`, `Pomoc dla klienta`, `Poziom ryzyka`, `Odpowiedź obowiązkowa`. Generate `nextQuestionKey` only when creating. Never render editable `questionKey`/`equals` inputs.

- [ ] **Step 4: Implement branch actions with the pure tree helper**

Use `appendQuestionAtPlacement`, `moveQuestionWithinBranch` and `removeQuestionSubtree`. Deletion first renders `Usunąć pytanie i N pytań podrzędnych?`; persistence happens only after explicit confirmation.

- [ ] **Step 5: Implement local `Edytuj / Testuj`**

```tsx
const [answers, setAnswers] = useState<Record<string, FormAnswerValue>>({})
const visible = evaluateVisibleFormQuestions(questions, answers)

return visible.map((question) => question.type === 'FILE'
  ? <ClientQuestionRenderer key={question.key} question={question} value={undefined} mode="readonly" fileContent="Pliki będą dostępne w formularzu klienta" />
  : <ClientQuestionRenderer key={question.key} question={question} value={answers[question.key]} mode="interactive" onChange={(value) => setAnswers((current) => value === null ? Object.fromEntries(Object.entries(current).filter(([key]) => key !== question.key)) : { ...current, [question.key]: value })} />)
```

Switching modes must not call the API and must not discard the editable question list.

- [ ] **Step 6: Keep `TemplateBuilder` responsible only for template lifecycle**

Retain create draft, select draft, publish, next version and `requestJson`. Replace its technical question form/list with `<TemplatePathDesigner questions={savedQuestions} onPersist={saveQuestions} />`.

- [ ] **Step 7: Run focused UI and catalog tests**

Run:

```bash
npm test -- __tests__/unit/installations/template-path-designer.test.tsx __tests__/unit/installations/task2-corrective-ui.test.tsx __tests__/unit/installations/catalog-routes.test.ts __tests__/integration/installations/catalog-template.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/installations/template-builder.tsx src/components/installations/template-path-designer.tsx src/components/installations/template-question-editor.tsx src/components/installations/template-test-preview.tsx __tests__/unit/installations/template-path-designer.test.tsx __tests__/unit/installations/task2-corrective-ui.test.tsx
git commit -m "feat(installations): add visual form path designer"
```

### Task 5: Ręczne, audytowane `Oznacz jako wysłany`

**Suggested owner:** Terra xhigh — migracja i idempotencja.

**Files:**
- Modify: `prisma/schema.prisma:820-838`
- Create: `prisma/migrations/20260823080000_installation_client_link_sent/migration.sql`
- Modify generated client: `src/generated/prisma/**`
- Modify: `src/lib/installations/client-link.ts:114-172,318-324`
- Modify: `src/app/api/installations/[id]/client-link/route.ts`
- Modify: `src/components/installations/client-link-panel.tsx`
- Modify: `__tests__/unit/installations/client-link-clarification-routes.test.ts`
- Modify: `__tests__/unit/installations/client-link-clarification-panels.test.tsx`
- Modify: `__tests__/integration/installations/client-form.test.ts`

- [ ] **Step 1: Write failing service/route/panel tests**

Assert that `MARK_SENT` requires editable access, accepts only `{ action: 'MARK_SENT', linkId }`, returns `sentAt/sentById`, the panel sends that exact body, repeat calls keep the first timestamp/actor, and revoked/expired links are rejected.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
npm test -- __tests__/unit/installations/client-link-clarification-routes.test.ts __tests__/unit/installations/client-link-clarification-panels.test.tsx __tests__/integration/installations/client-form.test.ts
```

Expected: FAIL because `MARK_SENT` and the columns do not exist.

- [ ] **Step 3: Add the additive migration and Prisma fields**

```sql
ALTER TABLE "InstallationClientLink" ADD COLUMN "sentAt" DATETIME;
ALTER TABLE "InstallationClientLink" ADD COLUMN "sentById" TEXT;
CREATE INDEX "InstallationClientLink_orderId_sentAt_idx" ON "InstallationClientLink"("orderId", "sentAt");
```

```prisma
sentAt   DateTime?
sentById String?

@@index([orderId, sentAt])
```

Run: `npx prisma generate`

Expected: custom client under `src/generated/prisma` regenerates successfully.

- [ ] **Step 4: Implement idempotent compare-and-set plus audit**

```ts
export async function markClientLinkSent(db: PrismaClient, linkId: string, actorId: string, expectedOrderId?: string) {
  return db.$transaction(async (tx) => {
    const now = new Date()
    const link = await tx.installationClientLink.findUnique({ where: { id: linkId } })
    if (!link || link.revokedAt || link.expiresAt <= now || (expectedOrderId && link.orderId !== expectedOrderId)) throw new InstallationClientLinkNotFoundError()
    if (link.sentAt) return link
    const claimed = await tx.installationClientLink.updateMany({ where: { id: link.id, sentAt: null, revokedAt: null, expiresAt: { gt: now } }, data: { sentAt: now, sentById: actorId } })
    if (claimed.count === 1) await tx.installationAuditEvent.create({ data: { orderId: link.orderId, actorId, action: 'INSTALLATION_CLIENT_LINK_SENT', metadataJson: JSON.stringify({ linkId: link.id, sentAt: now.toISOString() }) } })
    return tx.installationClientLink.findUniqueOrThrow({ where: { id: link.id } })
  })
}
```

- [ ] **Step 5: Wire the strict PATCH action and safe projection**

Add `MARK_SENT` to the Zod discriminated union, call the service with `session.user.id`, and include `sentAt/sentById` in `safeLink` and `listClientLinkStatuses`. Preserve Next.js 16 `params: Promise` handling.

- [ ] **Step 6: Add the panel action**

For an active unsent link render `Oznacz jako wysłany`; after success show `Wysłano: <data>` and remove the button. Generating a new link starts again with `sentAt=null`.

- [ ] **Step 7: Run migration-focused and selected tests**

Run:

```bash
npm test -- __tests__/unit/installations/client-link-clarification-routes.test.ts __tests__/unit/installations/client-link-clarification-panels.test.tsx __tests__/integration/installations/client-form.test.ts
```

Expected: PASS, including exactly one audit row after two mark-sent requests.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260823080000_installation_client_link_sent src/generated/prisma src/lib/installations/client-link.ts 'src/app/api/installations/[id]/client-link/route.ts' src/components/installations/client-link-panel.tsx __tests__/unit/installations/client-link-clarification-routes.test.ts __tests__/unit/installations/client-link-clarification-panels.test.tsx __tests__/integration/installations/client-form.test.ts
git commit -m "feat(installations): track client form sent time"
```

### Task 6: Prawdziwy status formularza na liście kart

**Suggested owner:** Terra high dla projekcji danych, Luna high dla prezentacji; wykonać sekwencyjnie w jednym commicie.

**Files:**
- Create: `src/lib/installations/form-status.ts`
- Create: `__tests__/unit/installations/form-status.test.ts`
- Modify: `src/lib/installations/order-service.ts:12-19,165-171`
- Modify: `src/components/installations/order-list.tsx`
- Modify: `__tests__/unit/installations/order-rules.test.ts`
- Modify: `__tests__/integration/installations/client-form.test.ts`

- [ ] **Step 1: Write the complete status precedence test**

```ts
expect(deriveInstallationFormStatus({ hasSnapshot: false, activeLink: null, hasDraft: false, hasSubmitted: false, openBlockingCount: 0 }).code).toBe('NO_FORM')
expect(deriveInstallationFormStatus({ hasSnapshot: true, activeLink: null, hasDraft: false, hasSubmitted: false, openBlockingCount: 0 }).code).toBe('READY_TO_SEND')
expect(deriveInstallationFormStatus({ hasSnapshot: true, activeLink: { sentAt: null, lastOpenedAt: null }, hasDraft: false, hasSubmitted: false, openBlockingCount: 0 }).code).toBe('READY_TO_SEND')
expect(deriveInstallationFormStatus({ hasSnapshot: true, activeLink: { sentAt: new Date(), lastOpenedAt: null }, hasDraft: false, hasSubmitted: false, openBlockingCount: 0 }).code).toBe('WAITING')
expect(deriveInstallationFormStatus({ hasSnapshot: true, activeLink: { sentAt: new Date(), lastOpenedAt: new Date() }, hasDraft: true, hasSubmitted: false, openBlockingCount: 0 }).code).toBe('IN_PROGRESS')
expect(deriveInstallationFormStatus({ hasSnapshot: true, activeLink: null, hasDraft: true, hasSubmitted: true, openBlockingCount: 1 })).toMatchObject({ code: 'COMPLETED', requiresClarification: true })
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- __tests__/unit/installations/form-status.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement a pure derived status**

```ts
export type InstallationFormStatusCode = 'NO_FORM' | 'READY_TO_SEND' | 'WAITING' | 'IN_PROGRESS' | 'COMPLETED'
const labels = {
  NO_FORM: 'Brak formularza',
  READY_TO_SEND: 'Do wysłania',
  WAITING: 'Wysłany · czeka na klienta',
  IN_PROGRESS: 'Rozpoczęty',
  COMPLETED: 'Wypełniony',
} satisfies Record<InstallationFormStatusCode, string>

export function deriveInstallationFormStatus(facts: FormStatusFacts) {
  const code: InstallationFormStatusCode = !facts.hasSnapshot ? 'NO_FORM'
    : facts.hasSubmitted ? 'COMPLETED'
    : facts.hasDraft || Boolean(facts.activeLink?.lastOpenedAt) ? 'IN_PROGRESS'
    : facts.activeLink?.sentAt ? 'WAITING'
    : 'READY_TO_SEND'
  return { code, label: labels[code], requiresClarification: facts.openBlockingCount > 0 }
}
```

- [ ] **Step 4: Add a list-only Prisma projection**

Do not expand the shared `orderInclude`. In `listInstallationOrders`, query the normal list fields plus only:

```ts
formSnapshots: { select: { id: true }, take: 1 },
clientLinks: { where: { revokedAt: null, expiresAt: { gt: now } }, select: { id: true, sentAt: true, lastOpenedAt: true }, orderBy: { createdAt: 'desc' }, take: 1 },
formSubmissions: { select: { status: true, draftKey: true }, orderBy: { revisionNumber: 'desc' } },
clarifications: { where: { status: 'OPEN', isBlocking: true }, select: { id: true } },
```

Map relations to one `clientFormStatus` object and remove those auxiliary arrays from the returned list item. Never load `answers`.

- [ ] **Step 5: Render icon plus text on each card**

Add a second badge beside the installation status. Use one Lucide icon selected by code and a separate `Wymaga ustalenia` badge when `requiresClarification=true`. Keep the whole card as one link and retain accessible text.

- [ ] **Step 6: Add real-query integration proof**

In the SQLite test create snapshot → link → mark sent → open → submit → clarification and assert the list projection after every transition. Also assert the query result does not expose `answers`.

- [ ] **Step 7: Run focused tests and commit**

Run:

```bash
npm test -- __tests__/unit/installations/form-status.test.ts __tests__/unit/installations/order-rules.test.ts __tests__/integration/installations/client-form.test.ts
```

Expected: PASS.

```bash
git add src/lib/installations/form-status.ts src/lib/installations/order-service.ts src/components/installations/order-list.tsx __tests__/unit/installations/form-status.test.ts __tests__/unit/installations/order-rules.test.ts __tests__/integration/installations/client-form.test.ts
git commit -m "feat(installations): show client form status on orders"
```

### Task 7: Historyczne pytanie–odpowiedź i `Podgląd jak klient`

**Suggested owner:** Terra high dla projekcji historycznej, Luna xhigh dla komponentu; sekwencyjnie, ponieważ obie części uzgadniają jeden typ danych.

**Files:**
- Create: `src/lib/installations/form-history.ts`
- Create: `__tests__/unit/installations/form-history.test.ts`
- Create: `src/components/installations/form-revision-panel.tsx`
- Create: `__tests__/unit/installations/form-revision-panel.test.tsx`
- Modify: `src/lib/installations/form-service.ts:645-675`
- Modify: `src/components/installations/installation-clarification-panel.tsx`
- Modify: `src/components/installations/order-detail.tsx`
- Modify: `src/app/(dashboard)/installations/[id]/page.tsx`
- Modify: `__tests__/unit/installations/client-link-clarification-panels.test.tsx`
- Modify: `__tests__/unit/installations/task2-corrective-ui.test.tsx`
- Modify: `__tests__/integration/installations/client-form.test.ts`

- [ ] **Step 1: Write failing history formatter tests**

```ts
expect(formatHistoricalAnswer(question('drzwi', 'Czy są drzwi ukryte?'), { valueJson: '{"type":"YES_NO_UNKNOWN","value":"NO"}', normalizedValue: 'NO' }))
  .toMatchObject({ label: 'Czy są drzwi ukryte?', value: 'Nie' })
expect(formatHistoricalAnswer(question('kolory', 'Kolory'), { valueJson: '{"type":"MULTI","value":["beż","biel"]}', normalizedValue: 'beż|biel' }).value)
  .toBe('beż, biel')
expect(formatHistoricalAnswer(undefined, { valueJson: '{"type":"TEXT","value":"stara odpowiedź"}', normalizedValue: 'stara odpowiedź' }).label)
  .toBe('Pytanie archiwalne')
```

Also cover malformed `schemaJson` without throwing.

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- __tests__/unit/installations/form-history.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement snapshot parsing and display mapping**

```ts
export type HistoricalAnswerView = {
  questionKey: string
  label: string
  type: FormQuestion['type'] | 'ARCHIVED'
  value: FormAnswerValue | undefined
  displayValue: string
  isUnknown: boolean
}

export function formatHistoricalAnswer(question: FormQuestion | undefined, answer: PersistedAnswerInput): HistoricalAnswerView {
  const value = safelyParseStoredValue(answer.valueJson, answer.normalizedValue)
  return {
    questionKey: answer.questionKey,
    label: question?.label ?? 'Pytanie archiwalne',
    type: question?.type ?? 'ARCHIVED',
    value,
    displayValue: displayFormAnswer(value),
    isUnknown: answer.isUnknown,
  }
}
```

Import `displayFormAnswer` from `src/lib/installations/form-answer-display.ts`; `form-history.ts` nie może importować komponentu React.

Keep the key internally for audit/actions, but do not render it in the default history UI.

- [ ] **Step 4: Return display-ready revisions from the immutable snapshot**

Change `listInstallationFormRevisions` to select `formSnapshot.schemaJson/templateVersion` plus answer `valueJson`, `normalizedValue`, `isUnknown`, `questionType`. Parse each revision separately. Change `listInstallationClarifications` to add `questionLabel` from its source submission snapshot, so clarification headings stop exposing raw keys too.

- [ ] **Step 5: Write the failing preview component test**

```tsx
it('opens a read-only client-style preview without mutation controls', async () => {
  render(<InstallationFormRevisionPanel revisions={[submittedRevision]} />)
  await user.click(screen.getByRole('button', { name: 'Podgląd jak klient · wersja 1' }))
  expect(screen.getByText('Czy są drzwi ukryte?')).toBeTruthy()
  expect(screen.getByText('Nie')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Wyślij formularz' })).toBeNull()
  expect(screen.queryByText('drzwi_ukryte')).toBeNull()
})
```

- [ ] **Step 6: Implement the revision panel**

The collapsed card shows version, submission date and readable Q/A rows. `Podgląd jak klient` opens an in-page, full-width disclosure using `<ClientQuestionRenderer mode="readonly">` in snapshot order. It receives no token and has no fetch effect. `Zamknij podgląd` restores focus to the opener.

For `FILE`, show read-only filenames only when coordinator file metadata for that exact `formSubmissionId + questionKey` is already available; otherwise show `Pliki są zapisane w sekcji dokumentów`. Do not add public download behavior.

- [ ] **Step 7: Replace raw revision JSX and preserve privacy**

Move `formRevisions` rendering out of `InstallationClarificationPanel` into `InstallationFormRevisionPanel`. Keep the entire panel under the existing `canCoordinateClientForm` path; update the installer privacy test to continue asserting that neither answers nor preview controls are rendered.

- [ ] **Step 8: Run focused tests and commit**

Run:

```bash
npm test -- __tests__/unit/installations/form-history.test.ts __tests__/unit/installations/form-revision-panel.test.tsx __tests__/unit/installations/client-link-clarification-panels.test.tsx __tests__/unit/installations/task2-corrective-ui.test.tsx __tests__/unit/installations/installer-order-page-privacy.test.tsx __tests__/integration/installations/client-form.test.ts
```

Expected: PASS.

```bash
git add src/lib/installations/form-history.ts src/lib/installations/form-service.ts src/components/installations/form-revision-panel.tsx src/components/installations/installation-clarification-panel.tsx src/components/installations/order-detail.tsx 'src/app/(dashboard)/installations/[id]/page.tsx' __tests__/unit/installations/form-history.test.ts __tests__/unit/installations/form-revision-panel.test.tsx __tests__/unit/installations/client-link-clarification-panels.test.tsx __tests__/unit/installations/task2-corrective-ui.test.tsx __tests__/unit/installations/installer-order-page-privacy.test.tsx __tests__/integration/installations/client-form.test.ts
git commit -m "feat(installations): show readable client form history"
```

### Task 8: Browser proof and complete regression gate

**Suggested owner:** Sol — integracja, review i dowód działania.

**Files:**
- Modify: `e2e/installations-client-form.spec.ts`
- Modify only if a real defect is found: files owned by Tasks 1–7

- [ ] **Step 1: Extend the E2E fixture to three nesting levels**

Create `okna` as the root, make `glify` conditional on `okna=YES`, and keep `glify-cm` conditional on `glify=YES`. Prove that changing `okna` to `NO` hides both descendants even after `glify=YES` was previously saved.

- [ ] **Step 2: Prove the operational status lifecycle**

In the same browser scenario:

1. pin snapshot and verify `Do wysłania` on `/installations`;
2. generate link, click `Oznacz jako wysłany`, verify `Wysłany · czeka na klienta`;
3. open the public link, verify `Rozpoczęty`;
4. submit, verify `Wypełniony` plus `Wymaga ustalenia` when `Nie wiem` creates a blocking clarification.

- [ ] **Step 3: Prove readable history and read-only preview**

After submission, assert the full Polish question and answer, open `Podgląd jak klient`, verify client-style question layout, and assert the absence of `Wyślij formularz`, upload controls, raw question keys and any autosave request.

- [ ] **Step 4: Prove keyboard and narrow-screen usability**

Run the designer flow once with keyboard navigation and once in a mobile viewport. Assert that branch actions, confirmation and `Edytuj / Testuj` remain reachable, focus is visible, and the document does not overflow horizontally.

- [ ] **Step 5: Run the targeted browser scenario**

Run: `npm run test:e2e -- e2e/installations-client-form.spec.ts`

Expected: Chromium scenario PASS against a newly migrated isolated SQLite database under `/tmp`.

- [ ] **Step 6: Commit E2E proof**

```bash
git add e2e/installations-client-form.spec.ts
git commit -m "test(installations): cover form paths and status lifecycle"
```

- [ ] **Step 7: Run the complete verification gate**

Run in this order:

```bash
npm test
npm run test:e2e
npm run build
git status --short
```

Expected:

- all Vitest unit/integration files PASS;
- all Playwright installation scenarios PASS;
- Next.js production build PASS, including dynamic route `params: Promise` checks;
- `git status --short` is empty except explicitly identified pre-existing user files.

- [ ] **Step 8: Independent review before completion**

Reviewer checks the implementation against all 18 acceptance criteria in the spec, confirms no public token/answer leakage, verifies the migration on both a fresh database and a copy upgraded through all migrations, and records exact test/build output. A green health endpoint alone is not completion evidence.

## Execution order and token control

1. Terra: Tasks 1 and 3.
2. Luna: Task 2, then Task 4.
3. Terra: Task 5 and data part of Task 6.
4. Luna: UI part of Task 6 and Task 7 after the projection type is committed.
5. Sol: Task 8, integration fixes, code review and final evidence.

Do not run parallel workers against the same files. Stop after any task whose focused tests are not green; fix that task before delegating the next one. This keeps the remaining token budget predictable and every commit independently reviewable.
