import { Tooltip as RadixTooltip } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cx } from '../../lib/cx'

export const Tooltip = RadixTooltip.Root
export const TooltipTrigger = RadixTooltip.Trigger

/** Inverted bubble with an arrow; pops from the side it opens on. */
export function TooltipContent({
  className,
  sideOffset = 6,
  collisionPadding = 8,
  children,
  ...props
}: ComponentProps<typeof RadixTooltip.Content>) {
  return (
    <RadixTooltip.Portal>
      <RadixTooltip.Content
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cx(
          'z-(--edk-z-tooltip) max-w-xs origin-(--radix-tooltip-content-transform-origin) rounded-sm bg-tooltip px-3 py-2 text-xs text-tooltip-fg shadow-md',
          'data-[state=delayed-open]:animate-pop-in data-[state=instant-open]:animate-fade-in data-[state=closed]:animate-fade-out',
          className,
        )}
        {...props}
      >
        {children}
        <RadixTooltip.Arrow width={10} height={5} className="fill-tooltip" />
      </RadixTooltip.Content>
    </RadixTooltip.Portal>
  )
}
