import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AiMessage } from '@/components/wikipedia/AiAssistant/AiMessage'
import { aiChatResultSchema } from '@/lib/ai/contracts'

const remoteImageAnswer = aiChatResultSchema.parse({
  answer: '![schemat](https://example.invalid/collect?article=SYNTHETIC_INTERNAL_CONTEXT)',
})

describe('AI answer Markdown rendering', () => {
  it.each(['img', 'link'])('does not emit <%s> resources for an accepted remote image answer during SSR', (tag) => {
    const html = renderToStaticMarkup(<AiMessage role="assistant" content={remoteImageAnswer.answer} />)

    expect(html).not.toMatch(new RegExp(`<${tag}\\b`, 'i'))
    expect(html).toContain('schemat')
    expect(html).not.toContain('https://example.invalid/collect')
  })

  it('shows readable descriptions and a fallback for images without alt text', () => {
    const html = renderToStaticMarkup(<AiMessage role="assistant" content={`${remoteImageAnswer.answer}\n\n![](https://example.invalid/empty)`} />)

    expect(html).toContain('<p>schemat</p>')
    expect(html).toContain('[Obraz pominięty]')
    expect(html).not.toMatch(/<(?:img|link)\b/i)
  })

  it('preserves useful Markdown and explicit safe links while raw HTML stays inert', () => {
    const result = aiChatResultSchema.parse({ answer: [
      '**Ważne** i *szczegóły*',
      '- Pierwszy krok\n- Drugi krok',
      '[Dokumentacja](https://example.invalid/guide)',
      '[Niebezpieczny link](javascript:alert%281%29)',
      '<img src="https://example.invalid/raw-image" />',
      '<iframe src="https://example.invalid/frame"></iframe>',
      '<link rel="preload" href="https://example.invalid/preload" as="image" />',
    ].join('\n\n') })
    const html = renderToStaticMarkup(<AiMessage role="assistant" content={result.answer} />)

    expect(html).toContain('<strong>Ważne</strong>')
    expect(html).toContain('<em>szczegóły</em>')
    expect(html).toContain('<li>Pierwszy krok</li>')
    expect(html).toContain('<li>Drugi krok</li>')
    expect(html).toContain('<a href="https://example.invalid/guide">Dokumentacja</a>')
    expect(html).not.toContain('href="javascript:')
    expect(html).toContain('&lt;iframe')
    expect(html).not.toMatch(/<(?:img|link|iframe|script|video|audio|source|object|embed)\b/i)
  })
})
