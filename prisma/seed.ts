import { PrismaClient } from '../src/generated/prisma'
import bcrypt from 'bcryptjs'
import * as fs from 'fs'
import * as path from 'path'
import { defaultCostTagSeedRows } from '../src/lib/finance/cost-tags'

const prisma = new PrismaClient()

// ─── Wikipedia seed helpers ───────────────────────────────────────────────────

const WIKI_CATEGORY_MAP: Record<string, string> = {
  'ZARZĄDZANIE I PRZYWÓDZTWO': 'management',
  'FINANSE I PŁYNNOŚĆ': 'finance',
  'SPRZEDAŻ I NEGOCJACJE': 'sales',
  'MARKETING I BRANDING': 'marketing',
  'PROCESY I AUTOMATYZACJA': 'processes',
  'PSYCHOLOGIA WŁAŚCICIELA': 'psychology',
  'STRATEGIA I ROZWÓJ FIRMY': 'strategy',
  'STRATEGIA I ROZWÓJ': 'strategy',
}

function wikiSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/ą/g, 'a').replace(/ć/g, 'c').replace(/ę/g, 'e').replace(/ł/g, 'l')
    .replace(/ń/g, 'n').replace(/ó/g, 'o').replace(/ś/g, 's').replace(/ź/g, 'z').replace(/ż/g, 'z')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function parseKnowledgeBase(): Array<{ title: string; slug: string; content: string; category: string }> {
  const mdPath = path.join(__dirname, '../ceo-module/KNOWLEDGE_BUSINESS.md')
  if (!fs.existsSync(mdPath)) {
    console.warn('KNOWLEDGE_BUSINESS.md not found, skipping Wikipedia seed')
    return []
  }

  const lines = fs.readFileSync(mdPath, 'utf-8').split('\n')
  const articles: Array<{ title: string; slug: string; content: string; category: string }> = []
  let currentCategory = 'management'
  let currentTitle: string | null = null
  let currentSlug: string | null = null
  let contentLines: string[] = []

  function flush() {
    if (currentTitle && contentLines.join('').trim().length > 50) {
      articles.push({ title: currentTitle, slug: currentSlug!, content: contentLines.join('\n').trim(), category: currentCategory })
    }
    currentTitle = null; currentSlug = null; contentLines = []
  }

  for (const line of lines) {
    const sectionMatch = line.match(/^# \d+\.\s+(.+)$/)
    if (sectionMatch) {
      flush()
      const name = sectionMatch[1].trim().toUpperCase()
      for (const [key, val] of Object.entries(WIKI_CATEGORY_MAP)) {
        if (name.includes(key) || key.includes(name)) { currentCategory = val; break }
      }
      continue
    }
    const articleMatch = line.match(/^## (\d+\.\d+)\s+(.+)$/)
    if (articleMatch) {
      flush()
      currentTitle = `${articleMatch[1]} ${articleMatch[2].trim()}`
      currentSlug = wikiSlug(`${articleMatch[1]}-${articleMatch[2].trim()}`)
      contentLines = [`## ${articleMatch[2].trim()}\n`]
      continue
    }
    if (currentTitle) contentLines.push(line)
  }
  flush()
  return articles
}

const COST_CENTERS = [
  { id: 'JAG', name: 'Salon Jagiellońska', description: 'Salon stacjonarny przy ul. Jagiellońskiej' },
  { id: 'PUL', name: 'Salon Puławska + eCommerce', description: 'Salon stacjonarny przy ul. Puławskiej oraz sklep internetowy' },
  { id: 'GLOBAL', name: 'Koszty centralne', description: 'Koszty wspólne całej firmy' },
]

const ACCOUNT_CATEGORIES = [
  {
    name: 'Customer Acquisition',
    order: 1,
    subCategories: [
      { name: 'SEO/Linkowanie', order: 1 },
      { name: 'AdWords/Google Ads', order: 2 },
      { name: 'AI Tools', order: 3 },
      { name: 'Abonament sklepu internetowego', order: 4 },
      { name: 'Facebook/Instagram Ads', order: 5 },
      { name: 'Influencer Marketing', order: 6 },
      { name: 'Email Marketing', order: 7 },
      { name: 'Targi/Wystawy', order: 8 },
      { name: 'Materiały reklamowe', order: 9 },
    ],
  },
  {
    name: 'Cost of Service',
    order: 2,
    subCategories: [
      { name: 'Prowizje terminali', order: 1 },
      { name: 'Google Suite', order: 2 },
      { name: 'Pipedrive CRM', order: 3 },
      { name: 'Oprogramowanie', order: 4 },
      { name: 'Inne koszty usług', order: 5 },
    ],
  },
  {
    name: 'Office/General Administrative',
    order: 3,
    subCategories: [
      { name: 'Czynsz JAG', order: 1 },
      { name: 'Czynsz PUL', order: 2 },
      { name: 'Prąd JAG', order: 3 },
      { name: 'Prąd PUL', order: 4 },
      { name: 'Internet/Telefon', order: 5 },
      { name: 'Sprzątanie', order: 6 },
      { name: 'Materiały biurowe', order: 7 },
      { name: 'Szkolenia', order: 8 },
      { name: 'Rekrutacja', order: 9 },
      { name: 'Ubezpieczenie biurowe', order: 10 },
      { name: 'Serwis urządzeń', order: 11 },
      { name: 'Opłaty bankowe', order: 12 },
      { name: 'Księgowość', order: 13 },
      { name: 'HR/Kadry', order: 14 },
      { name: 'Inne koszty administracyjne', order: 15 },
      { name: 'Dekoracje/wyposażenie biura', order: 16 },
    ],
  },
  {
    name: 'Cost of Goods/COS',
    order: 4,
    subCategories: [
      // Pracownicy etatowi
      { name: 'Aleksandra Bodecka', order: 1 },
      { name: 'Marcin', order: 2 },
      { name: 'Justyna', order: 3 },
      { name: 'Prezes', order: 4 },
      { name: 'Maks Pietrasik', order: 5 },
      { name: 'Sabina Rowińska', order: 6 },
      // Podwykonawcy (osobne pozycje)
      { name: 'Grzegorz Malinowski', order: 7 },
      { name: 'Marcin Jezierski', order: 8 },
      { name: 'Lidia Szycie', order: 9 },
      { name: 'Jarek Piesio', order: 10 },
      { name: 'Boberek', order: 11 },
      { name: 'New Nest', order: 12 },
      { name: 'Różański', order: 13 },
      // Pozostałe koszty
      { name: 'Zakup towarów handlowych', order: 14 },
      { name: 'Logistyka/Wysyłka', order: 15 },
      { name: 'Materiały do obsługi', order: 16 },
      { name: 'Inne koszty towarów', order: 17 },
    ],
  },
  {
    name: 'Travel',
    order: 5,
    subCategories: [
      { name: 'Leasing samochodu', order: 1 },
      { name: 'Paliwo', order: 2 },
      { name: 'Parking', order: 3 },
      { name: 'Posiłki służbowe', order: 4 },
      { name: 'Noclegi', order: 5 },
      { name: 'Komunikacja miejska', order: 6 },
      { name: 'Inne koszty podróży', order: 7 },
    ],
  },
  {
    name: 'Legal',
    order: 6,
    subCategories: [
      { name: 'Legal & Professional Fees', order: 1 },
    ],
  },
  {
    name: 'Insurance',
    order: 7,
    subCategories: [
      { name: 'Ubezpieczenie samochodu', order: 1 },
      { name: 'Ubezpieczenie liability', order: 2 },
      { name: 'Ubezpieczenie E&O', order: 3 },
    ],
  },
  {
    name: 'Other Expenses',
    order: 8,
    subCategories: [
      { name: 'Kary i mandaty', order: 1 },
      { name: 'Allegro/Marketplace opłaty', order: 2 },
      { name: 'Prowizje sprzedażowe', order: 3 },
    ],
  },
  {
    name: 'Other Taxes',
    order: 9,
    subCategories: [
      { name: 'VAT', order: 1 },
      { name: 'ZUS pracodawcy', order: 2 },
      { name: 'Składka zdrowotna', order: 3 },
      { name: 'CIT-8E', order: 4 },
      { name: 'Podatek dochodowy', order: 5 },
    ],
  },
]

const COST_TAG_GROUPS = defaultCostTagSeedRows()

// Polish holidays for 2025 and 2026
const POLISH_HOLIDAYS = [
  // 2025
  { name: 'Nowy Rok', date: new Date('2025-01-01'), country: 'PL' },
  { name: 'Trzech Króli', date: new Date('2025-01-06'), country: 'PL' },
  { name: 'Wielkanoc', date: new Date('2025-04-20'), country: 'PL' },
  { name: 'Poniedziałek Wielkanocny', date: new Date('2025-04-21'), country: 'PL' },
  { name: 'Święto Pracy', date: new Date('2025-05-01'), country: 'PL' },
  { name: 'Święto Konstytucji 3 Maja', date: new Date('2025-05-03'), country: 'PL' },
  { name: 'Boże Ciało', date: new Date('2025-06-19'), country: 'PL' },
  { name: 'Wniebowzięcie NMP', date: new Date('2025-08-15'), country: 'PL' },
  { name: 'Wszystkich Świętych', date: new Date('2025-11-01'), country: 'PL' },
  { name: 'Święto Niepodległości', date: new Date('2025-11-11'), country: 'PL' },
  { name: 'Boże Narodzenie', date: new Date('2025-12-25'), country: 'PL' },
  { name: 'Drugi dzień Bożego Narodzenia', date: new Date('2025-12-26'), country: 'PL' },
  // 2026
  { name: 'Nowy Rok', date: new Date('2026-01-01'), country: 'PL' },
  { name: 'Trzech Króli', date: new Date('2026-01-06'), country: 'PL' },
  { name: 'Wielkanoc', date: new Date('2026-04-05'), country: 'PL' },
  { name: 'Poniedziałek Wielkanocny', date: new Date('2026-04-06'), country: 'PL' },
  { name: 'Święto Pracy', date: new Date('2026-05-01'), country: 'PL' },
  { name: 'Święto Konstytucji 3 Maja', date: new Date('2026-05-03'), country: 'PL' },
  { name: 'Boże Ciało', date: new Date('2026-06-04'), country: 'PL' },
  { name: 'Wniebowzięcie NMP', date: new Date('2026-08-15'), country: 'PL' },
  { name: 'Wszystkich Świętych', date: new Date('2026-11-01'), country: 'PL' },
  { name: 'Święto Niepodległości', date: new Date('2026-11-11'), country: 'PL' },
  { name: 'Boże Narodzenie', date: new Date('2026-12-25'), country: 'PL' },
  { name: 'Drugi dzień Bożego Narodzenia', date: new Date('2026-12-26'), country: 'PL' },
]

const LEAVE_TYPES = [
  { code: 'VL',  name: 'Urlop wypoczynkowy',       color: '#3B82F6', isPaid: true,  requiresApproval: true,  maxDaysPerYear: 26,   parentCode: null },
  { code: 'VLD', name: 'Urlop na żądanie',          color: '#8B5CF6', isPaid: true,  requiresApproval: false, maxDaysPerYear: 4,    parentCode: 'VL' },
  { code: 'SL',  name: 'Zwolnienie chorobowe',      color: '#EF4444', isPaid: true,  requiresApproval: false, maxDaysPerYear: null, parentCode: null },
  { code: 'RW',  name: 'Praca zdalna',              color: '#10B981', isPaid: true,  requiresApproval: true,  maxDaysPerYear: null, parentCode: null },
  { code: 'RWO', name: 'Okazjonalna praca zdalna',  color: '#6EE7B7', isPaid: true,  requiresApproval: false, maxDaysPerYear: 24,   parentCode: null },
  { code: 'DEL', name: 'Delegacja',                 color: '#7C3AED', isPaid: true,  requiresApproval: true,  maxDaysPerYear: null, parentCode: null },
  { code: 'ML',  name: 'Urlop macierzyński',        color: '#EC4899', isPaid: true,  requiresApproval: true,  maxDaysPerYear: null, parentCode: null },
  { code: 'PL',  name: 'Urlop tacierzyński',        color: '#F59E0B', isPaid: true,  requiresApproval: true,  maxDaysPerYear: null, parentCode: null },
  { code: 'UO',  name: 'Urlop opiekuńczy',          color: '#F97316', isPaid: false, requiresApproval: true,  maxDaysPerYear: 5,    parentCode: null },
  { code: 'OT',  name: 'Czas wolny za nadgodziny',  color: '#14B8A6', isPaid: true,  requiresApproval: true,  maxDaysPerYear: null, parentCode: null },
  { code: 'FIL', name: 'Opieka nad chorym',         color: '#FB923C', isPaid: true,  requiresApproval: false, maxDaysPerYear: 2,    parentCode: null },
  { code: 'VBL', name: 'Urlop dodatkowy',           color: '#60A5FA', isPaid: true,  requiresApproval: true,  maxDaysPerYear: null, parentCode: null },
  { code: 'VSL', name: 'Urlop wolontariacki',       color: '#34D399', isPaid: false, requiresApproval: true,  maxDaysPerYear: 6,    parentCode: null },
  { code: 'ZOW', name: 'Zwolnienie z pracy',        color: '#94A3B8', isPaid: true,  requiresApproval: true,  maxDaysPerYear: null, parentCode: null },
]

const MONTH_END_PROCEDURES = [
  {
    title: 'Raport miesięczny z kasy fiskalnej',
    slug: 'procedura-raport-miesieczny-z-kasy-fiskalnej',
    content: `## Raport miesięczny z kasy fiskalnej

Cel: pobrać i zapisać miesięczne raporty z kas fiskalnych dla lokalizacji Jagiellońska i Puławska.

### Kroki
1. Zaloguj się do systemu kasy fiskalnej dla danego punktu.
2. Wybierz raport miesięczny za zamykany miesiąc.
3. Zapisz raport jako PDF lub skan.
4. Umieść plik w folderze księgowym Google Drive dla danego miesiąca.
5. Oznacz zadanie jako gotowe w Operacjach.`,
  },
  {
    title: 'Rejestr VAT sprzedaży',
    slug: 'procedura-rejestr-vat-sprzedazy',
    content: `## Rejestr VAT sprzedaży

Cel: wyeksportować rejestr sprzedaży VAT dla faktur i paragonów.

### Kroki
1. Wejdź w Subiekt GT: Widok -> Zestawienia -> Rejestr sprzedaży VAT.
2. Wybierz właściwy okres.
3. Ustaw typ dokumentu: wszystkie ze słowem faktura i przelicz F5.
4. Wyeksportuj plik.
5. Ustaw typ dokumentu: wszystkie ze słowem paragon i przelicz F5.
6. Wyeksportuj plik.
7. Zapisz pliki w Google Drive w folderze księgowym danego miesiąca.`,
  },
  {
    title: 'Faktury kosztowe z Google Drive do Saldeo',
    slug: 'procedura-faktury-kosztowe-z-google-drive-do-saldeo',
    content: `## Faktury kosztowe z Google Drive do Saldeo

Cel: przekazać komplet faktur kosztowych do Saldeo.

### Kroki
1. Otwórz folder kosztów w Google Drive dla zamykanego miesiąca.
2. Sprawdź, czy są skany faktur papierowych i pliki PDF od dostawców.
3. Pobierz lub prześlij dokumenty do Saldeo.
4. Upewnij się, że dokumenty są przypisane do właściwego miesiąca.
5. Oznacz zadanie jako gotowe.`,
  },
  {
    title: 'Eksport FV sprzedaż',
    slug: 'procedura-eksport-fv-sprzedaz',
    content: `## Eksport FV sprzedaż

Cel: przygotować eksport faktur sprzedażowych dla biura księgowego.

### Kroki
1. Otwórz Subiekt GT.
2. Wybierz raport dokumentów sprzedaży dla zamykanego okresu.
3. Uwzględnij faktury sprzedaży i korekty, jeśli są wymagane.
4. Wyeksportuj plik.
5. Zapisz eksport w folderze księgowym danego miesiąca.`,
  },
  {
    title: 'Parkometry i FLOWBIRD',
    slug: 'procedura-parkometry-flowbird',
    content: `## Parkometry i FLOWBIRD

Cel: zebrać dowody opłat parkingowych do księgowości.

### Kroki
1. Otwórz aplikację FLOWBIRD.
2. Wykonaj screeny lub pobierz potwierdzenia opłat z danego miesiąca.
3. Dodaj papierowe bilety parkingowe, jeśli istnieją.
4. Zapisz komplet w folderze kosztów danego miesiąca.
5. Oznacz zadanie jako gotowe.`,
  },
]

const MONTH_END_TEMPLATE_ITEMS = [
  { title: 'Raport miesięczny z kasy fiskalnej', description: 'Jagiellońska i Puławska - skan na Saldeo.', procedureSlug: 'procedura-raport-miesieczny-z-kasy-fiskalnej' },
  { title: 'Raport kasowy Subiekt GT dla obu magazynów', description: 'Jagiellońska i Puławska, magazyny bez noty rozchodu.', procedureSlug: null },
  { title: 'Saldo rachunków bankowych', description: 'NestBank EUR/VAT/PLN oraz mBank PLN.', procedureSlug: null },
  { title: 'Rejestr VAT sprzedaży', description: 'Eksport faktur i paragonów za zamykany miesiąc.', procedureSlug: 'procedura-rejestr-vat-sprzedazy' },
  { title: 'Skan faktur papierowych do Google Drive', description: 'Dodaj skany do folderu koszty lub zakup.', procedureSlug: null },
  { title: 'Faktury kosztowe z Google Drive do Saldeo', description: 'Dokumenty kosztowe za zamykany miesiąc.', procedureSlug: 'procedura-faktury-kosztowe-z-google-drive-do-saldeo' },
  { title: 'Faktury zakupowe z Google Drive do Saldeo', description: 'Dokumenty zakupowe za zamykany miesiąc.', procedureSlug: 'procedura-faktury-kosztowe-z-google-drive-do-saldeo' },
  { title: 'JPK VAT sprzedaż dla biura księgowego', description: 'Przygotuj i przekaż plik/link dla biura.', procedureSlug: 'procedura-rejestr-vat-sprzedazy' },
  { title: 'Zestawienie WZ/PZ dla każdego punktu', description: 'Oddzielnie WZ i PZ dla obu magazynów.', procedureSlug: null },
  { title: 'Eksport FV sprzedaż', description: 'Eksport faktur sprzedażowych z systemu.', procedureSlug: 'procedura-eksport-fv-sprzedaz' },
  { title: 'Korekty faktur', description: 'Sprawdź korekty dla obu magazynów.', procedureSlug: null },
  { title: 'Parkometry / FLOWBIRD', description: 'Screeny z aplikacji i papierowe bilety parkingowe.', procedureSlug: 'procedura-parkometry-flowbird' },
  { title: 'Faktury kosztowe do ściągnięcia', description: 'Google Ads, Google GSuite, Meta, Microsoft, leasing BMW, Allegro/Amazon.', procedureSlug: null },
]

async function main() {
  console.log('Seeding database...')

  // 1. Cost Centers
  for (const cc of COST_CENTERS) {
    await prisma.costCenter.upsert({
      where: { id: cc.id },
      update: { name: cc.name, description: cc.description },
      create: cc,
    })
  }
  console.log('Cost centers seeded (3)')

  // 2. Controlled cost tag groups
  let totalCostTags = 0
  for (const item of COST_TAG_GROUPS) {
    const group = await prisma.costTagGroup.upsert({
      where: { slug: item.group.slug },
      update: { name: item.group.name, order: item.group.order },
      create: item.group,
    })

    for (const tag of item.tags) {
      await prisma.costTag.upsert({
        where: { slug: tag.slug },
        update: { groupId: group.id, name: tag.name, active: true },
        create: { groupId: group.id, slug: tag.slug, name: tag.name, active: true },
      })
      totalCostTags++
    }
  }
  console.log(`Cost tags seeded (${COST_TAG_GROUPS.length} groups, ${totalCostTags} tags)`)

  // 3. Account Categories + SubCategories
  let totalSubCategories = 0
  for (const cat of ACCOUNT_CATEGORIES) {
    const { subCategories, ...categoryData } = cat
    const category = await prisma.accountCategory.upsert({
      where: { name: categoryData.name },
      update: { order: categoryData.order },
      create: categoryData,
    })

    for (const sub of subCategories) {
      await prisma.subCategory.upsert({
        where: {
          id: (
            await prisma.subCategory.findFirst({
              where: { name: sub.name, categoryId: category.id },
              select: { id: true },
            })
          )?.id ?? 'new',
        },
        update: { order: sub.order },
        create: { ...sub, categoryId: category.id },
      })
      totalSubCategories++
    }
  }
  console.log(`Account categories seeded (9 categories, ${totalSubCategories} subcategories)`)

  // 3. Admin User
  const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@walldecor.pl'
  const adminPassword = process.env.ADMIN_PASSWORD ?? 'ChangeMe123!'
  const passwordHash = bcrypt.hashSync(adminPassword, 12)

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: { passwordHash },
    create: {
      email: adminEmail,
      name: 'Administrator WallDecor',
      role: 'ADMIN',
      passwordHash,
    },
  })
  console.log(`Admin user seeded (${adminEmail})`)

  // 4. Cash accounts
  const cashAccountCount = await prisma.cashAccount.count()
  if (cashAccountCount === 0) {
    await prisma.cashAccount.createMany({
      data: [
        { name: 'Konto 1',        currency: 'PLN', type: 'bank', order: 0 },
        { name: 'Konto 2',        currency: 'PLN', type: 'bank', order: 1 },
        { name: 'Gotówka Sejf 1', currency: 'PLN', type: 'cash', order: 2 },
        { name: 'Gotówka Sejf 2', currency: 'PLN', type: 'cash', order: 3 },
        { name: 'Konto EUR',      currency: 'EUR', type: 'bank', order: 4 },
      ],
    })
  }

  // 5. App settings (cash thresholds)
  const settingKeys = ['cashThresholdVeryGood', 'cashThresholdGood', 'cashThresholdBad']
  for (const key of settingKeys) {
    const existing = await prisma.appSetting.findUnique({ where: { key } })
    if (!existing) {
      const value = key === 'cashThresholdVeryGood' ? '300000'
                  : key === 'cashThresholdGood'     ? '200000'
                  :                                   '100000'
      await prisma.appSetting.create({ data: { key, value } })
    }
  }

  // ─── HR Seed ──────────────────────────────────────────────────────────────

  // 6. Divisions
  const divJAG = await prisma.division.upsert({
    where: { id: 'div-jag' },
    update: { name: 'Oddział Jagiellońska', costCenterId: 'JAG' },
    create: { id: 'div-jag', name: 'Oddział Jagiellońska', costCenterId: 'JAG' },
  })
  const divPUL = await prisma.division.upsert({
    where: { id: 'div-pul' },
    update: { name: 'Oddział Puławska', costCenterId: 'PUL' },
    create: { id: 'div-pul', name: 'Oddział Puławska', costCenterId: 'PUL' },
  })
  console.log('Divisions seeded (2)')

  // 7. Departments (2 per division)
  await prisma.department.upsert({
    where: { id: 'dept-jag-sales' },
    update: { name: 'Sprzedaż' },
    create: { id: 'dept-jag-sales', name: 'Sprzedaż', divisionId: divJAG.id },
  })
  await prisma.department.upsert({
    where: { id: 'dept-jag-service' },
    update: { name: 'Obsługa klienta' },
    create: { id: 'dept-jag-service', name: 'Obsługa klienta', divisionId: divJAG.id },
  })
  await prisma.department.upsert({
    where: { id: 'dept-pul-sales' },
    update: { name: 'Sprzedaż' },
    create: { id: 'dept-pul-sales', name: 'Sprzedaż', divisionId: divPUL.id },
  })
  await prisma.department.upsert({
    where: { id: 'dept-pul-service' },
    update: { name: 'Obsługa klienta' },
    create: { id: 'dept-pul-service', name: 'Obsługa klienta', divisionId: divPUL.id },
  })
  console.log('Departments seeded (4)')

  // 8. Positions
  const positionNames = ['Sprzedawca', 'Kierownik salonu', 'Konsultant', 'CEO', 'Office Manager']
  for (const name of positionNames) {
    const existing = await prisma.position.findFirst({ where: { name } })
    if (!existing) {
      await prisma.position.create({ data: { name } })
    }
  }
  console.log('Positions seeded (5)')

  // 9. Projects
  const projectsData = [
    { name: 'Showroom Praga', code: 'PRG' },
    { name: 'Showroom Mokotów', code: 'MOK' },
    { name: 'E-commerce', code: 'ECOM' },
  ]
  for (const proj of projectsData) {
    await prisma.project.upsert({
      where: { code: proj.code },
      update: { name: proj.name },
      create: { name: proj.name, code: proj.code, isActive: true },
    })
  }
  console.log('Projects seeded (3)')

  // 10. Polish holidays
  for (const holiday of POLISH_HOLIDAYS) {
    const existing = await prisma.customHoliday.findFirst({
      where: { name: holiday.name, date: holiday.date, country: 'PL' },
    })
    if (!existing) {
      await prisma.customHoliday.create({
        data: {
          name: holiday.name,
          date: holiday.date,
          country: 'PL',
          divisionId: null,
          isRecurring: false,
        },
      })
    }
  }
  console.log('Polish holidays seeded (24)')

  // 11. Leave Types (with parent relationships)
  // First pass: create all without parents
  const leaveTypeIds: Record<string, string> = {}
  for (const lt of LEAVE_TYPES) {
    const created = await prisma.leaveType.upsert({
      where: { code: lt.code },
      update: {
        name: lt.name,
        color: lt.color,
        isPaid: lt.isPaid,
        requiresApproval: lt.requiresApproval,
        maxDaysPerYear: lt.maxDaysPerYear,
      },
      create: {
        code: lt.code,
        name: lt.name,
        color: lt.color,
        isPaid: lt.isPaid,
        requiresApproval: lt.requiresApproval,
        maxDaysPerYear: lt.maxDaysPerYear,
        isActive: true,
      },
    })
    leaveTypeIds[lt.code] = created.id
  }

  // Second pass: set parent relationships
  for (const lt of LEAVE_TYPES) {
    if (lt.parentCode) {
      await prisma.leaveType.update({
        where: { code: lt.code },
        data: { parentId: leaveTypeIds[lt.parentCode] },
      })
    }
  }
  console.log('Leave types seeded (14)')

  // 12. TimeTrackingRule per division
  await prisma.timeTrackingRule.upsert({
    where: { id: 'ttr-jag' },
    update: { name: 'Reguła JAG', dailyHours: 8, weeklyHours: 40, overtimeThreshold: 8 },
    create: {
      id: 'ttr-jag',
      divisionId: divJAG.id,
      name: 'Reguła JAG',
      dailyHours: 8,
      weeklyHours: 40,
      breakAfterHours: 6,
      breakMinutes: 15,
      roundingRule: 'none',
      overtimeThreshold: 8,
      periodType: 'monthly',
      periodStart: 1,
    },
  })
  await prisma.timeTrackingRule.upsert({
    where: { id: 'ttr-pul' },
    update: { name: 'Reguła PUL', dailyHours: 8, weeklyHours: 40, overtimeThreshold: 8 },
    create: {
      id: 'ttr-pul',
      divisionId: divPUL.id,
      name: 'Reguła PUL',
      dailyHours: 8,
      weeklyHours: 40,
      breakAfterHours: 6,
      breakMinutes: 15,
      roundingRule: 'none',
      overtimeThreshold: 8,
      periodType: 'monthly',
      periodStart: 1,
    },
  })
  console.log('TimeTrackingRules seeded (2)')

  // 13. Wikipedia articles (idempotent — upsert by slug)
  const wikiArticles = parseKnowledgeBase()
  if (wikiArticles.length > 0) {
    let wikiCreated = 0
    for (const article of wikiArticles) {
      await prisma.article.upsert({
        where: { slug: article.slug },
        update: { title: article.title, content: article.content, category: article.category },
        create: {
          title: article.title,
          slug: article.slug,
          content: article.content,
          category: article.category,
          visibility: 'manager',
          type: 'knowledge',
          tags: '[]',
        },
      })
      wikiCreated++
    }
    console.log(`Wikipedia articles seeded (${wikiCreated})`)
  }

  // 14. Operations: month-end accounting
  const operationsArea = await prisma.operationArea.upsert({
    where: { id: 'operation-area-finance' },
    update: {
      name: 'Finanse',
      slug: 'finanse',
      description: 'Procedury finansowe i księgowe.',
      order: 1,
    },
    create: {
      id: 'operation-area-finance',
      name: 'Finanse',
      slug: 'finanse',
      description: 'Procedury finansowe i księgowe.',
      order: 1,
    },
  })

  const monthEndModule = await prisma.operationModule.upsert({
    where: { id: 'operation-module-month-end' },
    update: {
      areaId: operationsArea.id,
      name: 'Koniec miesiąca',
      slug: 'koniec-miesiaca',
      description: 'Zamykanie miesiąca i komplet dokumentów dla księgowości.',
      order: 1,
    },
    create: {
      id: 'operation-module-month-end',
      areaId: operationsArea.id,
      name: 'Koniec miesiąca',
      slug: 'koniec-miesiaca',
      description: 'Zamykanie miesiąca i komplet dokumentów dla księgowości.',
      order: 1,
    },
  })

  const procedureIdBySlug = new Map<string, string>()
  for (const procedure of MONTH_END_PROCEDURES) {
    const article = await prisma.article.upsert({
      where: { slug: procedure.slug },
      update: {
        title: procedure.title,
        content: procedure.content,
        category: 'company',
        visibility: 'manager',
        type: 'procedure',
        tags: JSON.stringify(['operations', 'finance', 'month-end']),
      },
      create: {
        title: procedure.title,
        slug: procedure.slug,
        content: procedure.content,
        category: 'company',
        visibility: 'manager',
        type: 'procedure',
        tags: JSON.stringify(['operations', 'finance', 'month-end']),
      },
    })
    procedureIdBySlug.set(procedure.slug, article.id)
  }

  const monthEndTemplate = await prisma.checklistTemplate.upsert({
    where: { id: 'checklist-template-month-end-accounting' },
    update: {
      moduleId: monthEndModule.id,
      name: 'Księgowość - koniec miesiąca',
      description: 'Lista zadań do zamknięcia miesiąca księgowego.',
      active: true,
    },
    create: {
      id: 'checklist-template-month-end-accounting',
      moduleId: monthEndModule.id,
      name: 'Księgowość - koniec miesiąca',
      description: 'Lista zadań do zamknięcia miesiąca księgowego.',
      active: true,
    },
  })

  await prisma.checklistTemplateItem.deleteMany({ where: { templateId: monthEndTemplate.id } })
  for (const [index, item] of MONTH_END_TEMPLATE_ITEMS.entries()) {
    await prisma.checklistTemplateItem.create({
      data: {
        templateId: monthEndTemplate.id,
        title: item.title,
        description: item.description,
        order: index + 1,
        procedureId: item.procedureSlug ? procedureIdBySlug.get(item.procedureSlug) ?? null : null,
        defaultOwnerId: null,
      },
    })
  }
  console.log(`Operations month-end template seeded (${MONTH_END_TEMPLATE_ITEMS.length} items)`)

  console.log('Seeding complete!')
}

main()
  .catch((e) => {
    console.error('Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
