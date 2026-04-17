'use client'

import { useRef } from 'react'
import { Send } from 'lucide-react'

interface AiInputProps {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  loading: boolean
}

export function AiInput({ value, onChange, onSend, loading }: AiInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (value.trim() && !loading) onSend()
    }
  }

  return (
    <div className="flex gap-2 p-3 border-t border-gray-200 bg-white">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Zadaj pytanie o ten artykuł..."
        rows={2}
        className="flex-1 resize-none px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
      />
      <button
        onClick={onSend}
        disabled={!value.trim() || loading}
        className="self-end px-3 py-2 rounded-lg text-white disabled:opacity-40 transition-opacity"
        style={{ background: 'var(--wd-accent, #1A1410)' }}
      >
        <Send className="w-4 h-4" />
      </button>
    </div>
  )
}
