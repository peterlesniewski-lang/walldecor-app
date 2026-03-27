import { PrismaClient } from '../src/generated/prisma'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

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

async function main() {
  console.log('🌱 Seeding database...')

  // 1. Cost Centers
  for (const cc of COST_CENTERS) {
    await prisma.costCenter.upsert({
      where: { id: cc.id },
      update: { name: cc.name, description: cc.description },
      create: cc,
    })
  }
  console.log('✅ Cost centers seeded (3)')

  // 2. Account Categories + SubCategories
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
  console.log(`✅ Account categories seeded (9 categories, ${totalSubCategories} subcategories)`)

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
  console.log(`✅ Admin user seeded (${adminEmail})`)

  console.log('🎉 Seeding complete!')
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
