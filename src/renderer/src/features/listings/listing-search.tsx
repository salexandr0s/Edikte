import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '../../components/ui/field'
import { CloseIcon, SearchIcon } from '../../components/ui/icons'

interface ListingSearchProps {
  value: string
  onChange: (text: string) => void
  placeholder?: string
  className?: string
}

export function ListingSearch({ value, onChange, placeholder, className }: ListingSearchProps) {
  const { t } = useTranslation()
  const input = useRef<HTMLInputElement>(null)
  return (
    <Input
      type="search"
      ref={input}
      className={className}
      aria-label={t('filters.search')}
      maxLength={200}
      placeholder={placeholder ?? t('filters.searchPlaceholder')}
      title={t('filters.searchPlaceholder')}
      value={value}
      leading={<SearchIcon />}
      trailing={
        value !== '' ? (
          <button
            type="button"
            aria-label={t('filters.clearSearch')}
            className="flex size-6 items-center justify-center rounded-sm text-fg-muted transition-colors duration-120 hover:bg-fill-muted hover:text-fg focus-visible:ring-3 focus-visible:ring-ring-soft focus-visible:outline-none"
            onClick={() => {
              onChange('')
              input.current?.focus()
            }}
          >
            <CloseIcon className="size-3.5" />
          </button>
        ) : undefined
      }
      onChange={(event) => onChange(event.target.value)}
    />
  )
}
