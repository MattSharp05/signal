import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'
import { cn } from '@/lib/utils'

const badgeVariants = cva('inline-flex items-center gap-1 rounded px-1.5 h-5 text-2xs font-medium whitespace-nowrap [&_svg]:size-3', {
  variants: {
    tone: {
      neutral: 'bg-surface text-muted',
      outline: 'border border-border text-muted',
      accent: 'bg-accent-soft text-accent',
      positive: 'bg-positive-soft text-positive',
      negative: 'bg-negative-soft text-negative',
      warning: 'bg-warning-soft text-warning',
      dark: 'bg-text text-white',
    },
  },
  defaultVariants: { tone: 'neutral' },
})

export function Badge({ className, tone, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />
}
