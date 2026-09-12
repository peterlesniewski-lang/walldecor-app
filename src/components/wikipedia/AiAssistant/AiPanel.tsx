'use client'

import { useState, useRef, useEffect } from 'react'
import { Bot, X } from 'lucide-react'
import { AiMessage } from './AiMessage'
import { AiInput } from './AiInput'
import { AI_CHAT_INITIAL_STATE, createAiChatClient, type AiChatClient } from '@/lib/ai/client'

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
  const [jobState, setJobState] = useState(AI_CHAT_INITIAL_STATE)
  const clientRef = useRef<AiChatClient | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const client = createAiChatClient({ onState: setJobState, onAnswer: (answer) => setMessages((prev) => [...prev, { role: 'assistant', content: answer }]) })
    clientRef.current = client
    return () => { client.dispose(); clientRef.current = null }
  }, [])

  useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, open, jobState.message])

  function handleSend() {
    const question = input.trim()
    if (!question || !clientRef.current?.submit({ kind: 'WIKI_CHAT', question, articleTitle, articleCategory, articleContent: articleContent?.slice(0, 3000) })) return
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: question }])
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
        <div className="fixed bottom-6 right-4 sm:right-6 w-96 max-w-[calc(100vw-2rem)] h-[520px] max-h-[calc(100dvh-3rem)] bg-white border border-gray-200 rounded-2xl shadow-2xl flex flex-col z-40 overflow-hidden">
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
            <button onClick={() => setOpen(false)} className="opacity-70 hover:opacity-100" aria-label="Zamknij asystenta wiedzy">
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
            {jobState.message && (
              <div className="text-gray-500 text-sm">
                <p role={jobState.busy ? 'status' : 'alert'}>{jobState.message}</p>
                {jobState.action && (
                  <button type="button" className="mt-2 text-xs font-semibold underline" onClick={() => jobState.action === 'retry' ? clientRef.current?.retry() : clientRef.current?.resume()}>
                    {jobState.action === 'retry' ? 'Ponów zadanie' : jobState.action === 'recover' ? 'Odzyskaj zadanie' : 'Sprawdź ponownie'}
                  </button>
                )}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <AiInput value={input} onChange={(value) => setInput(value.slice(0, 500))} onSend={handleSend} loading={!jobState.canSubmit} />
        </div>
      )}
    </>
  )
}
