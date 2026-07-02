import { PrismaClient } from '../src/generated/prisma'

const prisma = new PrismaClient()
const YEAR = 2026
const MONTHS = [1, 2, 3, 4, 5]
const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
const SAMPLE_NOTE = 'SAMPLE_FINANCE_2026'

type CostCenterId = 'JAG' | 'PUL' | 'GLOBAL'

const revenueActuals: Array<{ costCenterId: CostCenterId; channel: string; values: number[] }> = [
  { costCenterId: 'JAG', channel: 'SALON', values: [82_000, 88_500, 91_200, 86_300, 94_700] },
  { costCenterId: 'PUL', channel: 'SALON', values: [74_500, 79_000, 83_400, 80_100, 88_600] },
  { costCenterId: 'PUL', channel: 'ECOMMERCE', values: [42_200, 47_800, 53_600, 49_200, 58_900] },
]

const revenuePlan: Array<{ costCenterId: CostCenterId; channel: string; monthly: number }> = [
  { costCenterId: 'JAG', channel: 'SALON', monthly: 90_000 },
  { costCenterId: 'PUL', channel: 'SALON', monthly: 82_000 },
  { costCenterId: 'PUL', channel: 'ECOMMERCE', monthly: 55_000 },
]

const costRows: Array<{
  costCenterId: CostCenterId
  category: string
  subCategory: string
  actuals: number[]
  assumptions: number
}> = [
  { costCenterId: 'JAG', category: 'Office/General Administrative', subCategory: 'Czynsz JAG', actuals: [5_800, 5_800, 5_800, 6_215, 6_215], assumptions: 6_000 },
  { costCenterId: 'JAG', category: 'Office/General Administrative', subCategory: 'Prąd JAG', actuals: [600, 355, 600, 317, 520], assumptions: 550 },
  { costCenterId: 'JAG', category: 'Office/General Administrative', subCategory: 'Internet/Telefon', actuals: [508, 522, 508, 508, 508], assumptions: 520 },
  { costCenterId: 'JAG', category: 'Cost of Goods/COS', subCategory: 'Aleksandra Bodecka', actuals: [9_800, 9_800, 9_800, 9_800, 9_800], assumptions: 10_000 },
  { costCenterId: 'JAG', category: 'Cost of Goods/COS', subCategory: 'Marcin', actuals: [8_200, 8_200, 8_200, 8_200, 8_200], assumptions: 8_500 },
  { costCenterId: 'JAG', category: 'Cost of Goods/COS', subCategory: 'Zakup towarów handlowych', actuals: [19_500, 22_400, 24_100, 20_800, 25_600], assumptions: 23_000 },
  { costCenterId: 'JAG', category: 'Cost of Goods/COS', subCategory: 'Logistyka/Wysyłka', actuals: [2_100, 2_450, 2_650, 2_300, 2_900], assumptions: 2_600 },

  { costCenterId: 'PUL', category: 'Office/General Administrative', subCategory: 'Czynsz PUL', actuals: [14_500, 14_500, 14_500, 14_989, 14_989], assumptions: 15_000 },
  { costCenterId: 'PUL', category: 'Office/General Administrative', subCategory: 'Prąd PUL', actuals: [690, 730, 1_078, 875, 930], assumptions: 900 },
  { costCenterId: 'PUL', category: 'Office/General Administrative', subCategory: 'Internet/Telefon', actuals: [548, 561, 548, 548, 548], assumptions: 560 },
  { costCenterId: 'PUL', category: 'Cost of Goods/COS', subCategory: 'Justyna', actuals: [8_900, 8_900, 8_900, 8_900, 8_900], assumptions: 9_100 },
  { costCenterId: 'PUL', category: 'Cost of Goods/COS', subCategory: 'Zakup towarów handlowych', actuals: [28_000, 31_200, 34_500, 32_100, 36_400], assumptions: 34_000 },
  { costCenterId: 'PUL', category: 'Cost of Goods/COS', subCategory: 'Logistyka/Wysyłka', actuals: [4_800, 5_100, 5_900, 5_300, 6_200], assumptions: 5_800 },

  { costCenterId: 'GLOBAL', category: 'Customer Acquisition', subCategory: 'SEO/Linkowanie', actuals: [5_535, 11_806, 11_806, 6_395, 7_200], assumptions: 8_000 },
  { costCenterId: 'GLOBAL', category: 'Customer Acquisition', subCategory: 'AdWords/Google Ads', actuals: [3_503, 253, 1_129, 2_700, 3_200], assumptions: 3_000 },
  { costCenterId: 'GLOBAL', category: 'Customer Acquisition', subCategory: 'Facebook/Instagram Ads', actuals: [2_800, 2_950, 3_150, 3_300, 3_500], assumptions: 3_200 },
  { costCenterId: 'GLOBAL', category: 'Cost of Service', subCategory: 'Google Suite', actuals: [266, 266, 278, 315, 315], assumptions: 300 },
  { costCenterId: 'GLOBAL', category: 'Cost of Service', subCategory: 'Oprogramowanie', actuals: [614, 700, 615, 850, 920], assumptions: 850 },
  { costCenterId: 'GLOBAL', category: 'Office/General Administrative', subCategory: 'Księgowość', actuals: [4_384, 4_384, 4_384, 4_600, 4_600], assumptions: 4_600 },
  { costCenterId: 'GLOBAL', category: 'Office/General Administrative', subCategory: 'HR/Kadry', actuals: [1_200, 1_200, 1_200, 1_200, 1_200], assumptions: 1_200 },
  { costCenterId: 'GLOBAL', category: 'Other Taxes', subCategory: 'ZUS pracodawcy', actuals: [7_400, 7_400, 7_400, 7_900, 7_900], assumptions: 7_800 },
]

async function subCategoryId(categoryName: string, subCategoryName: string) {
  const subCategory = await prisma.subCategory.findFirst({
    where: { name: subCategoryName, category: { name: categoryName } },
    select: { id: true },
  })
  if (!subCategory) {
    throw new Error(`Missing subcategory: ${categoryName} / ${subCategoryName}`)
  }
  return subCategory.id
}

async function seedRevenue() {
  for (const row of revenueActuals) {
    for (const [index, amount] of row.values.entries()) {
      const month = MONTHS[index]
      await prisma.revenue.upsert({
        where: {
          year_month_costCenterId_channel: {
            year: YEAR,
            month,
            costCenterId: row.costCenterId,
            channel: row.channel,
          },
        },
        update: { amount },
        create: { year: YEAR, month, costCenterId: row.costCenterId, channel: row.channel, amount },
      })
    }
  }

  for (const row of revenuePlan) {
    for (const month of ALL_MONTHS) {
      await prisma.revenueBudget.upsert({
        where: {
          year_month_costCenterId_channel: {
            year: YEAR,
            month,
            costCenterId: row.costCenterId,
            channel: row.channel,
          },
        },
        update: { amount: row.monthly },
        create: { year: YEAR, month, costCenterId: row.costCenterId, channel: row.channel, amount: row.monthly },
      })
    }
  }
}

async function seedCosts() {
  for (const row of costRows) {
    const id = await subCategoryId(row.category, row.subCategory)

    for (const [index, amount] of row.actuals.entries()) {
      const month = MONTHS[index]
      await prisma.actualEntry.upsert({
        where: {
          year_month_costCenterId_subCategoryId: {
            year: YEAR,
            month,
            costCenterId: row.costCenterId,
            subCategoryId: id,
          },
        },
        update: { amount },
        create: { year: YEAR, month, costCenterId: row.costCenterId, subCategoryId: id, amount },
      })
    }

    for (const month of ALL_MONTHS) {
      await prisma.budgetEntry.upsert({
        where: {
          year_month_costCenterId_subCategoryId: {
            year: YEAR,
            month,
            costCenterId: row.costCenterId,
            subCategoryId: id,
          },
        },
        update: { amount: row.assumptions },
        create: { year: YEAR, month, costCenterId: row.costCenterId, subCategoryId: id, amount: row.assumptions },
      })
    }
  }
}

async function seedCash() {
  const balances: Record<string, number> = {
    'Konto 1': 184_500,
    'Konto 2': 72_300,
    'Gotówka Sejf 1': 8_400,
    'Gotówka Sejf 2': 5_600,
    'Konto EUR': 18_750,
  }

  for (const [name, balance] of Object.entries(balances)) {
    await prisma.cashAccount.updateMany({ where: { name }, data: { balance } })
  }

  await prisma.receivableEntry.deleteMany({ where: { notes: SAMPLE_NOTE } })
  await prisma.receivableEntry.createMany({
    data: [
      { clientName: 'Projekt Mokotów', amount: 18_900, dueDate: new Date(`${YEAR}-05-24`), status: 'PENDING', notes: SAMPLE_NOTE },
      { clientName: 'Architekt B2B', amount: 12_400, dueDate: new Date(`${YEAR}-06-02`), status: 'PENDING', notes: SAMPLE_NOTE },
    ],
  })

  await prisma.cashLiabilitySnapshot.deleteMany({ where: { notes: SAMPLE_NOTE } })
  await prisma.cashLiabilitySnapshot.create({
    data: {
      amount: 96_000,
      date: new Date(`${YEAR}-05-18`),
      notes: SAMPLE_NOTE,
      createdBy: 'Sample seed',
    },
  })
}

async function main() {
  await seedRevenue()
  await seedCosts()
  await seedCash()
  console.log(`Finance sample data seeded for ${YEAR}.`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
