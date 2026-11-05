import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ListingPage, ListingQuery, ListingRow } from '@shared/domain'
import { useToast } from '../../components/ui/toast'
import { errorCode, invoke } from '../../lib/bridge'
import { applyUserStatePatches, type UserStatePatch } from './query-helpers'

const NO_PATCHES: ReadonlyMap<string, UserStatePatch> = new Map()

interface Patches {
  /** The page the patches were made on; a newer page already contains them. */
  page: ListingPage | null
  byCase: ReadonlyMap<string, UserStatePatch>
}

export interface UserStateControls {
  /** The page's rows with unconfirmed star and hide changes applied. */
  rows: ListingRow[]
  star: (row: ListingRow) => void
  toggleHidden: (row: ListingRow) => void
}

/**
 * Star and hide. The row changes at once; main confirms the change through
 * listings:changed, and the refetched page replaces the local patch.
 */
export function useUserState(
  page: ListingPage | null,
  query: Pick<ListingQuery, 'showHidden' | 'starredOnly'>,
): UserStateControls {
  const { t } = useTranslation()
  const toast = useToast()
  const [patches, setPatches] = useState<Patches>({ page: null, byCase: NO_PATCHES })
  const current = patches.page === page ? patches.byCase : NO_PATCHES
  const rows = page === null ? [] : applyUserStatePatches(page.rows, current, query)

  function patch(caseKey: string, change: UserStatePatch | null) {
    setPatches((state) => {
      const byCase = new Map(state.page === page ? state.byCase : NO_PATCHES)
      if (change === null) byCase.delete(caseKey)
      else byCase.set(caseKey, { ...byCase.get(caseKey), ...change })
      return { page, byCase }
    })
  }

  async function update(row: ListingRow, change: UserStatePatch, failure: string) {
    patch(row.caseKey, change)
    try {
      await invoke('userState:update', { caseKey: row.caseKey, ...change })
      return true
    } catch (error) {
      patch(row.caseKey, null)
      toast({ kind: 'error', title: failure, description: t(`errors.${errorCode(error)}`) })
      return false
    }
  }

  async function toggleHidden(row: ListingRow) {
    const hidden = !row.hidden
    const saved = await update(row, { hidden }, t('listings.row.hideFailed'))
    if (!saved || !hidden) return
    toast({
      kind: 'info',
      title: t('listings.row.hiddenToast'),
      action: {
        label: t('listings.row.undo'),
        onClick: () => void update(row, { hidden: false }, t('listings.row.hideFailed')),
      },
    })
  }

  return {
    rows,
    star: (row) => void update(row, { starred: !row.starred }, t('listings.row.starFailed')),
    toggleHidden: (row) => void toggleHidden(row),
  }
}
