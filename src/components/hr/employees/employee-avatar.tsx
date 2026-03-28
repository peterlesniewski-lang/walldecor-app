import Image from 'next/image'

const WARM_PALETTE = [
  { bg: '#FDE68A', text: '#92400E' }, // amber-200 / amber-800
  { bg: '#FED7AA', text: '#9A3412' }, // orange-200 / orange-800
  { bg: '#D6D3D1', text: '#44403C' }, // stone-300 / stone-700
  { bg: '#FECACA', text: '#991B1B' }, // red-200 / red-800
  { bg: '#FEF08A', text: '#854D0E' }, // yellow-200 / yellow-800
  { bg: '#FDBA74', text: '#7C2D12' }, // orange-300 / orange-900
  { bg: '#FCA5A5', text: '#7F1D1D' }, // red-300 / red-900
  { bg: '#A8A29E', text: '#1C1917' }, // stone-400 / stone-900
]

function hashName(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  }
  return hash
}

const SIZE_MAP = {
  sm: { container: 'w-7 h-7 text-xs', img: 28 },
  md: { container: 'w-9 h-9 text-sm', img: 36 },
  lg: { container: 'w-12 h-12 text-base', img: 48 },
}

interface EmployeeAvatarProps {
  firstName: string
  lastName: string
  size?: 'sm' | 'md' | 'lg'
  avatarUrl?: string | null
}

export function EmployeeAvatar({ firstName, lastName, size = 'md', avatarUrl }: EmployeeAvatarProps) {
  const { container, img } = SIZE_MAP[size]
  const initials = `${firstName[0] ?? ''}${lastName[0] ?? ''}`.toUpperCase()
  const colorIdx = hashName(`${firstName}${lastName}`) % WARM_PALETTE.length
  const { bg, text } = WARM_PALETTE[colorIdx]

  if (avatarUrl) {
    return (
      <div className={`${container} rounded-full overflow-hidden flex-shrink-0`}>
        <Image src={avatarUrl} alt={`${firstName} ${lastName}`} width={img} height={img} className="object-cover w-full h-full" />
      </div>
    )
  }

  return (
    <div
      className={`${container} rounded-full flex items-center justify-center font-semibold flex-shrink-0`}
      style={{ backgroundColor: bg, color: text }}
    >
      {initials}
    </div>
  )
}
