import * as React from 'react'
import { cn } from '@/lib/utils'

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'h-8 w-full rounded-md border border-border bg-bg px-2.5 text-[13px] text-text placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15',
      className,
    )}
    {...props}
  />
))
Input.displayName = 'Input'

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'w-full rounded-md border border-border bg-bg px-2.5 py-2 text-[13px] text-text placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15',
      className,
    )}
    {...props}
  />
))
Textarea.displayName = 'Textarea'

export function NativeSelect({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-8 rounded-md border border-border bg-bg pl-2 pr-7 text-[13px] text-text focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  )
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('text-xs font-medium text-muted', className)} {...props} />
}
