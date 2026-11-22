import type { DashboardData } from '@shared/notifications'
import type { AppDatabase } from './client'
import { loadSavedSearchSnapshot, searchInScope } from './collection-store'
import { discoveryTrackingStartedAt } from './discovery-store'
import { createNotificationStore, readSourceCoverage } from './notification-store'

export function getDashboard(
  db: AppDatabase,
  request: { filterId: number | null },
  now: Date = new Date(),
): DashboardData {
  const snapshot = loadSavedSearchSnapshot(db, now)
  const counts = snapshot.counts(request.filterId)
  const recent = snapshot.items(request.filterId, 'new')
  const upcoming = snapshot.items(request.filterId, 'upcoming')
  const starred = snapshot.items(request.filterId, 'starred')
  const notifications = createNotificationStore(db)
  const rules = new Map(notifications.listRules(now).map((rule) => [rule.filterId, rule]))
  return {
    generatedAt: now.toISOString(),
    counts: {
      matching: counts.matchCount,
      new: recent.length,
      upcoming: upcoming.length,
      starred: starred.length,
    },
    newListings: recent.slice(0, 6),
    upcomingListings: upcoming.slice(0, 5),
    starredListings: starred.slice(0, 5),
    searches: snapshot.filters.map((filter) => ({
      filter,
      ...snapshot.counts(filter.id),
      alert: rules.get(filter.id) ?? notifications.getRule(filter.id, now),
      inScope: searchInScope(filter, snapshot.settings),
    })),
    notifications: notifications.listNotifications({
      limit: 5,
      ...(request.filterId === null ? {} : { filterId: request.filterId }),
    }).items,
    coverage: readSourceCoverage(db),
    trackingStartedAt: discoveryTrackingStartedAt(db),
    totalInScope: snapshot.totalInScope,
  }
}
