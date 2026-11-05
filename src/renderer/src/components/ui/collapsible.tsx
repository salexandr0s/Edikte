import { Collapsible as RadixCollapsible } from 'radix-ui'
import type { ComponentProps, ReactNode } from 'react'
import { cx } from '../../lib/cx'
import { ChevronDownIcon } from './icons'

export const Collapsible = RadixCollapsible.Root

/** A text button with a chevron that turns as the section opens. */
export function CollapsibleTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof RadixCollapsible.Trigger> & { children: ReactNode }) {
  return (
    <RadixCollapsible.Trigger
      className={cx(
        'group inline-flex h-8 items-center gap-1.5 rounded-sm pr-2.5 pl-1.5 text-sm font-medium text-accent-text transition-colors duration-120 hover:bg-fill-muted',
        className,
      )}
      {...props}
    >
      <ChevronDownIcon className="size-3.5 transition-transform duration-160 ease-standard group-data-[state=open]:rotate-180" />
      {children}
    </RadixCollapsible.Trigger>
  )
}

/** Slides open and shut; the height comes from Radix. */
export function CollapsibleContent({
  className,
  ...props
}: ComponentProps<typeof RadixCollapsible.Content>) {
  return (
    <RadixCollapsible.Content
      className={cx(
        'overflow-hidden data-[state=open]:animate-collapse-down data-[state=closed]:animate-collapse-up',
        className,
      )}
      {...props}
    />
  )
}
