'use client'

import { useState, useRef, useEffect } from 'react'
import { Bot, X, ChevronDown } from 'lucide-react'
import { AiMessage } from './AiMessage'
import { AiInput } from './AiInput'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface AiAssistantProps {
  articleTitle?: string
  articleCategory?: string
  articleContent?: string
}

export function AiAssistant({ articleTitle, articleCategory, articleContent }: AiAssistantProps) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, open])

  async function handleSend() {
    if (!input.trim() || loading) return

    const question = input.trim()
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: question }])
    setLoading(true)

    try {
      const res = await fetch('/api/knowledge/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          articleTitle,
          articleCategory,
          articleContent: articleContent?.slice(0, 3000),
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Błąd AI')
      }

      const { answer } = await res.json()
      setMessages((prev) => [...prev, { role: 'assistant', content: answer }])
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Błąd połączenia'
      setMessages((prev) => [...prev, { role: 'assistant', content: `❌ ${msg}` }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 w-12 h-12 rounded-full shadow-lg flex items-center justify-center text-white transition-transform hover:scale-105 z-40"
          style={{ background: 'var(--wd-accent, #1A1410)' }}
          title="AI Asystent wiedzy"
        >
          <Bot className="w-5 h-5" />
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-6 right-6 w-96 h-[520px] bg-white border border-gray-200 rounded-2xl shadow-2xl flex flex-col z-40 overflow-hidden">
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-3 border-b border-gray-200"
            style={{ background: 'var(--wd-accent, #1A1410)', color: 'white' }}
          >
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4" />
              <div>
                <p className="text-sm font-medium">AI Asystent wiedzy</p>
                {articleTitle && (
                  <p className="text-xs opacity-60 truncate max-w-[220px]">{articleTitle}</p>
                )}
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="opacity-70 hover:opacity-100">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-gray-400 text-center p-4">
                <Bot className="w-10 h-10 mb-2 opacity-30" />
                <p className="text-sm">Zadaj pytanie dotyczące{' '}
                  {articleTitle ? `artykułu "${articleTitle}"` : 'bazy wiedzy'}.
                </p>
                <p className="text-xs mt-1 opacity-60">Enter aby wysłać, Shift+Enter nowa linia</p>
              </div>
            )}
            {messages.map((msg, i) => (
              <AiMessage key={i} role={msg.role} content={msg.content} />
            ))}
            {loading && (
              <div className="flex items-center gap-2 text-gray-400 text-sm">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <span>Myślę...</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <AiInput value={input} onChange={setInput} onSend={handleSend} loading={loading} />
        </div>
      )}
    </>
  )
}
