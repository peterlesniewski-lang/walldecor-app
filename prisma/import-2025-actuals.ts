/**
 * Import danych rzeczywistych za 2025 rok
 * Źródło: Budżet WallDecor 2025 - Expenses.csv (plik podsumowania kondycji firmy)
 * Centrum kosztów: GLOBAL (dane historyczne bez podziału na lokale)
 * Uruchomienie: node_modules/tsx/dist/cli.mjs prisma/import-2025-actuals.ts
 */
import { PrismaClient } from '../src/generated/prisma'

const prisma = new PrismaClient()

// Dane oczyszczone z CSV (miesiące: [sty, lut, mar, kwi, maj, cze, lip, sie, wrz, paź, lis, gru])
// null = brak wydatku w danym miesiącu (nie insertujemy)
// Komórki z formułą np. "254,62+281,08" → zsumowane

type Row = {
  cat: string
  sub: string
  months: (number | null)[]
}

const IMPORT_DATA: Row[] = [
  // ── CUSTOMER ACQUISITION ──────────────────────────────────────────────────
  {
    cat: 'Customer Acquisition',
    sub: 'Abonament sklepu internetowego',
    months: [1023.36, 961.86, 937.26, 984.69, 984.69, 950.47, 959.88, 986.46, 1135.50, 1101.67, 1231.23, 1500.00],
  },
  {
    cat: 'Customer Acquisition',
    sub: 'SEO/Linkowanie',
    months: [5535.00, 4428.00, 4797.00, 1230.00, 4920.00, 4920.00, 4920.00, 4920.00, 4920.00, 3690.00, 11766.18, 11500.00],
  },
  {
    // AdWords Obsługa Data.Rocks + AdWords — zsumowane per miesiąc
    cat: 'Customer Acquisition',
    sub: 'AdWords/Google Ads',
    months: [
      1041.00 + 3250.00,   // sty
      984.00 + 5432.00,    // lut
      1103.00 + 4458.00,   // mar
      950.00 + 2800.00,    // kwi
      950.00 + 2643.00,    // maj
      950.00 + 4140.00,    // cze
      950.00 + 8114.00,    // lip
      950.00 + 5336.00,    // sie
      null,                // wrz (0+0)
      null,                // paź (0+0)
      3656.29 + 0,         // lis
      null,                // gru (0+0)
    ],
  },
  {
    cat: 'Customer Acquisition',
    sub: 'AI Tools',
    months: [null, null, 774.00, null, null, null, null, null, 908.00, null, null, null],
  },
  // Inne IT → Cost of Service / Oprogramowanie
  {
    cat: 'Cost of Service',
    sub: 'Oprogramowanie',
    months: [
      // Photoshop + Canva (Canva tylko grudzień) + Inne IT (wrz + lis)
      64.00,          // sty: Photoshop
      64.00,          // lut
      64.00,          // mar
      64.00,          // kwi
      64.00,          // maj
      64.00,          // cze
      64.00,          // lip
      64.00,          // sie
      64.00 + 201.00, // wrz: Photoshop + Inne IT
      64.00,          // paź
      64.00 + 614.56, // lis: Photoshop + Inne IT
      64.00 + 50.00,  // gru: Photoshop + Canva
    ],
  },

  // ── COST OF SERVICE ───────────────────────────────────────────────────────
  {
    cat: 'Cost of Service',
    sub: 'Prowizje terminali',
    months: [524.99, 652.89, 427.51, 513.17, 336.54, 573.49, null, null, 306.42, null, null, null],
  },
  {
    cat: 'Cost of Service',
    sub: 'Google Suite',
    months: [265.68, 265.68, 265.68, 265.68, 265.68, 265.68, 265.68, 265.68, 265.68, 265.68, 265.68, 265.68],
  },
  {
    cat: 'Cost of Service',
    sub: 'Pipedrive CRM',
    months: [null, null, null, null, null, null, null, null, null, 300.00, null, null],
  },
  {
    cat: 'Cost of Service',
    sub: 'Inne koszty usług',
    months: [23.74, 23.74, 23.74, 23.74, 23.74, 23.74, 23.74, 23.74, 23.74, 23.74, 23.74, 23.74],
  },

  // ── OFFICE / GENERAL ADMINISTRATIVE ──────────────────────────────────────
  {
    cat: 'Office/General Administrative',
    sub: 'Czynsz JAG',
    months: [5800.00, 5800.00, 5800.00, 5800.00, 5800.00, 5800.00, 5800.00, 5800.00, 5800.00, 5800.00, 5800.00, 6400.00],
  },
  {
    cat: 'Office/General Administrative',
    sub: 'Prąd JAG',
    months: [600.00, 600.00, 600.00, 600.00, 600.00, 600.00, 600.00, 600.00, 648.14, 635.03, 664.09, 234.50],
  },
  {
    cat: 'Office/General Administrative',
    sub: 'Czynsz PUL',
    months: [14500.00, 14500.00, 14500.00, 14500.00, 14500.00, 14500.00, 14500.00, 14500.00, 14500.00, 14500.00, 14507.46, 14507.00],
  },
  {
    cat: 'Office/General Administrative',
    sub: 'Prąd PUL',
    // paź: "254,62+281,08" → 535.70
    months: [600.00, 600.00, 600.00, 600.00, 600.00, 600.00, 600.00, 600.00, 586.70, 535.70, 583.49, 550.00],
  },
  {
    // Internet + Telefony zsumowane per miesiąc
    cat: 'Office/General Administrative',
    sub: 'Internet/Telefon',
    months: [
      231.22 + 450.00,  // sty
      231.22 + 450.00,  // lut
      231.22 + 450.00,  // mar
      231.22 + 450.00,  // kwi
      231.22 + 450.00,  // maj
      231.22 + 450.00,  // cze
      231.22 + 450.00,  // lip
      231.22 + 450.00,  // sie
      231.22 + 450.00,  // wrz
      231.22 + 450.00,  // paź
      231.22 + 426.08,  // lis
      231.22 + 410.24,  // gru
    ],
  },
  {
    // Śmieci JAG + Śmieci PUL + Dodatkowe — Inne koszty administracyjne
    cat: 'Office/General Administrative',
    sub: 'Inne koszty administracyjne',
    months: [
      92.20 + 18.92,              // sty
      92.20 + 18.92,              // lut
      92.20 + 18.92,              // mar
      92.20 + 18.92,              // kwi
      92.20 + 18.92,              // maj
      92.20 + 18.92,              // cze
      92.20 + 18.92 + 1750.00,   // lip + Dodatkowe
      92.20 + 18.92,              // sie
      92.20 + 18.92,              // wrz
      92.20 + 18.92,              // paź
      92.20 + 18.92,              // lis
      92.20 + 18.92,              // gru
    ],
  },
  {
    cat: 'Office/General Administrative',
    sub: 'Szkolenia',
    months: [1761.00, 1250.00, null, null, 865.00, null, null, null, null, null, null, null],
  },
  {
    cat: 'Office/General Administrative',
    sub: 'Materiały biurowe',
    months: [null, null, null, null, null, null, null, null, null, null, 140.00, null],
  },
  {
    cat: 'Office/General Administrative',
    sub: 'Serwis urządzeń',
    months: [null, null, null, null, null, null, null, 4920.00, null, null, null, null],
  },
  {
    cat: 'Office/General Administrative',
    sub: 'Dekoracje/wyposażenie biura',
    months: [null, 1269.00, null, null, 6715.00, 101.00, null, null, 319.93, null, null, null],
  },
  {
    cat: 'Office/General Administrative',
    sub: 'Księgowość',
    months: [4200.00, 4200.00, 4200.00, 4200.00, 4200.00, 4200.00, 4200.00, 4200.00, 4200.00, 4200.00, 4200.00, 4200.00],
  },

  // ── COST OF GOODS / COS ───────────────────────────────────────────────────
  // Pracownicy etatowi
  {
    cat: 'Cost of Goods/COS',
    sub: 'Aleksandra Bodecka',
    months: [5200.00, 5200.00, 5200.00, 5200.00, 5200.00, 5200.00, 5200.00, 5200.00, 5200.00, 5200.00, 5200.00, 5200.00],
  },
  {
    cat: 'Cost of Goods/COS',
    sub: 'Marcin',
    months: [5281.00, 6000.00, 6560.00, 6000.00, 6016.00, 6367.00, 6358.00, 6358.00, 6358.00, 6358.00, 6358.00, 6358.00],
  },
  {
    cat: 'Cost of Goods/COS',
    sub: 'Justyna',
    months: [null, null, 4640.00, 5166.00, 5525.00, 5925.00, 5330.00, 5330.00, 5330.00, 5330.00, 5330.00, 5330.00],
  },
  {
    cat: 'Cost of Goods/COS',
    sub: 'Prezes',
    months: [9515.00, 9515.00, 9515.00, 9515.00, 9515.00, 9515.00, 9515.00, 9515.00, 9515.00, 9515.00, 9515.00, 9515.00],
  },
  {
    cat: 'Cost of Goods/COS',
    sub: 'Maks Pietrasik',
    months: [2000.00, 2000.00, 2000.00, 2000.00, 2000.00, 2000.00, 2000.00, 2000.00, 2000.00, null, null, null],
  },
  {
    cat: 'Cost of Goods/COS',
    sub: 'Sabina Rowińska',
    months: [4785.00, 3367.00, null, null, null, null, null, null, null, null, null, null],
  },
  // Podwykonawcy
  {
    cat: 'Cost of Goods/COS',
    sub: 'Grzegorz Malinowski',
    months: [11352.00, 16567.00, 8806.00, 9064.00, 21063.75, 14083.50, 5030.70, 8579.25, 2337.00, 2392.35, 12767.40, 8985.15],
  },
  {
    cat: 'Cost of Goods/COS',
    sub: 'Marcin Jezierski',
    months: [16531.20, 2712.15, 14870.70, 2822.85, 6580.50, 22828.80, 18511.50, 14618.55, 23975.16, 9889.20, 19944.45, 19768.56],
  },
  {
    cat: 'Cost of Goods/COS',
    sub: 'Lidia Szycie',
    months: [null, null, 3769.00, 2519.00, null, null, null, null, null, 9190.99, null, null],
  },
  {
    cat: 'Cost of Goods/COS',
    sub: 'Jarek Piesio',
    months: [6150.00, null, 57759.57, null, 3690.00, null, 15817.80, null, 5289.00, null, null, 9063.87],
  },
  {
    cat: 'Cost of Goods/COS',
    sub: 'Boberek',
    months: [null, null, null, null, 600.00, null, null, null, null, 9900.00, 12180.00, null],
  },
  {
    cat: 'Cost of Goods/COS',
    sub: 'New Nest',
    months: [952.00, null, null, 6026.00, 3304.00, null, null, null, null, null, null, 608.26],
  },
  {
    cat: 'Cost of Goods/COS',
    sub: 'Różański',
    months: [null, null, 1050.00, null, null, null, null, null, null, null, null, null],
  },
  // Pozostałe COS
  {
    cat: 'Cost of Goods/COS',
    sub: 'Logistyka/Wysyłka',
    months: [1688.00, 560.00, 1751.00, 873.00, 1648.00, 516.00, 1395.00, 1000.00, 1000.00, 1381.53, 299.96, 1391.89],
  },
  {
    // Wzorniki, ekspozycje etc. + Inne koszty - COS zsumowane
    cat: 'Cost of Goods/COS',
    sub: 'Inne koszty towarów',
    months: [
      null,                    // sty
      8959.00,                 // lut: wzorniki
      null,                    // mar
      null,                    // kwi
      null,                    // maj
      null,                    // cze
      null,                    // lip
      null,                    // sie
      43.00,                   // wrz: inne
      9307.52 + 354.87,        // paź: wzorniki + inne
      1459.23,                 // lis: wzorniki
      4756.28 + 45.00,         // gru: wzorniki + inne
    ],
  },
  {
    cat: 'Cost of Goods/COS',
    sub: 'Zakup towarów handlowych',
    months: [188707.00, 199979.00, 208459.00, 169031.00, 186509.00, 193064.00, 180388.00, 159679.00, 165109.00, 202349.00, 228137.00, 139659.00],
  },
  // Prowizje zsumowane → Other Expenses
  {
    cat: 'Other Expenses',
    sub: 'Prowizje sprzedażowe',
    months: [null, null, null, null, null, null, null, 8302.00, null, 15668.26, 1156.90, 4577.28],
  },

  // ── TRAVEL ────────────────────────────────────────────────────────────────
  {
    cat: 'Travel',
    sub: 'Leasing samochodu',
    months: [2026.00, 2126.00, 5000.00, 4680.00, 4601.00, 4720.00, 2575.00, 2575.00, 5000.00, 5000.00, 5000.00, 5000.00],
  },
  {
    cat: 'Travel',
    sub: 'Paliwo',
    months: [1183.47, 1827.65, 1160.42, 2378.71, 792.60, 1196.03, 1286.33, 2208.01, 1411.83, 1679.86, 2027.79, 910.65],
  },
  {
    // Naprawy + Other zsumowane
    cat: 'Travel',
    sub: 'Inne koszty podróży',
    months: [
      1127.00,            // sty: Naprawy
      null,               // lut
      null,               // mar
      21735.00,           // kwi: Other
      984.00,             // maj: Naprawy
      null,               // cze
      null,               // lip
      4500.00 + 875.00,   // sie: Naprawy + Other
      null,               // wrz
      null,               // paź
      750.00 + 174.42,    // lis: Naprawy + Other
      1665.44,            // gru: Naprawy
    ],
  },
  {
    cat: 'Travel',
    sub: 'Komunikacja miejska',
    months: [null, null, null, null, null, null, null, 98.00, null, null, null, null],
  },
  {
    cat: 'Travel',
    sub: 'Posiłki służbowe',
    months: [null, null, null, null, 615.00, 184.50, null, null, null, null, null, null],
  },

  // ── LEGAL ─────────────────────────────────────────────────────────────────
  {
    cat: 'Legal',
    sub: 'Legal & Professional Fees',
    months: [null, null, null, 369.00, null, null, null, 750.00, null, null, null, null],
  },

  // ── INSURANCE ─────────────────────────────────────────────────────────────
  {
    cat: 'Insurance',
    sub: 'Ubezpieczenie samochodu',
    months: [null, null, null, 6143.00, null, null, null, null, 6000.00, null, null, null],
  },
  {
    cat: 'Insurance',
    sub: 'Ubezpieczenie liability',
    months: [null, null, null, null, null, null, 1450.00, null, null, null, null, null],
  },

  // ── OTHER EXPENSES ────────────────────────────────────────────────────────
  {
    cat: 'Other Expenses',
    sub: 'Kary i mandaty',
    months: [1141.00, null, null, null, null, null, null, null, null, null, null, null],
  },
  {
    cat: 'Other Expenses',
    sub: 'Allegro/Marketplace opłaty',
    months: [null, null, null, null, null, null, null, null, null, 983.00, null, null],
  },
  // Other → Prowizje sprzedażowe (sum z Prowizje - zsumowane powyżej)
  // "Other" z Other Expenses: sty=3300, gru=1085.73
  // Uwaga: ta sama podkategoria co Prowizje zsumowane z COS — sumujemy w osobnych wierszach,
  // Prisma upsert zsumuje je automatycznie (ostatni zapis wygrywa) — dlatego robimy osobne wiersze
  // i importujemy je jako oddzielne ActualEntry. Ale to ten sam klucz (year/month/costCenter/subCat)!
  // Rozwiązanie: sumujemy tutaj.
  // Prowizje sprzedażowe (Other Expenses sub) = Prowizje-zsumowane (COS) + Other (Other Expenses)
  // Już dodane powyżej (Prowizje zsumowane). "Other" dodajemy do tej samej pozycji:
  // sty: 0 + 3300 = 3300, gru: 0 + 1085.73 = 1085.73
  // Ale już mamy wiersz Prowizje sprzedażowe — poprawiamy go ręcznie (miesięce się nie nakładają)
  // wrz-lis: z Prowizji zsumowanych; sty i gru: z Other. Żaden miesiąc się nie nakłada — OK.

  // ── OTHER TAXES ───────────────────────────────────────────────────────────
  {
    cat: 'Other Taxes',
    sub: 'VAT',
    months: [6517.00, 14297.00, 17080.00, 14914.00, 2568.00, 20628.00, 19685.00, 9499.00, 8195.00, 23392.00, 13249.00, null],
  },
  {
    cat: 'Other Taxes',
    sub: 'ZUS pracodawcy',
    months: [10730.00, 8736.00, 8080.00, 9391.00, 9391.00, 9860.00, 10210.00, 9744.00, 9744.00, 9744.00, 9744.00, null],
  },
  {
    cat: 'Other Taxes',
    sub: 'CIT-8E',
    months: [237.00, null, 272.00, 700.00, 1650.00, 1860.00, 237.00, 2500.00, 822.00, 461.00, 460.00, null],
  },
  {
    cat: 'Other Taxes',
    sub: 'Podatek dochodowy',
    months: [3725.00, null, 1918.00, 1700.00, 1587.00, 2049.00, 2135.00, 2020.00, null, null, null, null],
  },
]

// Osobno: Other z Other Expenses (sty: 3300, gru: 1085.73) + Prowizje zsumowane (sie, paź, lis, gru)
// Scalamy oba źródła w Prowizje sprzedażowe:
// sie: 8302, paź: 15668.26, lis: 1156.90, gru: 4577.28 + 1085.73 = 5663.01, sty: 3300
// Znajdź i zaktualizuj istniejący wiersz
const prowizjeIdx = IMPORT_DATA.findIndex(
  (r) => r.cat === 'Other Expenses' && r.sub === 'Prowizje sprzedażowe'
)
if (prowizjeIdx !== -1) {
  IMPORT_DATA[prowizjeIdx].months[0] = 3300.00  // sty: "Other" z Other Expenses
  IMPORT_DATA[prowizjeIdx].months[11] = (IMPORT_DATA[prowizjeIdx].months[11] ?? 0) + 1085.73  // gru
}

async function main() {
  console.log('📥 Import danych 2025 (actuals, GLOBAL)...\n')

  // Pobierz mapę subkategorii: "kategoria::podkategoria" → subCategoryId
  const allSubs = await prisma.subCategory.findMany({
    include: { category: true },
  })
  const subMap = new Map<string, string>()
  for (const sub of allSubs) {
    subMap.set(`${sub.category.name}::${sub.name}`, sub.id)
  }

  let inserted = 0
  let skipped = 0
  const errors: string[] = []

  for (const row of IMPORT_DATA) {
    const subId = subMap.get(`${row.cat}::${row.sub}`)
    if (!subId) {
      errors.push(`❌ Nie znaleziono: "${row.cat} / ${row.sub}"`)
      continue
    }

    for (let m = 0; m < 12; m++) {
      const amount = row.months[m]
      if (amount === null || amount === 0) {
        skipped++
        continue
      }

      await prisma.actualEntry.upsert({
        where: {
          year_month_costCenterId_subCategoryId: {
            year: 2025,
            month: m + 1,
            costCenterId: 'GLOBAL',
            subCategoryId: subId,
          },
        },
        update: { amount: Math.round(amount * 100) / 100 },
        create: {
          year: 2025,
          month: m + 1,
          costCenterId: 'GLOBAL',
          subCategoryId: subId,
          amount: Math.round(amount * 100) / 100,
        },
      })
      inserted++
    }
  }

  console.log(`✅ Zaimportowano: ${inserted} wierszy`)
  console.log(`⏭  Pominięto (null/zero): ${skipped} wierszy`)
  if (errors.length > 0) {
    console.log('\n⚠️  Błędy mapowania:')
    errors.forEach((e) => console.log(' ', e))
  }

  // Podsumowanie per kategoria
  console.log('\n📊 Sumy roczne per kategoria:')
  const entries = await prisma.actualEntry.findMany({
    where: { year: 2025, costCenterId: 'GLOBAL' },
    include: { subCategory: { include: { category: true } } },
  })
  const catSums = new Map<string, number>()
  for (const e of entries) {
    const cat = e.subCategory.category.name
    catSums.set(cat, (catSums.get(cat) ?? 0) + e.amount)
  }
  for (const [cat, sum] of [...catSums.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat.padEnd(35)} ${sum.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł`)
  }

  const total = [...catSums.values()].reduce((a, b) => a + b, 0)
  console.log(`\n  ${'RAZEM'.padEnd(35)} ${total.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł`)
}

main()
  .catch((e) => {
    console.error('Import failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
