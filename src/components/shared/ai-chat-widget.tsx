'use client'
import { useState, useRef, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { AI_CHAT_INITIAL_STATE, createAiChatClient, type AiChatClient } from '@/lib/ai/client'
import { dashboardToday, resolveDashboardPeriod } from '@/lib/finance/actual-dashboard'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const STARTER: Message = {
  role: 'assistant',
  content: 'Zapytaj o rzeczywiste przychody, koszty i wynik wybranego miesiąca, np. *Jak zmienił się obrót?* albo *Czy dane tego okresu są kompletne?*',
}
const MONTH_NAMES = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru']

export function AiChatWidget({ role }: { role: string }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([STARTER])
  const [input, setInput] = useState('')
  const [period, setPeriod] = useState(() => {
    const parsed = resolveDashboardPeriod({})
    return parsed.ok ? parsed.period : { year: new Date().getFullYear(), month: new Date().getMonth() + 1 }
  })
  const [jobState, setJobState] = useState(AI_CHAT_INITIAL_STATE)
  const clientRef = useRef<AiChatClient | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const client = createAiChatClient({ onState: setJobState, onAnswer: (answer) => setMessages((prev) => [...prev, { role: 'assistant', content: answer }]) })
    clientRef.current = client
    return () => { client.dispose(); clientRef.current = null }
  }, [])

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
      inputRef.current?.focus()
    }
  }, [open, messages, jobState.message])

  const handleSend = () => {
    const q = input.trim()
    if (!q || !clientRef.current?.submit({ kind: 'FINANCE_CHAT', question: q, ...period })) return
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: q }])
  }

  const currentYear = Number(dashboardToday().slice(0, 4))
  const years = [currentYear - 1, currentYear, currentYear + 1]

  // Match the financial API's ADMIN boundary, and leave the knowledge
  // assistant's floating control unobstructed on its own pages.
  if (role !== 'ADMIN' || pathname === '/knowledge' || pathname?.startsWith('/knowledge/')) return null

  return (
    <>
      {/* Chat panel */}
      {open && (
        <div
          className="fixed bottom-20 right-4 sm:right-6 z-50 w-80 max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-6rem)] flex flex-col rounded-2xl shadow-2xl overflow-hidden"
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
                aria-label="Rok danych"
                value={period.year}
                onChange={(e) => {
                  const next = resolveDashboardPeriod({ year: e.target.value })
                  if (next.ok) setPeriod(next.period)
                }}
                className="text-xs rounded px-1.5 py-0.5 border-0 outline-none"
                style={{ background: 'rgba(255,255,255,0.15)', color: 'white' }}
              >
                {years.map(y => <option key={y} value={y} style={{ background: '#1E1E1E' }}>{y}</option>)}
              </select>
              <select
                aria-label="Miesiąc danych"
                value={period.month}
                onChange={(e) => setPeriod((value) => ({ ...value, month: Number(e.target.value) }))}
                className="text-xs rounded px-1.5 py-0.5 border-0 outline-none"
                style={{ background: 'rgba(255,255,255,0.15)', color: 'white' }}
              >
                {MONTH_NAMES.map((name, index) => <option key={name} value={index + 1} style={{ background: '#1E1E1E' }}>{name}</option>)}
              </select>
              <button
                onClick={() => setOpen(false)}
                aria-label="Zamknij czat finansowy"
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
            {jobState.message && (
              <div className="flex justify-start">
                <div className="px-3 py-2 rounded-xl text-sm" style={{ background: '#F5F5F5', color: '#666' }}>
                  <p role={jobState.busy ? 'status' : 'alert'}>{jobState.message}</p>
                  {jobState.action && (
                    <button type="button" className="mt-2 text-xs font-semibold underline" onClick={() => jobState.action === 'retry' ? clientRef.current?.retry() : clientRef.current?.resume()}>
                      {jobState.action === 'retry' ? 'Ponów zadanie' : jobState.action === 'recover' ? 'Odzyskaj zadanie' : 'Sprawdź ponownie'}
                    </button>
                  )}
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
              maxLength={500}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
              placeholder="Zadaj pytanie o finanse..."
              className="flex-1 text-sm outline-none bg-transparent"
              style={{ color: 'var(--wd-dark)' }}
              disabled={!jobState.canSubmit}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || !jobState.canSubmit}
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
