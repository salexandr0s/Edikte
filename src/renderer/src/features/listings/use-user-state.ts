import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ListingPage, ListingQuery, ListingRow } from '@shared/domain'
import { useToast } from '../../components/ui/toast'
import { errorCode, invoke } from '../../lib/bridge'
import type { ListingPageState } from './use-listing-page'
import {
  applyUserStatePatches,
  nextPendingUserState,
  pendingPatches,
  type PendingUserState,
  type UserStateEvent,
  type UserStatePatch,
} from './query-helpers'

interface Tracked {
  /** The page the changes were last compared with. */
  page: ListingPage | null
  changes: readonly PendingUserState[]
}

export interface UserStateControls {
  /** The page's rows with unconfirmed star and hide changes applied. */
  rows: ListingRow[]
  star: (row: ListingRow) => void
  toggleHidden: (row: ListingRow) => void
}

/**
 * Star and hide. The row changes at once and keeps the change over refetched
 * pages until main has stored it and the page of a later query has arrived.
 * Each save asks for that query.
 */
export function useUserState(
  listing: Pick<ListingPageState, 'page' | 'pageRequest' | 'requestsSent' | 'reload'>,
  query: Pick<ListingQuery, 'showHidden' | 'starredOnly'>,
): UserStateControls {
  const { page, pageRequest } = listing
  const { t } = useTranslation()
  const toast = useToast()
  const lastId = useRef(0)
  const [tracked, setTracked] = useState<Tracked>({ page, changes: [] })
  let { changes } = tracked
  if (tracked.page !== page) {
    // A new page contains the saved changes; changes still in flight stay on top.
    const arrived = { kind: 'page', request: pageRequest } as const
    changes = nextPendingUserState(changes, arrived)
    setTracked((current) =>
      current.page === page
        ? current
        : { page, changes: nextPendingUserState(current.changes, arrived) },
    )
  }
  const rows = page === null ? [] : applyUserStatePatches(page.rows, pendingPatches(changes), query)

  function track(event: UserStateEvent) {
    setTracked((current) => ({
      ...current,
      changes: nextPendingUserState(current.changes, event),
    }))
  }

  async function update(row: ListingRow, patch: UserStatePatch, failure: string) {
    lastId.current += 1
    const id = lastId.current
    track({ kind: 'sent', id, caseKey: row.caseKey, patch })
    try {
      await invoke('userState:update', { caseKey: row.caseKey, ...patch })
      track({ kind: 'saved', id, requestsSent: listing.requestsSent() })
      listing.reload()
      return true
    } catch (error) {
      track({ kind: 'failed', id })
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
