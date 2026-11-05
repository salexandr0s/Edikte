import { DropdownMenu as RadixMenu } from 'radix-ui'
import type { ComponentProps, ReactNode } from 'react'
import { cx } from '../../lib/cx'
import { ChevronRightIcon } from './icons'

/*
 * dropdown.v1 as thin wrappers over Radix, so every menu in the app opens,
 * highlights and closes the same way. Compose them like the Radix parts:
 * Menu > MenuTrigger + MenuContent > MenuItem | MenuLabel | MenuSeparator | MenuSub.
 */

export const Menu = RadixMenu.Root
export const MenuTrigger = RadixMenu.Trigger
export const MenuSub = RadixMenu.Sub

const CONTENT =
  'z-(--edk-z-dropdown) max-w-80 min-w-48 origin-(--radix-dropdown-menu-content-transform-origin) rounded-md bg-surface-elevated p-1 text-fg shadow-popover data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out'

const ITEM =
  'flex h-9 cursor-default items-center gap-2 rounded-sm px-2.5 text-sm outline-none select-none data-highlighted:bg-fill-muted data-disabled:opacity-55'

export function MenuContent({
  className,
  sideOffset = 6,
  collisionPadding = 8,
  ...props
}: ComponentProps<typeof RadixMenu.Content>) {
  return (
    <RadixMenu.Portal>
      <RadixMenu.Content
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cx(CONTENT, className)}
        {...props}
      />
    </RadixMenu.Portal>
  )
}

export function MenuSubContent({
  className,
  sideOffset = 4,
  ...props
}: ComponentProps<typeof RadixMenu.SubContent>) {
  return (
    <RadixMenu.Portal>
      <RadixMenu.SubContent
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cx(CONTENT, className)}
        {...props}
      />
    </RadixMenu.Portal>
  )
}

interface MenuItemProps extends ComponentProps<typeof RadixMenu.Item> {
  /** An icon before the label. */
  icon?: ReactNode
  /** Red text for actions that remove something. */
  danger?: boolean
}

export function MenuItem({ icon, danger = false, className, children, ...props }: MenuItemProps) {
  return (
    <RadixMenu.Item
      className={cx(
        ITEM,
        danger && 'text-danger-text data-highlighted:bg-danger-subtle',
        className,
      )}
      {...props}
    >
      {icon !== undefined && (
        <span aria-hidden="true" className={cx('shrink-0', !danger && 'text-fg-muted')}>
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </RadixMenu.Item>
  )
}

export function MenuSubTrigger({
  icon,
  className,
  children,
  ...props
}: ComponentProps<typeof RadixMenu.SubTrigger> & { icon?: ReactNode }) {
  return (
    <RadixMenu.SubTrigger
      className={cx(ITEM, 'data-[state=open]:bg-fill-muted', className)}
      {...props}
    >
      {icon !== undefined && (
        <span aria-hidden="true" className="shrink-0 text-fg-muted">
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <ChevronRightIcon className="ml-2 size-3.5 shrink-0 text-fg-muted" />
    </RadixMenu.SubTrigger>
  )
}

/** A heading or note inside the menu; not selectable. */
export function MenuLabel({ className, ...props }: ComponentProps<typeof RadixMenu.Label>) {
  return (
    <RadixMenu.Label
      className={cx('px-2.5 py-2 text-xs font-medium text-fg-muted', className)}
      {...props}
    />
  )
}

export function MenuSeparator({ className, ...props }: ComponentProps<typeof RadixMenu.Separator>) {
  return <RadixMenu.Separator className={cx('-mx-1 my-1 h-px bg-border', className)} {...props} />
}
