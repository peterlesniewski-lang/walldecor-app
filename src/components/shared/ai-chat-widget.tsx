'use client'
import { useState, useRef, useEffect } from 'react'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const STARTER: Message = {
  role: 'assistant',
  content: 'Cześć! Zapytaj mnie o dane finansowe, np. *Co było największym kosztem w maju?* lub *Jak wyglądało wykonanie budżetu w Q1?*',
}

export function AiChatWidget() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([STARTER])
  const [input, setInput] = useState('')
  const [year, setYear] = useState(new Date().getFullYear())
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
      inputRef.current?.focus()
    }
  }, [open, messages])

  const handleSend = async () => {
    const q = input.trim()
    if (!q || loading) return

    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: q }])
    setLoading(true)

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, year }),
      })
      const data = await res.json()
      const answer = res.ok ? (data.answer ?? 'Brak odpowiedzi.') : (data.error ?? 'Wystąpił błąd.')
      setMessages(prev => [...prev, { role: 'assistant', content: answer }])
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Błąd połączenia. Spróbuj ponownie.' }])
    } finally {
      setLoading(false)
    }
  }

  const currentYear = new Date().getFullYear()
  const years = [currentYear - 1, currentYear, currentYear + 1]

  return (
    <>
      {/* Chat panel */}
      {open && (
        <div
          className="fixed bottom-20 right-6 z-50 w-80 flex flex-col rounded-2xl shadow-2xl overflow-hidden"
          style={{ height: '28rem', background: 'white', border: '1px solid var(--wd-border)' }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-3 shrink-0"
            style={{ background: 'var(--wd-dark)', color: 'white' }}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm">✦</span>
              <span className="font-semibold text-sm tracking-wide">AI Analyst</span>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="text-xs rounded px-1.5 py-0.5 border-0 outline-none"
                style={{ background: 'rgba(255,255,255,0.15)', color: 'white' }}
              >
                {years.map(y => <option key={y} value={y} style={{ background: '#1E1E1E' }}>{y}</option>)}
              </select>
              <button
                onClick={() => setOpen(false)}
                className="opacity-70 hover:opacity-100 text-lg leading-none"
              >
                ×
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className="max-w-[85%] px-3 py-2 rounded-xl text-sm leading-relaxed"
                  style={
                    msg.role === 'user'
                      ? { background: 'var(--wd-sand)', color: 'var(--wd-dark)' }
                      : { background: '#F5F5F5', color: '#333' }
                  }
                >
                  {msg.content.split('\n').map((line, j) => (
                    <span key={j}>
                      {line.replace(/\*(.*?)\*/g, '$1')}
                      {j < msg.content.split('\n').length - 1 && <br />}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="px-3 py-2 rounded-xl text-sm" style={{ background: '#F5F5F5', color: '#888' }}>
                  <span className="inline-flex gap-1">
                    <span className="animate-bounce" style={{ animationDelay: '0ms' }}>•</span>
                    <span className="animate-bounce" style={{ animationDelay: '150ms' }}>•</span>
                    <span className="animate-bounce" style={{ animationDelay: '300ms' }}>•</span>
                  </span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div
            className="flex items-center gap-2 px-3 py-2.5 shrink-0"
            style={{ borderTop: '1px solid var(--wd-border)' }}
          >
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
              placeholder="Zadaj pytanie o finanse..."
              className="flex-1 text-sm outline-none bg-transparent"
              style={{ color: 'var(--wd-dark)' }}
              disabled={loading}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || loading}
              className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-opacity disabled:opacity-30"
              style={{ background: 'var(--wd-dark)', color: 'white' }}
              title="Wyślij"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0l-7 7m7-7l7 7" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Toggle button */}
      <button
        onClick={() => setOpen(prev => !prev)}
        className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-transform hover:scale-105 active:scale-95"
        style={{ background: open ? 'var(--wd-dark)' : 'var(--wd-sand)', color: open ? 'white' : 'var(--wd-dark)' }}
        title="AI Analyst"
      >
        {open ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
          </svg>
        )}
      </button>
    </>
  )
}
