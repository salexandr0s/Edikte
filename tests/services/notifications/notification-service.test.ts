import { afterEach, describe, expect, it } from 'vitest'
import { ListingQuerySchema } from '@shared/domain'
import { openDatabase, type AppDatabase } from '../../../src/main/db/client'
import { loadListingSnapshot } from '../../../src/main/db/listing-store'
import { createNotificationStore } from '../../../src/main/db/notification-store'
import { listingDiscoveries } from '../../../src/main/db/schema'
import { saveFilter } from '../../../src/main/db/user-store'
import {
  createNotificationService,
  type DesktopAdapter,
  type NotificationService,
} from '../../../src/main/services/notifications'
import { insertEdict } from '../../db/listing-fixtures'

const opened: Array<{ db: AppDatabase; service: NotificationService }> = []
afterEach(async () => {
  for (const { db, service } of opened.splice(0)) {
    await service.dispose()
    db.$client.close()
  }
})

function setup(options: { supported?: boolean; fail?: boolean } = {}) {
  const db = openDatabase(':memory:')
  const filter = saveFilter(db, { name: 'Homes', query: ListingQuerySchema.parse({}) })
  const store = createNotificationStore(db)
  const shown: number[] = []
  let syncing = true
  let failure: ((error: string) => void) | undefined
  const desktop: DesktopAdapter = {
    isSupported: () => options.supported ?? true,
    show: (summary, onFailed) => {
      if (summary !== null) shown.push(summary.id)
      if (options.fail === true) throw new Error('fixture native transport failed')
      failure = onFailed
    },
    restore: () => Promise.resolve(),
    dispose: () => undefined,
  }
  const service = createNotificationService({
    db,
    desktop,
    emit: () => undefined,
    now: () => new Date('2026-11-03T08:00:00Z'),
    isSyncing: () => syncing,
  })
  opened.push({ db, service })
  service.updateRule({
    filterId: filter.id,
    enabled: true,
    cadence: 'after_sync',
    time: '09:00',
    weekday: 1,
    desktopEnabled: true,
  })
  const row = insertEdict(db, 1, { objektgroesseSqm: 80 })
  const snapshot = loadListingSnapshot(db)[0]
  if (snapshot === undefined) throw new Error('Fixture listing missing')
  db.insert(listingDiscoveries)
    .values({
      caseKey: row.caseKey,
      source: row.source,
      bundesland: row.bundesland,
      firstSeenAt: row.firstSeenAt,
      committedAt: '2026-11-03T07:00:00Z',
      kind: 'live',
      snapshot,
    })
    .run()
  return {
    db,
    store,
    service,
    shown,
    settled: () => {
      syncing = false
    },
    failLater: () => failure?.('fixture asynchronous transport failure'),
  }
}

describe('notification orchestration', () => {
  it('waits for a source pass and serializes repeated completion checks into one digest and desktop attempt', async () => {
    const { store, service, shown, settled, failLater } = setup()
    await service.check({ afterSync: true })
    expect(store.listNotifications().items).toEqual([])
    settled()
    await Promise.all([service.check({ afterSync: true }), service.check({ afterSync: true })])
    expect(store.listNotifications().items).toHaveLength(1)
    expect(shown).toHaveLength(1)
    expect(service.deliveryStatus().lastStatus).toBe('attempted')
    failLater()
    expect(service.deliveryStatus().lastStatus).toBe('failed')
    expect(store.listNotifications().unreadCount).toBe(1)
  })

  it('preserves in-app digests when native transport is unsupported or throws', async () => {
    for (const options of [{ supported: false }, { fail: true }]) {
      const { store, service, settled } = setup(options)
      settled()
      await service.check({ afterSync: true })
      const [summary] = store.listNotifications().items
      expect(summary?.count).toBe(1)
      expect(summary?.desktopStatus).toBe(options.supported === false ? 'unsupported' : 'failed')
      expect(summary?.readAt).toBeNull()
      await service.check({ afterSync: true })
      expect(store.listNotifications().items).toHaveLength(1)
    }
  })
})
