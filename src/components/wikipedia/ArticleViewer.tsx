'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/github.css'

interface ArticleViewerProps {
  content: string
}

export function ArticleViewer({ content }: ArticleViewerProps) {
  return (
    <div className="prose prose-gray max-w-none prose-headings:font-bold prose-h2:text-lg prose-h3:text-base prose-p:leading-relaxed prose-li:leading-relaxed prose-table:text-sm">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          h2: ({ children }) => (
            <h2 className="text-lg font-bold text-gray-900 mt-8 mb-3 pb-2 border-b border-gray-100">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-base font-semibold text-gray-800 mt-5 mb-2">{children}</h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-sm font-semibold text-gray-800 mt-4 mb-1">{children}</h4>
          ),
          p: ({ children }) => (
            <p className="text-gray-700 leading-relaxed mb-3">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="list-disc list-outside ml-5 space-y-1 mb-3 text-gray-700">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal list-outside ml-5 space-y-1 mb-3 text-gray-700">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-gray-300 pl-4 italic text-gray-600 my-4">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto my-4">
              <table className="w-full text-sm border-collapse border border-gray-200 rounded">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-gray-200 bg-gray-50 px-3 py-2 text-left font-semibold text-gray-800">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-gray-200 px-3 py-2 text-gray-700">{children}</td>
          ),
          code: ({ children, className }) => {
            const isBlock = className?.includes('language-')
            if (isBlock) {
              return (
                <code className={`${className} text-sm`}>{children}</code>
              )
            }
            return (
              <code className="bg-gray-100 text-gray-800 px-1.5 py-0.5 rounded text-sm font-mono">
                {children}
              </code>
            )
          },
          hr: () => <hr className="border-gray-200 my-6" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
