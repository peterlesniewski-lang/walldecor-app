'use client'

import { useEffect, useRef, useState } from 'react'
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Check, GripVertical, MoreHorizontal, Repeat } from 'lucide-react'
import { StatusBadge } from './status-badge'

export interface RunTask {
  id: string
  title: string
  description: string | null
  status: string
  recurring: boolean
}

interface RunTaskListProps {
  items: RunTask[]
  selectedId: string
  canToggle: boolean
  canEdit: boolean
  onSelect: (id: string) => void
  onToggleDone: (id: string) => void
  onReorder: (orderedIds: string[]) => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
}

function RowMenu({ title, onEdit, onDelete }: { title: string; onEdit: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function close(event: MouseEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent) {
        if (event.key === 'Escape') setOpen(false)
        return
      }
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label={`Opcje zadania: ${title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current)
          setConfirming(false)
        }}
        className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-44 rounded-lg border bg-white p-1 shadow-lg">
          {confirming ? (
            <div className="p-2">
              <p className="mb-2 text-sm text-gray-800">Usunąć to zadanie?</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    onDelete()
                  }}
                  className="rounded bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700"
                >
                  Tak, usuń
                </button>
                <button type="button" onClick={() => setConfirming(false)} className="rounded border px-3 py-1 text-xs font-medium">
                  Nie
                </button>
              </div>
            </div>
          ) : (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  onEdit()
                }}
                className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-gray-50"
              >
                Edytuj
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => setConfirming(true)}
                className="block w-full rounded px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50"
              >
                Usuń
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function TaskRow({
  item,
  selected,
  canToggle,
  canEdit,
  onSelect,
  onToggleDone,
  onEdit,
  onDelete,
}: {
  item: RunTask
  selected: boolean
  canToggle: boolean
  canEdit: boolean
  onSelect: () => void
  onToggleDone: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: !canEdit,
  })
  const done = item.status === 'done'

  return (
    <div
      ref={setNodeRef}
      data-testid="run-task-row"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        position: isDragging ? 'relative' : undefined,
        zIndex: isDragging ? 10 : undefined,
      }}
      className={`flex items-start gap-2 px-3 py-2.5 ${selected ? 'bg-gray-50' : ''}`}
    >
      {canEdit && (
        <button
          ref={setActivatorNodeRef}
          type="button"
          aria-label={`Przeciągnij zadanie: ${item.title}`}
          className="mt-0.5 cursor-grab touch-none rounded p-0.5 text-gray-300 hover:text-gray-600 active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={`Oznacz jako gotowe: ${item.title}`}
        disabled={!canToggle}
        onClick={onToggleDone}
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition ${
          done ? 'border-green-600 bg-green-600 text-white' : 'border-gray-300 bg-white hover:border-gray-500'
        } disabled:cursor-not-allowed disabled:opacity-60`}
      >
        {done && <Check className="h-3.5 w-3.5" />}
      </button>
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
        <span className={`block font-medium ${done ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{item.title}</span>
        {item.description && <span className="mt-0.5 block text-xs text-gray-500">{item.description}</span>}
      </button>
      {(item.status === 'blocked' || item.status === 'in_progress') && <StatusBadge status={item.status} />}
      {item.recurring ? (
        <span title="Powtarza się co miesiąc" className="mt-0.5 text-gray-400">
          <Repeat className="h-3.5 w-3.5" />
        </span>
      ) : (
        <span className="mt-0.5 shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">
          tylko ten miesiąc
        </span>
      )}
      {canEdit && <RowMenu title={item.title} onEdit={onEdit} onDelete={onDelete} />}
    </div>
  )
}

export function RunTaskList({
  items,
  selectedId,
  canToggle,
  canEdit,
  onSelect,
  onToggleDone,
  onReorder,
  onEdit,
  onDelete,
}: RunTaskListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = items.findIndex((item) => item.id === active.id)
    const newIndex = items.findIndex((item) => item.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    onReorder(arrayMove(items, oldIndex, newIndex).map((item) => item.id))
  }

  return (
    <DndContext id="run-task-list" sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <div className="divide-y">
          {items.map((item) => (
            <TaskRow
              key={item.id}
              item={item}
              selected={item.id === selectedId}
              canToggle={canToggle}
              canEdit={canEdit}
              onSelect={() => onSelect(item.id)}
              onToggleDone={() => onToggleDone(item.id)}
              onEdit={() => onEdit(item.id)}
              onDelete={() => onDelete(item.id)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}
