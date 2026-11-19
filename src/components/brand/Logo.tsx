import { cn } from '@/lib/utils'

/** Signal "Aperture" mark: an open ring with a point emerging through the opening. */
export function LogoMark({ size = 20, tone = 'brand', className }: { size?: number; tone?: 'brand' | 'mono' | 'inverse'; className?: string }) {
  const color = tone === 'brand' ? 'var(--accent)' : tone === 'mono' ? 'var(--text)' : '#FFFFFF'
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden className={cn('shrink-0', className)}>
      <path d="M17.99 13.89A7.5 7.5 0 1 1 10.11 6.01" stroke={color} strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="18.75" cy="5.25" r="3" fill={color} />
    </svg>
  )
}

export function Logo({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark size={size} />
      <span className="text-[15px] font-semibold tracking-[-0.01em] text-text">Signal</span>
    </span>
  )
}
