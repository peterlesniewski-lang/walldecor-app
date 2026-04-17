import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface AiMessageProps {
  role: 'user' | 'assistant'
  content: string
}

export function AiMessage({ role, content }: AiMessageProps) {
  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] px-3 py-2 rounded-2xl rounded-br-sm text-sm bg-gray-900 text-white">
          {content}
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] px-3 py-2 rounded-2xl rounded-bl-sm text-sm bg-gray-100 text-gray-800 prose prose-sm max-w-none prose-p:mb-1.5 prose-li:leading-relaxed">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    </div>
  )
}
