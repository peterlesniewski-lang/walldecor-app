import Anthropic from '@anthropic-ai/sdk'

const SYSTEM_PROMPT = `Jesteś asystentem wiedzy biznesowej wbudowanym w wewnętrzną encyklopedię firmy.

ZASADY:
1. Odpowiadaj na pytania w kontekście artykułu gdy jesteś na stronie artykułu
2. Możesz wskazywać na inne tematy gdy są relevantne
3. Odpowiedzi: zwięzłe, praktyczne, po polsku, per "ty"
4. Jeśli pytanie wykracza poza podany kontekst — powiedz o tym wprost
5. Formatuj odpowiedzi używając Markdown (nagłówki, listy, pogrubienie)
6. Maksymalna długość odpowiedzi: 400 słów`

export async function getWikiAnswer(
  question: string,
  articleTitle?: string,
  articleCategory?: string,
  articleContent?: string,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

  const anthropic = new Anthropic({ apiKey })

  const contextParts: string[] = []
  if (articleTitle) {
    contextParts.push(`AKTUALNIE CZYTANY ARTYKUŁ: "${articleTitle}" (kategoria: ${articleCategory ?? 'ogólna'})`)
  }
  if (articleContent) {
    const trimmed = articleContent.slice(0, 3000)
    contextParts.push(`TREŚĆ ARTYKUŁU (fragment):\n${trimmed}`)
  }

  const context = contextParts.length > 0 ? contextParts.join('\n\n') + '\n\n---\n' : ''

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `${context}Pytanie: ${question}`,
      },
    ],
  })

  return response.content[0].type === 'text' ? response.content[0].text : 'Brak odpowiedzi.'
}
