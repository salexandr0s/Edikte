import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ListingQuery, SavedFilter } from '@shared/domain'
import type { AppErrorCode } from '@shared/errors'
import { Button } from '../../components/ui/button'
import { Dialog } from '../../components/ui/dialog'
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
} from '../../components/ui/dropdown-menu'
import { Field, Input } from '../../components/ui/field'
import {
  BookmarkIcon,
  ChevronDownIcon,
  PlusIcon,
  RefreshIcon,
  TrashIcon,
} from '../../components/ui/icons'
import { useToast } from '../../components/ui/toast'
import { errorCode, invoke } from '../../lib/bridge'

interface SavedFiltersProps {
  query: ListingQuery
  /** Replaces the whole query with the saved one. */
  onApply: (query: ListingQuery) => void
}

export function SavedFilters({ query, onApply }: SavedFiltersProps) {
  const { t } = useTranslation()
  const [filters, setFilters] = useState<SavedFilter[] | null>(null)
  const [error, setError] = useState<AppErrorCode | null>(null)
  const [loads, setLoads] = useState(0)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<SavedFilter | null>(null)

  useEffect(() => {
    let ignore = false
    invoke('filters:list').then(
      (list) => {
        if (ignore) return
        setFilters(list)
        setError(null)
      },
      (failure: unknown) => {
        if (!ignore) setError(errorCode(failure))
      },
    )
    return () => {
      ignore = true
    }
  }, [loads])

  const reload = () => setLoads((count) => count + 1)
  // Presets show a translated name and cannot be deleted.
  const nameOf = (filter: SavedFilter) =>
    filter.presetKey === null ? filter.name : t(`filters.presets.${filter.presetKey}`)
  const userFilters = filters?.filter((filter) => filter.presetKey === null) ?? []

  return (
    <>
      {/* Not modal: a dialog opened from an item then gets focus without a fight. */}
      <Menu modal={false}>
        <MenuTrigger asChild>
          <Button variant="outline" size="sm" className="group">
            <BookmarkIcon className="text-fg-muted" />
            {t('filters.saved.menu')}
            <ChevronDownIcon className="size-3.5 text-fg-muted transition-transform duration-160 ease-standard group-data-[state=open]:rotate-180" />
          </Button>
        </MenuTrigger>
        <MenuContent align="start">
          {error !== null ? (
            <>
              <MenuLabel>{t('filters.saved.loadFailed')}</MenuLabel>
              <MenuItem icon={<RefreshIcon />} onSelect={reload}>
                {t('common.retry')}
              </MenuItem>
            </>
          ) : filters === null ? (
            <MenuLabel>{t('common.loading')}</MenuLabel>
          ) : filters.length === 0 ? (
            <MenuLabel>{t('filters.saved.empty')}</MenuLabel>
          ) : (
            filters.map((filter) => (
              <MenuItem
                key={filter.id}
                title={nameOf(filter)}
                onSelect={() => onApply(filter.query)}
              >
                {nameOf(filter)}
              </MenuItem>
            ))
          )}
          <MenuSeparator />
          <MenuItem icon={<PlusIcon />} onSelect={() => setSaving(true)}>
            {t('filters.saved.save')}
          </MenuItem>
          {userFilters.length > 0 && (
            <MenuSub>
              <MenuSubTrigger icon={<TrashIcon />}>{t('filters.saved.delete')}</MenuSubTrigger>
              <MenuSubContent>
                {userFilters.map((filter) => (
                  <MenuItem
                    key={filter.id}
                    danger
                    title={filter.name}
                    onSelect={() => setDeleting(filter)}
                  >
                    {filter.name}
                  </MenuItem>
                ))}
              </MenuSubContent>
            </MenuSub>
          )}
        </MenuContent>
      </Menu>

      {saving && (
        <SaveFilterDialog query={query} onClose={() => setSaving(false)} onSaved={reload} />
      )}
      {deleting !== null && (
        <DeleteFilterDialog
          filter={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={reload}
        />
      )}
    </>
  )
}

interface SaveFilterDialogProps {
  query: ListingQuery
  onClose: () => void
  onSaved: () => void
}

function SaveFilterDialog({ query, onClose, onSaved }: SaveFilterDialogProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const formId = useId()
  const [name, setName] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<AppErrorCode | null>(null)
  const trimmed = name.trim()
  const invalid =
    trimmed === ''
      ? t('filters.save.nameRequired')
      : trimmed.length > 80
        ? t('filters.save.nameTooLong')
        : undefined

  async function save() {
    setSubmitted(true)
    if (invalid !== undefined) return
    setPending(true)
    setFailure(null)
    try {
      await invoke('filters:save', { name: trimmed, query })
      toast({ kind: 'success', title: t('filters.save.saved') })
      onSaved()
      onClose()
    } catch (error) {
      setFailure(errorCode(error))
      setPending(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      size="sm"
      title={t('filters.save.title')}
      description={t('filters.save.description')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form={formId} loading={pending}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <Field label={t('filters.save.name')} error={submitted ? invalid : undefined}>
          {(control) => (
            <Input
              {...control}
              value={name}
              maxLength={80}
              autoComplete="off"
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        {failure !== null && (
          <p role="alert" className="text-danger-text">
            {t('filters.save.failed')} {t(`errors.${failure}`)}
          </p>
        )}
      </form>
    </Dialog>
  )
}

interface DeleteFilterDialogProps {
  filter: SavedFilter
  onClose: () => void
  onDeleted: () => void
}

function DeleteFilterDialog({ filter, onClose, onDeleted }: DeleteFilterDialogProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<AppErrorCode | null>(null)

  async function remove() {
    setPending(true)
    setFailure(null)
    try {
      await invoke('filters:delete', { id: filter.id })
      toast({ kind: 'success', title: t('filters.delete.deleted') })
      onDeleted()
      onClose()
    } catch (error) {
      setFailure(errorCode(error))
      setPending(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      size="sm"
      title={t('filters.delete.title', { name: filter.name })}
      description={t('filters.delete.text')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" loading={pending} onClick={() => void remove()}>
            {t('common.delete')}
          </Button>
        </>
      }
    >
      {failure === null ? undefined : (
        <p role="alert" className="text-danger-text">
          {t('filters.delete.failed')} {t(`errors.${failure}`)}
        </p>
      )}
    </Dialog>
  )
}
