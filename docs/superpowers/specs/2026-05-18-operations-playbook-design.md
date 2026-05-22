# Operations Playbook Design

## Context

WallDecor App already has a protected dashboard, finance modules, HR modules, alerts, and a Business Wikipedia module at `/knowledge`.

The current month-end accounting process lives in a Google Doc. It is painful to repeat, hard to delegate, and mixes task completion with informal instructions. The goal is to move this into the CEO portal as an operational system: reusable procedures, checklist templates, and per-month execution tracking.

The production app already includes a Business Wikipedia implementation with:
- `Article` and `AiChatMessage` Prisma models.
- `/knowledge` article list, article view, create, and edit routes.
- Markdown editor and renderer components in `src/components/wikipedia`.
- Search/filter UI and role-based article visibility.

The new feature should reuse those knowledge patterns where they fit, but it should remain a distinct product area focused on work execution.

## Product Direction

Add a new sidebar section named **Operacje**.

Operacje is not only an accounting checklist. It is a generic operational playbook for company procedures:
- Finance: month-end accounting, FV/PA, KSeF.
- Customer service: complaints, returns, exchanges.
- Sales: salon process, order handling.
- HR/onboarding: new employee procedures.
- Other company processes as they become repeatable.

The first shipped module is **Finanse -> Koniec miesiąca**, because it solves the current high-friction process.

`/knowledge` remains the general business encyclopedia. `/operations` becomes executable operational knowledge: procedures attached to checklist templates and concrete runs.

## User Goals

Owner/Admin:
- Create and maintain operational procedures.
- Create reusable checklist templates.
- Start a monthly execution from a template.
- See progress and blockers for a specific month.
- Delegate tasks with enough how-to context that a worker can complete them without extra explanation.

Manager:
- Start executions from approved templates.
- Assign tasks.
- Track progress and update task states.

Employee:
- See assigned tasks.
- Open a task and read the linked procedure on the same screen.
- Mark a task as in progress, blocked, or done.
- Add a short note when blocked.

## Information Architecture

Sidebar:
- Operacje
  - Procedury
  - Szablony
  - Wykonania

Routes:
- `/operations` - section landing page with active runs and module cards.
- `/operations/procedures` - operational procedure library.
- `/operations/templates` - checklist template library.
- `/operations/templates/[id]` - template editor and item list.
- `/operations/runs` - execution list.
- `/operations/runs/[id]` - main work screen: checklist and selected procedure side by side.

The main work screen should use a split layout:
- Left: run progress and checklist items.
- Right: selected task details and how-to procedure content.

## Domain Model

Add these Prisma models:

```prisma
model OperationArea {
  id          String   @id @default(cuid())
  name        String
  slug        String   @unique
  description String?
  order       Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model OperationModule {
  id          String        @id @default(cuid())
  areaId      String
  area        OperationArea @relation(fields: [areaId], references: [id])
  name        String
  slug        String        @unique
  description String?
  order       Int           @default(0)
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt
}

model ChecklistTemplate {
  id          String          @id @default(cuid())
  moduleId    String
  module      OperationModule @relation(fields: [moduleId], references: [id])
  name        String
  description String?
  active      Boolean         @default(true)
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt
}

model ChecklistTemplateItem {
  id             String            @id @default(cuid())
  templateId     String
  template       ChecklistTemplate @relation(fields: [templateId], references: [id])
  title          String
  description    String?
  order          Int
  procedureId    String?
  defaultOwnerId String?
  dueDayOffset   Int?
  createdAt      DateTime          @default(now())
  updatedAt      DateTime          @updatedAt
}

model ChecklistRun {
  id          String            @id @default(cuid())
  templateId  String
  template    ChecklistTemplate @relation(fields: [templateId], references: [id])
  name        String
  periodYear  Int
  periodMonth Int?
  status      String            @default("open") // open | closed | archived
  createdById String
  createdAt   DateTime          @default(now())
  updatedAt   DateTime          @updatedAt
}

model ChecklistRunItem {
  id              String       @id @default(cuid())
  runId           String
  run             ChecklistRun @relation(fields: [runId], references: [id])
  templateItemId  String?
  title           String
  description     String?
  order           Int
  procedureId     String?
  ownerId         String?
  status          String       @default("todo") // todo | in_progress | blocked | done
  note            String?
  completedAt     DateTime?
  completedById   String?
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt
}
```

`procedureId` should point to an `Article.id` where `Article.type = "procedure"`. Prisma cannot enforce that type constraint directly, so application code must validate it.

Do not merge operational runs into `Article`. Articles are reusable knowledge. Runs are mutable execution records.

## Procedure Strategy

Reuse the existing Wikipedia/Knowledge components:
- `ArticleEditor` for creating/editing operational procedures when practical.
- `ArticleViewer` for rendering how-to content in run detail.
- `SearchBar`, `CategoryFilter`, and card patterns where they fit the operations UI.

Operational procedures should be stored as `Article` records with:
- `type = "procedure"`.
- `category = "company"` for generic procedures, or an existing category where useful.
- Tags such as `operations`, `finance`, `month-end`, `ksef`.

Operations screens should filter to operational procedures instead of showing the whole encyclopedia.

## MVP Screens

### `/operations`

Landing screen:
- Header: "Operacje".
- Active runs summary.
- Module cards grouped by area.
- Shortcut to "Koniec miesiąca".

### `/operations/procedures`

Operational procedure library:
- Search/filter.
- Cards similar to Encyklopedia.
- New procedure button for Admin/Manager.
- Procedure cards should show module/area context if linked to templates.

### `/operations/templates`

Template library:
- List active templates.
- Create/edit templates for Admin.
- First seeded template: "Księgowość - koniec miesiąca".

### `/operations/templates/[id]`

Template editor:
- Template metadata.
- Ordered item list.
- Each item can link to a procedure and default owner.
- Admin can add, edit, remove, and reorder items.

### `/operations/runs`

Execution list:
- Filter by status, area/module, year/month.
- Show progress as done/total and blocked count.
- Button to start a run from a template.

### `/operations/runs/[id]`

Main execution screen:
- Header with run name, period, progress, status.
- Left checklist column with fixed row height and status markers.
- Right panel with selected item details and linked procedure content.
- Status actions: todo, in progress, blocked, done.
- Note field for blockers.

## Month-End Accounting Seed

Seed initial data:
- Operation area: Finanse.
- Operation module: Koniec miesiąca.
- Checklist template: Księgowość - koniec miesiąca.
- Procedure articles for the most important how-to tasks.
- Template items based on the current Google Doc checklist.

Initial template items:
- Raport miesięczny z kasy fiskalnej.
- Raport kasowy Subiekt GT dla obu magazynów.
- Saldo rachunków bankowych.
- Rejestr VAT sprzedaży.
- Skan faktur papierowych i dodanie do Google Drive.
- Faktury kosztowe z Google Drive do Saldeo.
- Faktury zakupowe z Google Drive do Saldeo.
- JPK VAT sprzedaż dla biura księgowego.
- Zestawienie WZ/PZ dla każdego punktu.
- Eksport FV sprzedaż.
- Korekty faktur.
- Parkometry / FLOWBIRD.
- Faktury kosztowe do ściągnięcia: Google Ads, Google GSuite, Facebook/Meta, Microsoft/dysk, leasing BMW, Allegro/Amazon.

The seed content can be concise. The app must make it editable.

## Permissions

Admin:
- Full CRUD for areas, modules, procedure articles, templates, runs, and run items.

Manager:
- Create runs from templates.
- Assign run items.
- Update run item statuses and notes.
- Read procedure content.

Employee:
- Read assigned run items and linked procedures.
- Update own assigned run item status and note.
- No template/procedure management in MVP.

For the first implementation, the UI may show full run details to Admin and Manager. Employee filtering can be enforced at the API/action layer and refined in UI after the core flow is stable.

## Out Of Scope For MVP

- File attachments.
- Comment threads.
- Versioned procedure snapshots.
- Automatic reminders and notifications.
- Google Drive integration.
- KSeF integration.
- Approval workflows.
- Audit log beyond timestamps and completedBy.

## Testing

Required tests:
- Creating a run from a template copies item titles, descriptions, order, linked procedures, and default owners.
- Creating a run from an empty template fails validation.
- Employee cannot create templates or procedures.
- Employee can update status/note on an assigned run item.
- Admin/Manager can see progress and blocked count for a run.

Suggested E2E smoke:
- Admin opens Operacje.
- Creates or opens "Księgowość - koniec miesiąca".
- Starts a monthly run.
- Opens run detail.
- Selects an item, reads the procedure, marks it done.

## Implementation Notes

- Use TypeScript strict.
- Use Prisma through `src/generated/prisma`.
- Use Zod validation for API inputs.
- Follow existing Next.js 16 route handler convention: dynamic `params` is a Promise.
- Prefer Server Components for page shells, Client Components only for interactive checklist/editor screens.
- UI text remains Polish. Code and model names remain English.
- Reuse `lucide-react` icons.
- Keep visuals consistent with the current WallDecor design system and the Encyklopedia page.
