'use client'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface HandleProps {
  ref: (el: HTMLElement | null) => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

interface SortableRowProps {
  id: string
  showHandle: boolean
  className?: string
  style?: React.CSSProperties
  children: (handleProps: HandleProps | null) => React.ReactNode
}

export function SortableRow({ id, showHandle, className, style, children }: SortableRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const handleProps: HandleProps | null = showHandle
    ? { ref: setActivatorNodeRef, ...attributes, ...listeners }
    : null

  return (
    <tr
      ref={setNodeRef}
      className={className}
      style={{
        ...style,
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        position: isDragging ? 'relative' : undefined,
        zIndex: isDragging ? 10 : undefined,
      }}
    >
      {children(handleProps)}
    </tr>
  )
}

// Drag handle icon — użyj wewnątrz komórki z nazwą
export function DragHandle({ handleProps }: { handleProps: HandleProps }) {
  const { ref, ...rest } = handleProps
  return (
    <span
      ref={ref}
      {...rest}
      className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
      title="Przeciągnij aby zmienić kolejność"
    >
      <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
        <circle cx="2.5" cy="2" r="1.5" />
        <circle cx="7.5" cy="2" r="1.5" />
        <circle cx="2.5" cy="7" r="1.5" />
        <circle cx="7.5" cy="7" r="1.5" />
        <circle cx="2.5" cy="12" r="1.5" />
        <circle cx="7.5" cy="12" r="1.5" />
      </svg>
    </span>
  )
}
