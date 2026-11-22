import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, lt, max } from 'drizzle-orm'
import { ListingRowSchema, type ListingQuery, type ListingRow, type Settings } from '@shared/domain'
import {
  AlertConfigSchema,
  AlertRuleSchema,
  NotificationListRequestSchema,
  NotificationSummarySchema,
  type AlertConfig,
  type AlertRule,
  type DesktopAttempt,
  type NotificationDetail,
  type NotificationListPage,
  type NotificationListRequest,
  type NotificationSummary,
  type SourceCoverage,
} from '@shared/notifications'
import { AppError } from '@shared/errors'
import { matchesListingQuery, withPriceBasis } from '@shared/listing-query'
import type { AppDatabase } from './client'
import { createDiscoveryResolver } from './discovery-store'
import { loadListingSnapshot } from './listing-store'
import { alertMatches, filterAlerts, listingDiscoveries, notificationBatches } from './schema'
import { readSettings } from './settings-store'
import { lastCompleteSyncAt, lastFinishedRun } from './sync-store'
import { listSavedFilters } from './user-store'
import { nextAlertDue } from '../services/notifications/schedule'

type StoredRule = typeof filterAlerts.$inferSelect

function publicRule(rule: StoredRule): AlertRule {
  const { filterId, enabled, cadence, time, weekday, desktopEnabled, revision, nextDueAt } = rule
  return AlertRuleSchema.parse({
    filterId,
    enabled,
    cadence,
    time,
    weekday,
    desktopEnabled,
    revision,
    nextDueAt,
  })
}

function sameCriteria(left: ListingQuery, right: ListingQuery): boolean {
  const { sort: _leftSort, ...leftCriteria } = left
  const { sort: _rightSort, ...rightCriteria } = right
  return JSON.stringify(leftCriteria) === JSON.stringify(rightCriteria)
}

function scopeKey(db: AppDatabase): string {
  const settings = readSettings(db)
  return JSON.stringify({
    sources: [...settings.syncSources].sort(),
    bundeslaender: [...settings.syncBundeslaender].sort(),
  })
}

function inScope(settings: Settings, row: ListingRow): boolean {
  return (
    settings.syncSources.includes(row.source) &&
    row.bundesland !== null &&
    settings.syncBundeslaender.includes(row.bundesland)
  )
}

export function readSourceCoverage(db: AppDatabase): SourceCoverage[] {
  const settings = readSettings(db)
  return settings.syncSources.map((source) => ({
    source,
    lastSuccessAt: lastCompleteSyncAt(db, settings.syncBundeslaender, source),
    lastRun: lastFinishedRun(db, source),
  }))
}

/** Persistence is synchronous so every cursor, candidate and batch update can be atomic. */
export function createNotificationStore(db: AppDatabase) {
  const highestDiscovery = (): number =>
    db
      .select({ id: max(listingDiscoveries.id) })
      .from(listingDiscoveries)
      .get()?.id ?? 0

  const discardPending = (filterId: number): void => {
    db.update(alertMatches)
      .set({ state: 'discarded' })
      .where(and(eq(alertMatches.filterId, filterId), eq(alertMatches.state, 'pending')))
      .run()
  }

  const reconcileRules = (now = new Date()): void => {
    db.transaction(() => {
      const filters = listSavedFilters(db)
      const key = scopeKey(db)
      const at = now.toISOString()
      const cursor = highestDiscovery()
      const existing = new Map(
        db
          .select()
          .from(filterAlerts)
          .all()
          .map((rule) => [rule.filterId, rule]),
      )
      for (const filter of filters) {
        const query = filter.query
        const rule = existing.get(filter.id)
        if (rule === undefined) {
          db.insert(filterAlerts)
            .values({
              filterId: filter.id,
              query,
              scopeKey: key,
              lastProcessedDiscoveryId: cursor,
              lastWindowEndAt: at,
              createdAt: at,
              updatedAt: at,
            })
            .run()
        } else if (rule.scopeKey !== key || !sameCriteria(rule.query, query)) {
          discardPending(filter.id)
          db.update(filterAlerts)
            .set({
              query,
              scopeKey: key,
              revision: rule.revision + 1,
              lastProcessedDiscoveryId: cursor,
              lastWindowEndAt: at,
              nextDueAt: rule.enabled ? nextAlertDue(rule, now) : null,
              updatedAt: at,
            })
            .where(eq(filterAlerts.filterId, filter.id))
            .run()
        }
      }
      // Deleting a saved filter detaches historical matches through SET NULL.
      db.update(alertMatches)
        .set({ state: 'discarded' })
        .where(and(isNull(alertMatches.filterId), eq(alertMatches.state, 'pending')))
        .run()
    })
  }

  const storedRule = (filterId: number): StoredRule => {
    const rule = db.select().from(filterAlerts).where(eq(filterAlerts.filterId, filterId)).get()
    if (rule === undefined)
      throw new AppError('not_found', `Saved filter ${filterId} does not exist`)
    return rule
  }

  const getRule = (filterId: number, now = new Date()): AlertRule => {
    reconcileRules(now)
    return publicRule(storedRule(filterId))
  }

  const listRules = (now = new Date()): AlertRule[] => {
    reconcileRules(now)
    return db.select().from(filterAlerts).orderBy(asc(filterAlerts.filterId)).all().map(publicRule)
  }

  const updateRule = (input: AlertConfig, now = new Date()): AlertRule => {
    const config = AlertConfigSchema.parse(input)
    reconcileRules(now)
    db.transaction(() => {
      const previous = storedRule(config.filterId)
      const changedEnabled = previous.enabled !== config.enabled
      const changedSchedule =
        previous.cadence !== config.cadence ||
        previous.time !== config.time ||
        previous.weekday !== config.weekday
      if (changedEnabled) discardPending(config.filterId)
      db.update(filterAlerts)
        .set({
          ...config,
          ...(changedEnabled
            ? {
                revision: previous.revision + 1,
                lastProcessedDiscoveryId: highestDiscovery(),
                lastWindowEndAt: now.toISOString(),
              }
            : {}),
          nextDueAt: !config.enabled
            ? null
            : changedEnabled || changedSchedule
              ? nextAlertDue(config, now)
              : previous.nextDueAt,
          updatedAt: now.toISOString(),
        })
        .where(eq(filterAlerts.filterId, config.filterId))
        .run()
    })
    return publicRule(storedRule(config.filterId))
  }

  const processDiscoveries = (now = new Date()): void => {
    reconcileRules(now)
    db.transaction(() => {
      const cursor = highestDiscovery()
      const rules = db
        .select()
        .from(filterAlerts)
        .where(
          and(eq(filterAlerts.enabled, true), lt(filterAlerts.lastProcessedDiscoveryId, cursor)),
        )
        .all()
      if (rules.length === 0) return
      const settings = readSettings(db)
      for (const rule of rules) {
        const discoveries = db
          .select()
          .from(listingDiscoveries)
          .where(gt(listingDiscoveries.id, rule.lastProcessedDiscoveryId))
          .orderBy(asc(listingDiscoveries.id))
          .all()
        for (const discovery of discoveries) {
          if (discovery.kind !== 'live' || discovery.mergedIntoId !== null) continue
          const parsed = ListingRowSchema.safeParse(discovery.snapshot)
          if (!parsed.success || !inScope(settings, parsed.data)) continue
          const snapshot = withPriceBasis(parsed.data, rule.query.priceBasis)
          if (!matchesListingQuery(snapshot, rule.query)) continue
          db.insert(alertMatches)
            .values({
              filterId: rule.filterId,
              revision: rule.revision,
              discoveryId: discovery.id,
              state: 'pending',
              snapshot,
              createdAt: discovery.committedAt,
            })
            .onConflictDoNothing()
            .run()
        }
        db.update(filterAlerts)
          .set({ lastProcessedDiscoveryId: cursor })
          .where(eq(filterAlerts.filterId, rule.filterId))
          .run()
      }
    })
  }

  const summaryOf = (row: typeof notificationBatches.$inferSelect): NotificationSummary =>
    NotificationSummarySchema.parse(row)

  const deliverDue = (now = new Date(), afterSync = false): NotificationSummary[] => {
    const created: NotificationSummary[] = []
    db.transaction(() => {
      const due = db
        .select()
        .from(filterAlerts)
        .where(eq(filterAlerts.enabled, true))
        .all()
        .filter((rule) =>
          rule.cadence === 'after_sync'
            ? afterSync
            : rule.nextDueAt !== null && rule.nextDueAt <= now.toISOString(),
        )
      if (due.length === 0) return

      const rows = loadListingSnapshot(db, { includeRemoved: true })
      const byCase = new Map(rows.map((row) => [row.caseKey, row]))
      const filters = new Map(listSavedFilters(db).map((filter) => [filter.id, filter]))
      const coverage = readSourceCoverage(db)
      const resolveDiscovery = createDiscoveryResolver(db)
      for (const rule of due) {
        const filter = filters.get(rule.filterId)
        if (filter === undefined) continue
        const candidates = db
          .select()
          .from(alertMatches)
          .where(
            and(
              eq(alertMatches.filterId, rule.filterId),
              eq(alertMatches.revision, rule.revision),
              eq(alertMatches.state, 'pending'),
            ),
          )
          .orderBy(asc(alertMatches.id))
          .all()
        const members: Array<{ id: number; snapshot: ListingRow }> = []
        const seen = new Set<number>()
        for (const candidate of candidates) {
          const discovery = resolveDiscovery(candidate.discoveryId)
          const canonicalId = discovery?.id ?? candidate.discoveryId
          const row =
            discovery?.caseKey === null || discovery?.caseKey === undefined
              ? undefined
              : byCase.get(discovery.caseKey)
          const current = row === undefined ? undefined : withPriceBasis(row, rule.query.priceBasis)
          if (
            discovery?.kind !== 'live' ||
            current === undefined ||
            current.removedAt !== null ||
            seen.has(canonicalId) ||
            !matchesListingQuery(current, rule.query)
          ) {
            db.update(alertMatches)
              .set({ state: 'discarded' })
              .where(eq(alertMatches.id, candidate.id))
              .run()
            continue
          }
          seen.add(canonicalId)
          members.push({ id: candidate.id, snapshot: current })
        }
        let periodTo = new Date(
          Math.max(now.getTime(), Date.parse(rule.lastWindowEndAt)),
        ).toISOString()
        const sameWindow = db
          .select({ id: notificationBatches.id })
          .from(notificationBatches)
          .where(
            and(
              eq(notificationBatches.filterId, rule.filterId),
              eq(notificationBatches.revision, rule.revision),
              eq(notificationBatches.periodTo, periodTo),
            ),
          )
          .get()
        if (members.length > 0 && sameWindow !== undefined) {
          periodTo = new Date(Date.parse(periodTo) + 1).toISOString()
        }
        if (members.length > 0) {
          const batch = db
            .insert(notificationBatches)
            .values({
              filterId: filter.id,
              filterName: filter.name,
              presetKey: filter.presetKey,
              query: rule.query,
              revision: rule.revision,
              createdAt: now.toISOString(),
              periodFrom: rule.lastWindowEndAt,
              periodTo,
              count: members.length,
              coverage: coverage.filter(
                (item) =>
                  rule.query.sources.length === 0 || rule.query.sources.includes(item.source),
              ),
              desktopStatus: rule.desktopEnabled ? 'pending' : 'not_requested',
            })
            .returning()
            .get()
          for (const member of members) {
            db.update(alertMatches)
              .set({
                state: 'notified',
                notificationId: batch.id,
                snapshot: member.snapshot,
              })
              .where(eq(alertMatches.id, member.id))
              .run()
          }
          created.push(summaryOf(batch))
        }
        db.update(filterAlerts)
          .set({
            lastWindowEndAt: periodTo,
            nextDueAt: nextAlertDue(rule, now),
          })
          .where(eq(filterAlerts.filterId, rule.filterId))
          .run()
      }
    })
    return created
  }

  const listNotifications = (input: NotificationListRequest = {}): NotificationListPage => {
    const request = NotificationListRequestSchema.parse(input)
    const where = and(
      request.unreadOnly ? isNull(notificationBatches.readAt) : undefined,
      request.beforeId === undefined ? undefined : lt(notificationBatches.id, request.beforeId),
      request.filterId === undefined
        ? undefined
        : eq(notificationBatches.filterId, request.filterId),
    )
    const rows = db
      .select()
      .from(notificationBatches)
      .where(where)
      .orderBy(desc(notificationBatches.id))
      .limit(request.limit + 1)
      .all()
    const page = rows.slice(0, request.limit)
    return {
      items: page.map(summaryOf),
      nextCursor: rows.length > request.limit ? (page.at(-1)?.id ?? null) : null,
      unreadCount:
        db
          .select({ count: count() })
          .from(notificationBatches)
          .where(isNull(notificationBatches.readAt))
          .get()?.count ?? 0,
    }
  }

  const batchById = (id: number): typeof notificationBatches.$inferSelect => {
    const batch = db.select().from(notificationBatches).where(eq(notificationBatches.id, id)).get()
    if (batch === undefined) throw new AppError('not_found', `Notification ${id} does not exist`)
    return batch
  }

  const getNotification = (id: number): NotificationDetail => {
    const notification = summaryOf(batchById(id))
    const currentRows = loadListingSnapshot(db, { includeRemoved: true, allScopes: true })
    const current = new Map(currentRows.map((row) => [row.caseKey, row]))
    const resolveDiscovery = createDiscoveryResolver(db)
    const matches = db
      .select()
      .from(alertMatches)
      .where(eq(alertMatches.notificationId, id))
      .orderBy(asc(alertMatches.id))
      .all()
    return {
      notification,
      items: matches.map((match) => {
        const canonical = resolveDiscovery(match.discoveryId)
        const row = current.get(canonical?.caseKey ?? match.snapshot.caseKey)
        return {
          listing: match.snapshot,
          current: row === undefined ? null : withPriceBasis(row, notification.query.priceBasis),
          discoveryId: match.discoveryId,
          filterIds: notification.filterId === null ? [] : [notification.filterId],
        }
      }),
    }
  }

  return {
    getRule,
    listRules,
    updateRule,
    reconcileRules,
    processDiscoveries,
    deliverDue,
    listNotifications,
    getNotification,
    markRead: (id: number, now = new Date()): void => {
      batchById(id)
      db.update(notificationBatches)
        .set({ readAt: now.toISOString() })
        .where(and(eq(notificationBatches.id, id), isNull(notificationBatches.readAt)))
        .run()
    },
    markAllRead: (now = new Date()): void => {
      db.update(notificationBatches)
        .set({ readAt: now.toISOString() })
        .where(isNull(notificationBatches.readAt))
        .run()
    },
    setDesktopStatus: (
      id: number,
      status: DesktopAttempt,
      error: string | null,
      now = new Date(),
    ): void => {
      const batch = batchById(id)
      db.update(notificationBatches)
        .set({
          desktopStatus: status,
          desktopError: error,
          desktopAttemptedAt: batch.desktopAttemptedAt ?? now.toISOString(),
        })
        .where(eq(notificationBatches.id, id))
        .run()
    },
    pendingDesktop: (): NotificationSummary[] =>
      db
        .select()
        .from(notificationBatches)
        .where(eq(notificationBatches.desktopStatus, 'pending'))
        .orderBy(asc(notificationBatches.id))
        .all()
        .map(summaryOf),
    deliveryStatus: (supported: boolean) => {
      const latest = db
        .select()
        .from(notificationBatches)
        .where(inArray(notificationBatches.desktopStatus, ['attempted', 'failed', 'unsupported']))
        .orderBy(desc(notificationBatches.desktopAttemptedAt))
        .limit(1)
        .get()
      return {
        supported,
        lastAttemptAt: latest?.desktopAttemptedAt ?? null,
        lastStatus:
          latest?.desktopStatus === 'attempted' ||
          latest?.desktopStatus === 'failed' ||
          latest?.desktopStatus === 'unsupported'
            ? latest.desktopStatus
            : ('unknown' as const),
        lastError: latest?.desktopError ?? null,
      }
    },
    requestOpen: (id: number, now = new Date()): void => {
      batchById(id)
      db.transaction(() => {
        db.update(notificationBatches).set({ pendingOpenAt: null }).run()
        db.update(notificationBatches)
          .set({ pendingOpenAt: now.toISOString() })
          .where(eq(notificationBatches.id, id))
          .run()
      })
    },
    pendingOpen: (): number | null =>
      db
        .select({ id: notificationBatches.id })
        .from(notificationBatches)
        .where(gt(notificationBatches.pendingOpenAt, ''))
        .orderBy(desc(notificationBatches.pendingOpenAt))
        .get()?.id ?? null,
    ackOpen: (id: number): void => {
      db.update(notificationBatches)
        .set({ pendingOpenAt: null })
        .where(eq(notificationBatches.id, id))
        .run()
    },
    nextDueAt: (): string | null =>
      db
        .select({ at: filterAlerts.nextDueAt })
        .from(filterAlerts)
        .where(and(eq(filterAlerts.enabled, true), isNotNull(filterAlerts.nextDueAt)))
        .orderBy(asc(filterAlerts.nextDueAt))
        .limit(1)
        .get()?.at ?? null,
  }
}

export type NotificationStore = ReturnType<typeof createNotificationStore>
