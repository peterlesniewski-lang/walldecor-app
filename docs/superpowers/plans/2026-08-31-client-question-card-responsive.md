# Responsive Client Question Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep every client-form question title inside its card and make clearing an answer visually distinct from choosing an answer on desktop and mobile.

**Architecture:** Preserve `ClientQuestionRenderer` as the single renderer used by the public form, template preview, and readonly revision view. Add a small internal body wrapper and dedicated title/clear classes, then prove the behavior with component tests and geometry assertions in the existing Playwright client-form flow. No schema, API, autosave, or conditional-logic changes are required.

**Tech Stack:** Next.js 16, React 19, CSS Modules, Vitest, Testing Library, Playwright.

---

## File map

- Modify `src/components/installations/client-form/question-renderer.tsx`: shared semantic structure and clear-action labels.
- Modify `src/components/installations/client-form/client-installation-form.module.css`: responsive title, body, and quiet clear-action styling.
- Modify `__tests__/unit/installations/question-renderer.test.tsx`: behavior and accessible-label regression coverage.
- Modify `e2e/installations-client-form.spec.ts`: long real question plus responsive geometry and overflow assertions.

### Task 1: Lock the clear-action and semantic behavior with unit tests

**Files:**
- Modify: `__tests__/unit/installations/question-renderer.test.tsx`

- [ ] **Step 1: Write failing tests**

Add tests that render an optional selected `YES_NO_UNKNOWN` question and expect:

```tsx
expect(screen.getByRole('group', { name: 'Czy są glify?' })).not.toBeNull()
const clear = screen.getByRole('button', { name: 'Wyczyść wybór: Czy są glify?' })
await user.click(clear)
expect(onChange).toHaveBeenCalledWith(null)
```

Add a text-question case expecting visible text `Wyczyść odpowiedź`, and a required-question case proving that no clear action is rendered.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- __tests__/unit/installations/question-renderer.test.tsx
```

Expected: FAIL because the selected choice still exposes `Wyczyść odpowiedź` and has no dedicated choice label.

### Task 2: Implement the approved card structure and styles

**Files:**
- Modify: `src/components/installations/client-form/question-renderer.tsx`
- Modify: `src/components/installations/client-form/client-installation-form.module.css`

- [ ] **Step 1: Add focused renderer primitives**

Change `OptionalClear` to receive a `kind` of `choice` or `answer`, render a dedicated row, and keep the full question in the accessible name:

```tsx
const visibleLabel = kind === 'choice' ? 'Wyczyść wybór' : 'Wyczyść odpowiedź'
return <div className={styles.clearRow}>
  <button
    type="button"
    className={styles.clearAnswer}
    aria-label={`${visibleLabel}: ${question.label}`}
    onClick={() => onChange(null)}
  >{visibleLabel}</button>
</div>
```

For fieldset questions, assign the legend `questionTitle` and wrap help, controls, and clear action in `questionBody`. Apply the same `questionTitle` and `questionBody` hierarchy to label-based questions and readonly output.

- [ ] **Step 2: Add the responsive CSS contract**

Add dedicated rules equivalent to:

```css
.question { min-inline-size: 0; }
.questionTitle {
  float: left;
  inline-size: 100%;
  max-inline-size: 100%;
  margin: 0;
  padding: 0;
  overflow-wrap: anywhere;
}
.questionBody { clear: both; min-inline-size: 0; }
.clearRow { display: flex; justify-content: flex-end; margin-top: 8px; }
.clearAnswer {
  min-height: 44px;
  border: 0;
  background: transparent;
  color: #655e55;
  cursor: pointer;
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 3px;
}
```

Keep three choice columns by default and the existing one-column mobile breakpoint. Give `.clearAnswer` the existing focus-ring language without the hover lift used by answer buttons.

- [ ] **Step 3: Run unit tests and verify GREEN**

Run:

```bash
npm test -- __tests__/unit/installations/question-renderer.test.tsx __tests__/unit/installations/client-form-ui.test.tsx __tests__/unit/installations/form-revision-panel.test.tsx
```

Expected: all selected unit files PASS.

### Task 3: Prove mobile and desktop geometry in the real flow

**Files:**
- Modify: `e2e/installations-client-form.spec.ts`

- [ ] **Step 1: Use the reported long question in E2E data**

Set the root E2E question label and help to the real long grounding copy. Reuse one constant for setup and locators so the test cannot drift.

- [ ] **Step 2: Add responsive assertions**

After selecting an answer, loop through widths `360`, `430`, `768`, and `1280`. For each width assert:

```ts
await expectNoHorizontalOverflow(client)
expect(titleBox!.y).toBeGreaterThanOrEqual(cardBox!.y + 8)
expect(titleBox!.x + titleBox!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width - 8)
expect(clearBox!.y).toBeGreaterThanOrEqual(lastChoiceBox!.y + lastChoiceBox!.height + 7)
```

Also assert that computed clear-action border width is zero and its background is transparent.

- [ ] **Step 3: Run the focused E2E test**

Run:

```bash
npx playwright test e2e/installations-client-form.spec.ts --grep "admin sends an anonymous client link"
```

Expected: PASS at all four asserted widths with no horizontal overflow.

### Task 4: Final verification and commit

**Files:** all files listed above.

- [ ] **Step 1: Run static and focused verification**

```bash
npm run typecheck:app
npm test -- __tests__/unit/installations/question-renderer.test.tsx __tests__/unit/installations/client-form-ui.test.tsx __tests__/unit/installations/form-revision-panel.test.tsx
npx playwright test e2e/installations-client-form.spec.ts --grep "admin sends an anonymous client link"
```

Expected: every command exits `0`.

- [ ] **Step 2: Inspect the final diff**

Run `git diff --check` and confirm that only the renderer, its CSS module, the two test files, and this approved documentation changed.

- [ ] **Step 3: Commit the implementation**

```bash
git add src/components/installations/client-form/question-renderer.tsx \
  src/components/installations/client-form/client-installation-form.module.css \
  __tests__/unit/installations/question-renderer.test.tsx \
  e2e/installations-client-form.spec.ts \
  docs/superpowers/plans/2026-08-31-client-question-card-responsive.md
git commit -m "fix: refine responsive client question cards"
```
