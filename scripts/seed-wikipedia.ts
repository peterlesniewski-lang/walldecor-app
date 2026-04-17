/**
 * Parses ceo-module/KNOWLEDGE_BUSINESS.md and seeds Article records.
 * Run: DATABASE_URL="file:./prisma/walldecor.db" npx tsx scripts/seed-wikipedia.ts
 */
import { PrismaClient } from '../src/generated/prisma'
import * as fs from 'fs'
import * as path from 'path'

const prisma = new PrismaClient()

const CATEGORY_MAP: Record<string, string> = {
  'ZARZĄDZANIE I PRZYWÓDZTWO': 'management',
  'FINANSE I PŁYNNOŚĆ': 'finance',
  'SPRZEDAŻ I NEGOCJACJE': 'sales',
  'MARKETING I BRANDING': 'marketing',
  'PROCESY I AUTOMATYZACJA': 'processes',
  'PSYCHOLOGIA WŁAŚCICIELA': 'psychology',
  'STRATEGIA I ROZWÓJ FIRMY': 'strategy',
  'STRATEGIA I ROZWÓJ': 'strategy',
}

function toSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ąáàâä]/g, 'a')
    .replace(/[ćčç]/g, 'c')
    .replace(/[ęéèêë]/g, 'e')
    .replace(/[łl]/g, 'l')
    .replace(/ł/g, 'l')
    .replace(/[ńñ]/g, 'n')
    .replace(/[óöòôõ]/g, 'o')
    .replace(/[śš]/g, 's')
    .replace(/[úùûü]/g, 'u')
    .replace(/[źżž]/g, 'z')
    .replace(/ą/g, 'a')
    .replace(/ć/g, 'c')
    .replace(/ę/g, 'e')
    .replace(/ł/g, 'l')
    .replace(/ń/g, 'n')
    .replace(/ó/g, 'o')
    .replace(/ś/g, 's')
    .replace(/ź/g, 'z')
    .replace(/ż/g, 'z')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

interface ParsedArticle {
  title: string
  slug: string
  content: string
  category: string
}

function parseKnowledgeBase(filePath: string): ParsedArticle[] {
  const raw = fs.readFileSync(filePath, 'utf-8')
  const lines = raw.split('\n')

  const articles: ParsedArticle[] = []
  let currentCategory = 'management'
  let currentTitle: string | null = null
  let currentSlug: string | null = null
  let contentLines: string[] = []

  function flushArticle() {
    if (currentTitle && contentLines.length > 0) {
      const content = contentLines.join('\n').trim()
      if (content.length > 50) {
        articles.push({
          title: currentTitle,
          slug: currentSlug!,
          content,
          category: currentCategory,
        })
      }
    }
    currentTitle = null
    currentSlug = null
    contentLines = []
  }

  for (const line of lines) {
    // Top-level section header (# 1. ZARZĄDZANIE...)
    const sectionMatch = line.match(/^# \d+\.\s+(.+)$/)
    if (sectionMatch) {
      flushArticle()
      const sectionName = sectionMatch[1].trim().toUpperCase()
      for (const [key, val] of Object.entries(CATEGORY_MAP)) {
        if (sectionName.includes(key) || key.includes(sectionName)) {
          currentCategory = val
          break
        }
      }
      continue
    }

    // Article header (## 1.1 Title — article)
    const articleMatch = line.match(/^## (\d+\.\d+)\s+(.+)$/)
    if (articleMatch) {
      flushArticle()
      const num = articleMatch[1]
      const title = articleMatch[2].trim()
      currentTitle = `${num} ${title}`
      currentSlug = toSlug(`${num}-${title}`)
      contentLines = [`## ${title}\n`]
      continue
    }

    // Skip table of contents block
    if (line.startsWith('# SPIS TREŚCI') || line.match(/^\d+\.\s+\[/)) {
      continue
    }

    // Append to current article content
    if (currentTitle) {
      contentLines.push(line)
    }
  }

  flushArticle()
  return articles
}

async function main() {
  const mdPath = path.join(__dirname, '../ceo-module/KNOWLEDGE_BUSINESS.md')

  if (!fs.existsSync(mdPath)) {
    console.error('KNOWLEDGE_BUSINESS.md not found at:', mdPath)
    process.exit(1)
  }

  console.log('Parsing KNOWLEDGE_BUSINESS.md...')
  const articles = parseKnowledgeBase(mdPath)
  console.log(`Found ${articles.length} articles`)

  // Clear existing articles
  await prisma.article.deleteMany()
  console.log('Cleared existing articles')

  let created = 0
  for (const article of articles) {
    // Ensure unique slug
    let slug = article.slug
    const existing = await prisma.article.findUnique({ where: { slug } })
    if (existing) {
      slug = `${slug}-${Date.now()}`
    }

    await prisma.article.create({
      data: {
        title: article.title,
        slug,
        content: article.content,
        category: article.category,
        visibility: 'manager',
        type: 'knowledge',
        tags: '[]',
      },
    })
    created++
    process.stdout.write(`  [${created}/${articles.length}] ${article.title}\n`)
  }

  console.log(`\nSeeded ${created} articles successfully!`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
