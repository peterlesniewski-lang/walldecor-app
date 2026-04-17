interface VisibilityBadgeProps {
  visibility: string
}

export function VisibilityBadge({ visibility }: VisibilityBadgeProps) {
  if (visibility === 'public') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
        PUBLIC
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
      MANAGER
    </span>
  )
}
